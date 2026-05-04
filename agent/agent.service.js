// ReAct-style agent loop. Takes a user task, retrieves relevant screen docs
// via RAG, then iteratively: screenshot → LLM analyzes → execute action →
// screenshot → verify → repeat until done or stuck.

import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  captureScreenshot,
  moveMouse,
  clickMouse,
  typeText,
  pressKeys,
  getScreenSize,
} from 'kraken-core';

const execFileP = promisify(execFile);

import { invoke, invokeWithVision, HumanMessage, SystemMessage } from './llm.service.js';
import { queryScreens } from './rag.service.js';
import { buildSystemPrompt, buildScreenContext, STUCK_HINT, PARSE_RETRY } from './prompts.js';

// Build the platform-aware system prompt once per module load. Agent needs
// OS-specific shortcut knowledge injected so it doesn't try Linux shortcuts
// on macOS (or vice versa). os.release() / os.arch() give the LLM enough
// detail to derive the right keys for the current machine.
const SYSTEM_PROMPT = buildSystemPrompt({
  platform: process.platform,
  release: os.release(),
  arch: os.arch(),
});
import { annotateScreenshot } from './annotate-screenshot.js';
import * as log from './logger.js';

const COMP = 'agent';
const POST_ACTION_DELAY_MS = 400; // let UI settle after an action
// Keep at most this many images in the outgoing message array on any LLM
// call. The agent really only needs:
//   - the CURRENT screenshot (to decide the next action), and
//   - the PREVIOUS one (to verify the last action's effect).
// Older screenshots become a textual breadcrumb instead of full images. This
// cuts per-call token cost ~2.5× (each PNG ≈ 1500-3000 tokens for vision
// models), which keeps us well under Groq's 30K TPM cap and doubles the
// number of calls we can make per minute on every provider. The previously-
// added SHA-256 no-op detector means the agent doesn't need many historical
// frames to notice "my action did nothing" — that's surfaced as text.
// Override via env: AGENT_MAX_IMAGES=3 for more visual history.
const MAX_IMAGES_IN_CONTEXT = parseInt(process.env.AGENT_MAX_IMAGES || '2', 10);

export class Agent {
  constructor({
    maxSteps = 30,
    maxRetries = 3,
    verbose = false,
    collection,   // ChromaDB collection to query (from context)
    screensDir,   // Directory of screen docs (not strictly needed for run, but stored for symmetry)
  } = {}) {
    this.maxSteps = maxSteps;
    this.maxRetries = maxRetries;
    this.verbose = verbose;
    this.collection = collection;
    this.screensDir = screensDir;
    this.history = [];
    this.stats = { steps: 0, llmCalls: 0, gemini: 0, groq: 0 };
    this._cancelled = false;
    this.phase = 'idle';        // current stage — read by /agent/current for live UI
    this.phaseDetail = '';      // optional sub-description (e.g. provider being called)
    this.phaseSince = Date.now();
  }

  _setPhase(phase, detail = '') {
    this.phase = phase;
    this.phaseDetail = detail;
    this.phaseSince = Date.now();
  }

  /** Request the agent loop to stop at the next safe point (top of the loop,
   *  after the current LLM call / action returns). Best-effort: an in-flight
   *  LLM request still completes, but no further steps are taken. */
  cancel() {
    this._cancelled = true;
  }

  /**
   * Run the agent loop for a given task.
   * @param {string} taskDescription
   * @returns {{ status, success, summary, steps, history, stats, ... }}
   */
  async run(taskDescription) {
    log.info(COMP, `starting task: "${taskDescription}" (collection=${this.collection || 'default'})`);

    // 1. Retrieve relevant screen documentation via RAG (scoped to our collection)
    this._setPhase('rag', `searching screen docs for: ${taskDescription.slice(0, 50)}`);
    let screenContext;
    this.ragResult = { status: 'pending', screens: [], error: null };
    try {
      const screens = await queryScreens(taskDescription, 5, { collection: this.collection });
      screenContext = buildScreenContext(screens);
      // Store summary for UI visibility — name + category + distance so the
      // user can see WHICH docs were retrieved, not just a count.
      this.ragResult = {
        status: 'ok',
        screens: screens.map(s => ({
          name: s.screenName,
          category: s.featureCategory,
          distance: s.score,   // rag.service.js returns 'score', not 'distance'
          preview: (s.content || '').slice(0, 120),
        })),
        error: null,
      };
      log.info(COMP, `RAG returned ${screens.length} screens: ${screens.map(s => s.screenName).join(', ')}`);
    } catch (err) {
      log.warn(COMP, `RAG query failed, proceeding without screen context: ${err.message}`);
      screenContext = 'Screen documentation unavailable. Navigate by visual inspection only.';
      this.ragResult = { status: 'failed', screens: [], error: err.message };
    }

    // 2. Take initial screenshot
    this._setPhase('screenshot', 'initial capture');
    const screenSize = await getScreenSize();
    this.screenSize = screenSize;  // stored so _executeAction can validate/rescale coords
    log.info(COMP, `screen size: ${screenSize.width}x${screenSize.height}`);

    const initialShot = await this._takeScreenshot();
    this._lastScreenHash = this._hashScreenshot(initialShot);
    this._lastClickCoords = null;
    const initialShotForLLM = await this._annotateForLLM(initialShot);

    // 2b. Snapshot pre-existing windows so we can detect if the agent
    // accidentally closes any of them during the run (via stray clicks on X
    // buttons, menu > close, etc. — things the keystroke block doesn't cover).
    this._initialWindows = await this._snapshotWindows();
    if (this._initialWindows) {
      log.info(COMP, `pre-existing windows snapshotted: ${this._initialWindows.size} tracked`);
    }

    // 3. Planning step — one LLM call to produce a high-level breakdown of
    // the task into sub-steps, using the initial screenshot + screen docs
    // as context. Surfaces as `this.plan` for UI visibility.
    this.plan = null;
    try {
      this._setPhase('thinking', 'planning — breaking task into sub-steps');
      const planPrompt = new HumanMessage({
        content: [
          { type: 'text', text:
            `Before taking any action, produce a short plan for this task. ` +
            `Use the screen docs above and the screenshot below to break the task into 3-7 concrete sub-steps. ` +
            `Each sub-step should be a single verifiable outcome (e.g. "Open Discord", "Navigate to User Settings", "Click the Email edit button"). ` +
            `Respond with ONLY a JSON object, no prose:\n` +
            `{ "plan": ["sub-step 1", "sub-step 2", "sub-step 3", ...] }\n\n` +
            `Task: ${taskDescription}\n\nCurrent screen state:`
          },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${initialShotForLLM}` } },
        ],
      });
      const planMeta = { llm: null, events: [] };
      const prevStepMeta = this._currentStepMeta;
      this._currentStepMeta = planMeta;
      const planResponse = await this._callLLM([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(screenContext),
        planPrompt,
      ]);
      this._currentStepMeta = prevStepMeta;
      if (planResponse) {
        const parsed = this._parseAction(planResponse);
        if (parsed?.plan && Array.isArray(parsed.plan)) {
          this.plan = { steps: parsed.plan, llm: planMeta.llm };
          log.info(COMP, `plan: ${parsed.plan.length} sub-steps — ${parsed.plan.map((s, i) => `(${i+1}) ${s.slice(0, 50)}`).join(' → ')}`);
        }
      }
    } catch (err) {
      log.warn(COMP, `planning step failed, proceeding with ReAct only: ${err.message}`);
    }

    // 4. Build initial conversation for the ReAct loop
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(screenContext),
      ...(this.plan ? [new HumanMessage(
        `Your plan for this task:\n${this.plan.steps.map((s, i) => `${i+1}. ${s}`).join('\n')}\n\n` +
        `Execute it step-by-step. After each action, check which sub-step you're on and whether the screen state matches expectations. If reality diverges from the plan, adapt — the plan is a guide, not a contract.`
      )] : []),
      new HumanMessage(`Task: ${taskDescription}\n\nScreen size: ${screenSize.width}x${screenSize.height} pixels.`),
      new HumanMessage(
        `Every screenshot you receive has a faint green coordinate grid overlaid every 100 pixels, with labels like "200" or "400" at every second gridline. Use it to read off exact pixel positions. ` +
        `After any click action, the next screenshot will also have a RED crosshair drawn at the EXACT pixel where your click landed, labeled "last click (x,y)". If the crosshair is offset from your intended target, use that delta to correct your next attempt — don't re-guess from scratch.`
      ),
      this._screenshotMessage('Current screen state:', initialShotForLLM),
    ];

    // 4. Enter the ReAct loop
    return this._runLoop(messages);
  }

  /**
   * The ReAct loop body, factored out so both run() (first start) and
   * resume() (after a pause) can call it with an existing conversation.
   */
  async _runLoop(messages) {
    let retryCount = 0;
    let lastActionStr = '';
    const startStep = this.stats.steps;

    for (let step = startStep; step < this.maxSteps; step++) {
      if (this._cancelled) {
        log.info(COMP, 'cancelled by user');
        return this._result(false, 'cancelled by user');
      }
      this.stats.steps = step + 1;

      // Reset meta for this step — will be populated by onMeta callbacks
      // fired from inside invoke() as it decides which provider/key to use.
      this._currentStepMeta = { llm: null, events: [] };
      this._setPhase('thinking', `step ${step + 1} — calling LLM`);
      // Trim right BEFORE the LLM call so we guarantee the outgoing message
      // array never exceeds the hardest provider image cap (Groq = 5). If we
      // trimmed after the action instead, the new screenshot would push us
      // to 6 images for the next call.
      this._trimOldImages(messages);
      const response = await this._callLLM(messages);
      if (this._cancelled) {
        log.info(COMP, 'cancelled by user (after LLM call)');
        return this._result(false, 'cancelled by user');
      }
      if (!response) {
        // Push a synthetic history entry so the UI poll surfaces what was
        // tried during this failed call (rate-limits, fallbacks, etc).
        // Without this, the final state just shows "LLM unavailable" with
        // no explanation of which slots were attempted.
        const meta = this._currentStepMeta || {};
        this.history.push({
          step: step + 1,
          thought: `(step failed — LLM unavailable)`,
          action: 'fail',
          params: { reason: this._lastLlmError || 'LLM returned no response' },
          llm: meta.llm,
          llmEvents: meta.events,
        });
        return this._result(false,
          this._lastLlmError
            ? `LLM unavailable — ${this._lastLlmError}`
            : 'LLM returned no response'
        );
      }

      const parsed = this._parseAction(response);
      if (!parsed) {
        messages.push(new HumanMessage(PARSE_RETRY));
        continue;
      }

      // Normalize — some models (notably Llama 3 via Groq) sometimes omit
      // "thought" or nest params differently. Supply safe defaults so the
      // loop doesn't crash on .slice() / .summary access.
      const action = parsed.action || 'screenshot';
      const thought = typeof parsed.thought === 'string' ? parsed.thought : '';
      const params = parsed.params || {};
      if (!parsed.action) {
        log.warn(COMP, `LLM response missing "action" field, defaulting to screenshot: ${JSON.stringify(parsed).slice(0, 200)}`);
      }
      const meta = this._currentStepMeta || {};
      log.info(COMP, `step ${step + 1}: [${action}] ${thought.slice(0, 100)}`);
      this.history.push({
        step: step + 1,
        thought,
        action,
        params,
        llm: meta.llm,            // { provider, model, keyName } for the call that produced this step
        llmEvents: meta.events,   // routing events (rate-limited, key-rotated, provider-switched)
      });

      if (action === 'done') {
        return this._result(true, params?.summary || thought);
      }
      if (action === 'fail') {
        // Guard: reject "premature fail" — the model quitting the task because
        // the target app isn't currently visible, even though launching it is
        // an available (and prompt-encouraged) next step. Llama 4 Scout in
        // particular has been observed to emit reasons like "Discord is not
        // currently open; I need to launch it first" and then STOP, instead
        // of actually launching. We reject the fail ONCE (twice max) and
        // inject a directive telling the agent to perform the launch
        // procedure. Only a genuinely missing app — one the agent tried to
        // launch and couldn't find — should terminate the task.
        const reason = String(params?.reason || thought || '').toLowerCase();
        const looksPremature = (
          /\b(not (currently )?(open|running|launched|visible|focused))\b/.test(reason) ||
          /\bneed(s)? to (launch|open|start)\b/.test(reason) ||
          /\bhasn'?t been (launched|opened|started)\b/.test(reason) ||
          /\bnot (yet )?(launched|opened|started)\b/.test(reason)
        );
        // Don't reject fails that explicitly say the app is not installed /
        // not found — those are legitimate terminations.
        const looksTerminal = /\b(not installed|not found|unavailable on this system|doesn'?t exist|cannot find)\b/.test(reason);

        this._prematureFailCount = this._prematureFailCount || 0;
        if (looksPremature && !looksTerminal && this._prematureFailCount < 2) {
          this._prematureFailCount++;
          log.warn(COMP, `rejecting premature fail (${this._prematureFailCount}/2): "${(params?.reason || thought).slice(0, 100)}"`);
          // Pop the fail entry from history so the rejection is clean. The
          // caller's UI shows the correction, not a phantom failure.
          this.history.pop();
          this.stats.steps--;
          // Adjust the loop counter so this iteration doesn't count against
          // maxSteps (the caller never got to execute anything).
          step--;
          messages.push(new HumanMessage(
            `❌ REJECTED your "fail" action. Your reason was: "${(params?.reason || thought).slice(0, 200)}".\n\n` +
            `"The app is not open" is NOT a valid fail reason — LAUNCHING the app is part of your job. ` +
            `Only emit "fail" if the app is genuinely NOT INSTALLED (checked taskbar AND app menu AND \`which <appname>\` in a terminal, all negative).\n\n` +
            `Your next action MUST be one of:\n` +
            `1. press_keys with ["super"] to open the app menu, then type the app name, then press_keys ["enter"]\n` +
            `2. If the app menu doesn't work, press_keys ["control","alt","t"] to open a terminal, then type the app's launch command followed by " &" and press Enter\n` +
            `3. Click the app's icon in the taskbar/dock IF you can clearly identify it\n\n` +
            `Do NOT fail again until you have tried at least method 1 AND method 2.`
          ));
          // Don't update lastActionStr / retryCount here — we want the next
          // action to be evaluated fresh, not as a "stuck repeat".
          continue;
        }
        return this._result(false, params?.reason || thought);
      }
      // Pause: agent needs human assistance (password, OTP, CAPTCHA, etc.)
      // Returns a "paused" status; caller invokes resume() with a fresh
      // screenshot once the user clicks Continue.
      if (action === 'pause') {
        return this._pausedResult(params?.reason || 'other', params?.message || thought, messages);
      }

      // Stuck detection
      const actionStr = JSON.stringify({ action, params });
      if (actionStr === lastActionStr) {
        retryCount++;
        if (retryCount >= this.maxRetries) {
          log.warn(COMP, `stuck: same action repeated ${retryCount} times`);
          messages.push(new HumanMessage(STUCK_HINT));
          retryCount = 0;
          lastActionStr = '';
          continue;
        }
      } else {
        retryCount = 0;
        lastActionStr = actionStr;
      }

      // Execute the action
      this._setPhase('executing', `${action} ${JSON.stringify(params).slice(0, 60)}`);
      try {
        await this._executeAction(action, params);
      } catch (err) {
        log.error(COMP, `action failed: ${err.message}`);
        messages.push(new HumanMessage(
          `Action "${action}" failed with error: ${err.message}. Try a different approach.`
        ));
        continue;
      }

      // Post-action delay + screenshot
      this._setPhase('settling', `waiting ${POST_ACTION_DELAY_MS}ms for UI to update`);
      await this._sleep(POST_ACTION_DELAY_MS);
      this._setPhase('screenshot', 'capturing new screen state');
      const newShot = await this._takeScreenshot();

      // HARD SAFETY: did this action close one of the user's pre-existing
      // windows? (e.g. clicked the X on a browser tab, used a menu-close,
      // or any other path the keystroke block couldn't catch.) If yes, stop
      // the run immediately — don't give the agent a chance to close more.
      const closedWindows = await this._detectClosedWindows();
      if (closedWindows.length > 0) {
        const titles = closedWindows.map(w => `"${w.title.slice(0, 60)}"`).join(', ');
        log.error(COMP, `HALTING: agent closed user window(s): ${titles}`);
        return this._result(false,
          `Halted: the last action (${action}) closed a user window that was open at task start: ${titles}. ` +
          `The agent must never close windows it did not open. Investigate which action caused this.`
        );
      }

      // No-op detection: if the screenshot hash is identical to the one
      // BEFORE the action, the action had no visible effect. This catches the
      // common failure where the model types into the wrong field or clicks on
      // an unresponsive element, then hallucinates success.
      //
      // Exception: for click actions, a slow app launch can make the screen
      // look unchanged at 400ms even though the click DID work (e.g. clicking
      // Discord in the app launcher — the app menu closes and Discord starts
      // loading, but 400ms isn't enough for it to render). In that case we
      // wait an extra 2s and re-check before declaring no-op. This prevents
      // the "agent tried to launch Discord and gave up while it was still
      // opening" failure mode.
      let newShot2 = newShot;
      let newHash = this._hashScreenshot(newShot);
      const prevHash = this._lastScreenHash;
      if (action === 'click' && prevHash && newHash === prevHash) {
        this._setPhase('settling', 'click had no immediate effect — waiting 2s for slow app launch');
        await this._sleep(2000);
        newShot2 = await this._takeScreenshot();
        newHash = this._hashScreenshot(newShot2);
        log.info(COMP, `extended click wait: hash ${newHash === prevHash ? 'still unchanged' : 'changed — app opened'}`);
      }
      const noVisualChange = prevHash && newHash === prevHash;
      this._lastScreenHash = newHash;

      let transitionNote = `Action executed: ${action} ${JSON.stringify(params)}. `;
      if (noVisualChange) {
        transitionNote +=
          `⚠ CRITICAL: the new screenshot is BYTE-IDENTICAL to the one before this action. ` +
          `Your action HAD NO VISIBLE EFFECT. Do NOT assume it succeeded. ` +
          `Likely causes: wrong window/field focused, element not interactive at those coordinates, ` +
          `or a modal blocking input. Before retrying, press Escape to dismiss any open menu/dialog, ` +
          `then re-examine the screen. If previous attempts also had no effect, switch strategies ` +
          `(e.g. if the app menu approach isn't launching anything, close it with Escape and try a terminal with Ctrl+Alt+T).`;
        log.warn(COMP, `step ${step + 1}: screenshot unchanged after action — injecting no-op hint`);
      } else {
        transitionNote += `Analyze the new screenshot and decide the next step.`;
      }
      messages.push(new HumanMessage(transitionNote));
      // Annotate the outbound image (grid + last-click crosshair if any) so
      // the model has spatial reference and direct feedback on its last click.
      // Use newShot2 — which may be a fresher capture after extended click wait.
      const newShotForLLM = await this._annotateForLLM(newShot2);
      // Once annotated and sent, consume the click — the annotation shows
      // the click that just happened, not every past click forever.
      this._lastClickCoords = null;
      messages.push(this._screenshotMessage('New screen state:', newShotForLLM));
    }

    return this._result(false, `reached max steps (${this.maxSteps}) without completing the task`);
  }

  // ---------- Private helpers ----------

  async _takeScreenshot() {
    // Note: gnome-screenshot (our capture tool on Linux) does NOT include the
    // mouse cursor in the PNG. Verified empirically — moving the cursor to
    // arbitrary positions doesn't change the screenshot. So no cursor-parking
    // needed; that just jerks the user's cursor around pointlessly.
    const buf = await captureScreenshot();
    return buf.toString('base64');
  }

  /** Wrap a raw screenshot with an overlay the LLM can use to reason about
   *  coordinates: a 100px coordinate grid, plus a red crosshair at the last
   *  click position if the previous action was a click. This gives the model
   *  two things vanilla screenshots don't:
   *    • Absolute spatial reference (grid with labels like "X200 Y300")
   *    • Feedback on where the last click actually landed, so a missed click
   *      can be corrected by delta rather than re-guessed from scratch.
   *  The original clean screenshot is retained for hash-based no-op detection;
   *  annotation only applies to the image sent to the LLM. */
  async _annotateForLLM(pngBase64) {
    try {
      return await annotateScreenshot(pngBase64, {
        grid: true,
        lastClick: this._lastClickCoords || null,
      });
    } catch (err) {
      log.warn(COMP, `annotation failed, sending raw screenshot: ${err.message}`);
      return pngBase64;
    }
  }

  /** SHA-256 of the screenshot bytes. Used for no-op detection between
   *  consecutive frames. PNG headers include timestamps so byte-identical
   *  matches are rare unless literally nothing on screen changed (no cursor
   *  movement, no clock tick, no animation) — a reliable signal that the
   *  preceding action had zero visible effect. */
  _hashScreenshot(base64) {
    return crypto.createHash('sha256').update(base64).digest('hex').slice(0, 16);
  }

  /** Snapshot current open windows via wmctrl. Returns a Map of window ID →
   *  title, or null if wmctrl is unavailable. Used to detect if the agent
   *  accidentally closed a pre-existing user window (browser, IDE, etc.)
   *  via a stray click on an X button or an overlooked destructive action. */
  async _snapshotWindows() {
    try {
      const { stdout } = await execFileP('wmctrl', ['-l'], { timeout: 2000 });
      const windows = new Map();
      for (const line of stdout.split('\n')) {
        // Format: "0x0123abc4  0 hostname  window title here"
        const match = line.match(/^(0x[0-9a-f]+)\s+\S+\s+\S+\s+(.*)$/);
        if (match) windows.set(match[1], match[2]);
      }
      return windows;
    } catch (err) {
      log.warn(COMP, `wmctrl snapshot failed (${err.message}) — window-close protection disabled for this run`);
      return null;
    }
  }

  /** Compare current window list against the initial snapshot. Returns an
   *  array of {id, title} for any windows that existed at task start but
   *  are now gone — these are presumed to have been closed by the agent. */
  async _detectClosedWindows() {
    if (!this._initialWindows) return [];
    const current = await this._snapshotWindows();
    if (!current) return [];  // snapshot failed → can't detect
    const closed = [];
    for (const [id, title] of this._initialWindows) {
      if (!current.has(id)) closed.push({ id, title });
    }
    return closed;
  }

  _screenshotMessage(text, base64) {
    return new HumanMessage({
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
      ],
    });
  }

  async _callLLM(messages) {
    this.stats.llmCalls++;
    // Record every routing decision invoke() makes for this single call
    // (key-rotated, provider-switched, rate-limited, and the final `call`).
    // Also update the live phase detail so the UI shows WHICH model is being
    // tried right now (the indicator was previously just "Calling LLM" with
    // no hint whether Gemini or Groq was on the line).
    const stepLabel = `step ${this.stats.steps}`;
    const onMeta = (m) => {
      if (!this._currentStepMeta) this._currentStepMeta = { llm: null, events: [] };
      if (m.event === 'call') {
        // Successful response from this call path — record final provenance.
        this._currentStepMeta.llm = { provider: m.provider, model: m.model, keyName: m.keyName };
        // Count per-provider calls. Stats object grows dynamically as new
        // providers are used — no hardcoded gemini/groq keys.
        this.stats[m.provider] = (this.stats[m.provider] || 0) + 1;
      } else if (m.event === 'selected') {
        // Emitted by invoke() right before each network attempt — update the
        // phase indicator so the UI shows WHICH model is on the line right
        // now (including through rotations and provider switches).
        const usageStr = m.usage?.limits
          ? ` (${m.usage.rpm}/${m.usage.limits.rpm ?? '∞'} rpm, ${m.usage.rpd}/${m.usage.limits.rpd ?? '∞'} rpd)`
          : '';
        this._setPhase('thinking', `${stepLabel} — calling ${m.provider}/${m.model}${m.keyName ? `·${m.keyName}` : ''}${usageStr}`);
      } else {
        this._currentStepMeta.events.push(m);
        if (m.event === 'rate-limited') {
          this._setPhase('thinking', `${stepLabel} — ${m.provider}/${m.model} rate-limited, rotating…`);
        } else if (m.event === 'key-rotated') {
          this._setPhase('thinking', `${stepLabel} — ${m.provider} key ${m.from}→${m.to}`);
        } else if (m.event === 'provider-switched') {
          this._setPhase('thinking', `${stepLabel} — switching to ${m.to}/${m.model}${m.reason ? ` (${m.reason})` : ''}`);
        } else if (m.event === 'model-switched') {
          this._setPhase('thinking', `${stepLabel} — same provider, trying ${m.provider}/${m.to} instead of ${m.from}`);
        } else if (m.event === 'model-unavailable') {
          this._setPhase('thinking', `${stepLabel} — ${m.provider}/${m.model} endpoint 404, skipping`);
        } else if (m.event === 'waiting-rate-limit') {
          if (m.reason === 'reactive-all-slots') {
            this._setPhase('waiting-rpm', `${stepLabel} — all keys rate-limited; sleeping ${Math.ceil(m.waitMs / 1000)}s for shortest reset`);
          } else if (m.reason === 'rpm-margin') {
            this._setPhase('waiting-rpm', `${stepLabel} — pacing ${m.provider}/${m.model}·${m.keyName} at ${m.usage?.rpm}/${m.usage?.limits?.rpm} (safety margin); sleeping ${Math.ceil(m.waitMs / 1000)}s`);
          } else {
            this._setPhase('waiting-rpm', `${stepLabel} — ${m.provider}/${m.model}·${m.keyName} at cap (${m.usage?.rpm}/${m.usage?.limits?.rpm}); sleeping ${Math.ceil(m.waitMs / 1000)}s`);
          }
        } else if (m.event === 'skipped-rate-limit') {
          this._setPhase('thinking', `${stepLabel} — skipping ${m.provider}/${m.model}·${m.keyName} (${m.reason})`);
        }
      }
    };
    this._setPhase('thinking', `${stepLabel} — preparing LLM call`);
    try {
      // Vision is required — screenshots are always in the message thread.
      // invoke() already rotates keys and falls back to a second provider on
      // rate limits, so one call is enough. Don't pin a provider here — let
      // invoke() use the user's currentProvider (set via the config UI); it
      // will still fall back automatically on rate-limit / quota errors.
      const response = await invoke(messages, { onMeta });
      const text = typeof response.content === 'string'
        ? response.content
        : response.content?.map(c => c.text || '').join('') || '';
      return text;
    } catch (err) {
      const msg = err?.message || String(err);
      log.error(COMP, `vision LLM call failed: ${msg}`);
      // Do NOT fall back to text-only — the agent relies on screenshots to
      // decide actions. A blind LLM hallucinates coordinates and burns
      // quota on garbage. Surface the error and let the loop fail.
      this._lastLlmError = msg;
      return null;
    }
  }

  _parseAction(text) {
    // The LLM should return pure JSON, but sometimes wraps it in markdown
    // code fences or adds explanation before/after.
    try {
      // Try direct parse first
      return JSON.parse(text);
    } catch {
      // Try extracting JSON from code fences
      const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) {
        try { return JSON.parse(fenceMatch[1]); } catch {}
      }
      // Try finding a JSON object anywhere in the text
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch {}
      }
      log.warn(COMP, `failed to parse LLM response as JSON: ${text.slice(0, 200)}`);
      return null;
    }
  }

  /** Coerce a click coordinate to a valid pixel integer. Some vision models
   *  (notably Llama 4 Scout on Groq) default to normalized [0-1] coordinates
   *  even when we ask for pixels — clicking at (0.12, 0.14) would land at
   *  (0, 0). Detect the normalized case and rescale; otherwise just clamp to
   *  screen bounds. Returns null if coords are missing or unusable. */
  _normalizeClickCoords(params) {
    const { width, height } = this.screenSize || { width: 0, height: 0 };
    let { x, y } = params;
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) {
      return null;
    }
    const looksNormalized = x > 0 && x < 1 && y > 0 && y < 1;
    if (looksNormalized && width > 0 && height > 0) {
      const nx = Math.round(x * width);
      const ny = Math.round(y * height);
      log.warn(COMP, `model returned normalized coords (${x}, ${y}); rescaling to pixels (${nx}, ${ny})`);
      x = nx; y = ny;
    }
    x = Math.max(0, Math.min(Math.round(x), (width || 10000) - 1));
    y = Math.max(0, Math.min(Math.round(y), (height || 10000) - 1));
    return { x, y };
  }

  /** Strings that, if typed into ANY terminal, would change system state in
   *  unsafe ways: package installers, privilege escalation, file destruction,
   *  power commands. The model should never emit these; if it does (whether
   *  by hallucination or prompt-injection from screen text), the type_text
   *  action is refused and the model is told to fail the task instead. */
  _isDangerousTypedCommand(text) {
    if (typeof text !== 'string' || !text.trim()) return false;
    // Normalize — lowercase, collapse whitespace, strip trailing newline
    const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
    // Match command at start of string OR after any common shell prefix
    const dangerous = [
      // privilege escalation
      /\b(sudo|su|doas|pkexec)\b\s/,
      // package managers — INSTALL action specifically
      /\b(apt|apt-get|aptitude|dnf|yum|pacman|zypper|apk|emerge)\b\s.*\b(install|add|-s|-u|-sy|-syu|upgrade|update)\b/,
      /\b(snap|flatpak|brew|nix-env|nix-shell)\b\s.*\b(install|add)\b/,
      /\b(pip|pip3|uv|poetry|conda)\b\s+install\b/,
      /\b(npm|yarn|pnpm|bun)\b\s+(i|install|add|global\s+install|-g)\b/,
      /\b(gem|cargo|go)\b\s+install\b/,
      // network-to-shell pipes
      /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|zsh|ksh|fish|cmd|powershell|pwsh)\b/,
      // power / session
      /\b(shutdown|reboot|poweroff|halt|init\s+[06])\b/,
      /\bsystemctl\s+(stop|disable|kill|reboot|poweroff|halt)\b/,
      // destructive file ops
      /\brm\s+-[rf]*r[rf]*\b.*\/(\s|$)/,    // rm -rf /  or  rm -r -f /
      /\bdd\s+.*\bof=\//,                    // dd of=/anything
      /\bmkfs\b/,                             // filesystem creation
      />\s*\/dev\/(sd|nvme|hd|xvd)/,         // pipe to raw disk
      // aggressive process kill
      /\bkill\s+-9\s+-?1\b/,                 // kill -9 -1 / init
      /\bkillall\s+-9\b/,
    ];
    return dangerous.some(re => re.test(s));
  }

  /** Destructive keystroke combos that CLOSE whatever window currently has
   *  focus. We block these at the action layer because models (especially
   *  Llama 4 Scout) routinely hallucinate that a freshly-opened window is
   *  focused when it isn't, then "close" the browser/terminal/whatever-
   *  the-user-was-using. Blocking here trumps any prompt-level rule the
   *  model might ignore. Format: normalized combos (lowercase, sorted by
   *  modifier, single main key). */
  _isDestructiveKeyCombo(keys) {
    if (!Array.isArray(keys) || keys.length === 0) return false;
    const norm = keys.map(k => String(k).toLowerCase().trim()).sort().join('+');
    // All close/kill intents
    return [
      'control+w',            // close tab / document
      'control+shift+w',      // close all tabs / window
      'control+q',            // quit application
      'alt+f4',               // close window (Windows / X11 convention)
      'control+alt+delete',   // system security / task manager
      'super+q',              // quit on some DEs
      'control+shift+q',      // quit-all on some apps
    ].includes(norm);
  }

  async _executeAction(action, params = {}) {
    // Hard guard: block close-class keyboard shortcuts. These are destructive
    // to windows the agent didn't open and have bitten users repeatedly (the
    // model closes a browser tab thinking it's closing Text Editor). No task
    // this agent does currently REQUIRES closing a window — if the user wants
    // a window closed at the end, they can do it themselves.
    if (action === 'press_keys' && this._isDestructiveKeyCombo(params.keys)) {
      const combo = (params.keys || []).join('+');
      log.warn(COMP, `BLOCKED destructive key combo: ${combo}`);
      throw new Error(
        `Action blocked: "${combo}" would close or quit a window, which is not ` +
        `permitted. The agent must NEVER close windows (the user has unsaved work ` +
        `in their browser / IDE / other apps). Emit "done" if the functional part ` +
        `of the task is complete; the user will close windows themselves.`
      );
    }

    switch (action) {
      case 'click': {
        const coords = this._normalizeClickCoords(params);
        if (!coords) throw new Error(`click action missing or invalid x/y: ${JSON.stringify(params)}`);
        await moveMouse({ x: coords.x, y: coords.y });
        await clickMouse({
          button: params.button || 'left',
          double: params.double || false,
        });
        // Remember so the NEXT screenshot's annotation can show the LLM
        // exactly where this click landed relative to its intended target.
        this._lastClickCoords = { x: coords.x, y: coords.y };
        break;
      }

      case 'type':
        if (this._isDangerousTypedCommand(params.text)) {
          const preview = (params.text || '').slice(0, 80);
          log.warn(COMP, `BLOCKED dangerous typed command: ${preview}`);
          throw new Error(
            `Action blocked: typing "${preview}${params.text.length > 80 ? '…' : ''}" ` +
            `was refused because it contains an install / privilege-elevation / ` +
            `destructive command. The agent must NEVER install software or run ` +
            `sudo. If the task seems to require this, emit "fail" with reason ` +
            `"app not found" or similar — do not attempt to install or elevate.`
          );
        }
        await typeText(params.text);
        break;

      case 'press_keys':
        await pressKeys(params.keys);
        break;

      case 'scroll': {
        // No native scroll in kraken-core yet. Simulate via keyboard.
        const key = params.direction === 'up' ? 'pageup' : 'pagedown';
        const amount = params.amount || 3;
        for (let i = 0; i < amount; i++) {
          await pressKeys([key]);
          await this._sleep(50);
        }
        break;
      }

      case 'wait':
        await this._sleep(params.ms || 1000);
        break;

      case 'screenshot':
        // No physical action — the loop will take a screenshot anyway
        break;

      default:
        throw new Error(`unknown action: ${action}`);
    }
  }

  /**
   * Remove old image content blocks from the conversation to keep the context
   * window manageable. Keeps the most recent MAX_IMAGES_IN_CONTEXT images.
   * Older ones are replaced with text placeholders.
   */
  _trimOldImages(messages) {
    let imageCount = 0;
    // Count from the end (newest first)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!Array.isArray(msg.content)) continue;
      const hasImage = msg.content.some(c => c.type === 'image_url');
      if (!hasImage) continue;

      imageCount++;
      if (imageCount > MAX_IMAGES_IN_CONTEXT) {
        // Replace image blocks with text placeholder
        const textParts = msg.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join(' ');
        messages[i] = new HumanMessage(
          textParts + ' [screenshot removed to save context — see thought for description]'
        );
      }
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  _result(success, summary) {
    this._setPhase('idle', '');
    log.info(COMP, `${success ? 'SUCCESS' : 'FAILED'}: ${summary}`);
    return {
      status: success ? 'done' : 'failed',
      success,
      summary,
      steps: this.stats.steps,
      history: this.history,
      stats: { ...this.stats },
    };
  }

  /** Agent emitted a `pause` action. Stores the conversation so a later
   *  resume() call can pick up with a fresh screenshot. */
  _pausedResult(reason, message, messages) {
    this._setPhase('paused', reason);
    log.info(COMP, `PAUSED (${reason}): ${message}`);
    this._pausedMessages = messages;
    return {
      status: 'paused',
      success: false,
      pauseReason: reason,
      pauseMessage: message,
      summary: `Paused: ${message}`,
      steps: this.stats.steps,
      history: this.history,
      stats: { ...this.stats },
    };
  }

  /**
   * Resume a paused run. Takes a fresh screenshot (the current screen may
   * differ significantly from where the agent paused — user may have
   * switched windows, navigated elsewhere, etc.) and re-enters the loop
   * with the existing conversation plus a note that the user resumed.
   *
   * @param {string} [userNote] - Optional message from the user explaining
   *   what they did (e.g. "I solved the captcha" or "entered OTP 482931")
   */
  async resume(userNote) {
    if (!this._pausedMessages) {
      throw new Error('no paused state — call run() first');
    }
    const messages = this._pausedMessages;
    this._pausedMessages = null;

    // Re-trim old images; the paused history may already have several
    this._trimOldImages(messages);

    // Append a note explaining the resume + a fresh screenshot.
    // IMPORTANT: the note must NOT tempt the model to act immediately on the
    // user-supplied value (e.g. type a code) before checking that the right
    // field/window is focused. The model must inspect the screenshot first,
    // navigate to the correct place if needed, click the target input to focus
    // it, and ONLY THEN act on the user's input.
    let resumeNote;
    if (userNote) {
      resumeNote =
        `User clicked Continue and provided this input: "${userNote}".\n\n` +
        `⚠ IMPORTANT — do NOT act on this input yet. First:\n` +
        `1. Study the screenshot below carefully.\n` +
        `2. Verify you are in the correct application and the correct screen/modal is visible.\n` +
        `   If the wrong app or window is in focus, navigate back to the right one first.\n` +
        `3. Click the specific input field where the user's input belongs to give it focus.\n` +
        `4. THEN type or use the user's input.\n\n` +
        `Only skip steps 2–3 if the screenshot already clearly shows the correct field is focused.`;
    } else {
      resumeNote =
        `User clicked Continue. Take a fresh look at the screenshot below — the screen may ` +
        `have changed since you paused (user may have switched windows, navigated elsewhere, ` +
        `or completed intermediate steps). Decide the correct next action based on what you see.`;
    }
    messages.push(new HumanMessage(resumeNote));
    const newShot = await this._takeScreenshot();
    // After a pause, whatever the user did invalidates the last-click hint —
    // clear it and send a fresh annotated (grid-only) screenshot.
    this._lastClickCoords = null;
    const newShotForLLM = await this._annotateForLLM(newShot);
    messages.push(this._screenshotMessage('Current screen state after resume:', newShotForLLM));

    // Re-enter the main loop from step count + 1
    return this._runLoop(messages);
  }
}
