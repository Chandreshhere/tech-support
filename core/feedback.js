// Constant feedback loop: take a screenshot on a heartbeat AND on every
// "interesting" input event so a model driving the system always has a fresh
// view of what just happened.
//
// Triggers:
//   - Heartbeat: setInterval at `intervalMs` (default 3000). Always fires
//     directly via captureNow — never goes through the debounce path so it
//     can't cancel a pending event-driven capture.
//   - User input via uiohook: clicks (any button) and key presses. NOT user
//     mouse moves — those are explicitly excluded. Routed through the debounce
//     path so a burst (e.g. fast typing) coalesces into one capture.
//   - Synthesized input via inputEvents: type / key / click / move. The move
//     trigger fires AFTER the action's await resolves, i.e. after the cursor
//     has stopped (which is exactly what "movement stops" means here). Also
//     debounced.
//
// scheduleEventCapture(trigger, debounceMs) is the debounce funnel for event
// triggers. The heartbeat bypasses it entirely. Heartbeat captures and event
// captures can run concurrently — screenshot.js serializes the underlying
// screenshot tool, so they queue up cleanly without colliding.
//
// Storage: bounded ring buffer (default 10 entries × ~350 KB ≈ 3.5 MB).
// Each entry: { id, timestamp, trigger, pngBase64, pngBytes }.

import { acquireHook, releaseHook, getUiohookModule } from './_uiohook.js';
import { captureScreenshot } from './screenshot.js';
import { inputEvents } from './input.js';
import { ValidationError, CoreError } from './errors.js';

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_RING_SIZE = 10;
const MIN_RING_SIZE = 1;
const MAX_RING_SIZE = 100;
const MIN_INTERVAL_MS = 250;

// Per-event-trigger debounce. Bursts of the same kind of event coalesce into
// one capture taken `debounceMs` after the LAST event in the burst. Heartbeat
// is intentionally NOT in this map — it bypasses the debounce path entirely.
const DEBOUNCE_BY_TRIGGER = {
  'user.click':    50,
  'user.keypress': 250,
  'synth.type':    50,
  'synth.key':     50,
  'synth.click':   50,
  'synth.move':    50,
};

// State
let active = false;
let config = { intervalMs: DEFAULT_INTERVAL_MS, ringSize: DEFAULT_RING_SIZE };
let heartbeatTimer = null;
let pendingTimer = null;
let pendingTrigger = null;
let lastCaptureAt = 0;
let listenerHandles = null;
let synthListener = null;
let shutdownRegistered = false;

const ring = [];
let nextId = 1;
let totalCaptured = 0;
let totalDropped = 0;
let droppedSinceLastDrain = 0;
let lastError = null;
let clearEpoch = 0;  // monotonic counter; incremented by clearFeedback()

// ---------- Ring buffer ----------

function pushEntry(entry) {
  ring.push(entry);
  if (ring.length > config.ringSize) {
    ring.shift();
    totalDropped++;
    droppedSinceLastDrain++;
  }
  totalCaptured++;
}

// ---------- Capture funnel ----------

/**
 * Take a screenshot immediately and push it to the ring buffer with the
 * given trigger label. Concurrent calls are safe — screenshot.js serializes
 * the underlying screenshot tool. Failures are recorded in `lastError` and
 * do not crash the loop.
 */
async function captureNow(trigger) {
  const epochBefore = clearEpoch;
  let buf;
  try {
    buf = await captureScreenshot();
  } catch (err) {
    lastError = err instanceof CoreError ? err.message : (err && err.message ? err.message : String(err));
    return;
  }
  // If clear() was called while the screenshot was in flight, the caller
  // expects a clean slate. Discard this stale frame silently.
  if (epochBefore !== clearEpoch) return;
  lastCaptureAt = Date.now();
  pushEntry({
    id: nextId++,
    timestamp: lastCaptureAt,
    trigger,
    pngBase64: buf.toString('base64'),
    pngBytes: buf.length,
  });
}

/**
 * Reset the heartbeat timer so the next heartbeat fires a full `intervalMs`
 * from now. Called after event-driven captures so the heartbeat doesn't
 * redundantly capture the same screen state a few hundred ms later.
 */
function resetHeartbeat() {
  if (!heartbeatTimer || !active) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    captureNow('interval');
  }, config.intervalMs);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

/**
 * Debounce funnel for event-driven triggers (user click/keypress, synth
 * type/key/click/move). Cancels any pending event capture and schedules a
 * new one for `debounceMs` later — last trigger in the burst wins.
 *
 * The heartbeat does NOT call this; it calls captureNow directly so it
 * cannot cancel a pending event capture.
 *
 * After the capture completes, the heartbeat timer is reset so the next
 * heartbeat fires a full interval from now (avoiding a redundant capture
 * a few hundred ms later).
 */
function scheduleEventCapture(trigger, debounceMs) {
  if (!active) return;
  // When the model calls typeText/pressKeys/clickMouse, nut-js generates a
  // real OS-level event that uiohook picks up as a "user" event. That user
  // event arrives as a macrotask AFTER the synth event (which fires on the
  // microtask queue via the emit). If a synth trigger is already pending,
  // the incoming "user" event is almost certainly its echo — don't let it
  // override the more specific synth label.
  if (trigger.startsWith('user.') && pendingTrigger && pendingTrigger.startsWith('synth.')) {
    return;
  }
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTrigger = trigger;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    pendingTrigger = null;
    captureNow(trigger).then(() => { resetHeartbeat(); });
  }, debounceMs);
}

// ---------- uiohook listeners (user events) ----------

function attachUserListeners(uio) {
  const handles = {
    // Real user click of any button.
    click: () => scheduleEventCapture('user.click', DEBOUNCE_BY_TRIGGER['user.click']),
    // Real user keypress. Mouse moves intentionally NOT subscribed.
    keydown: () => scheduleEventCapture('user.keypress', DEBOUNCE_BY_TRIGGER['user.keypress']),
  };
  for (const [evt, handler] of Object.entries(handles)) {
    uio.uIOhook.on(evt, handler);
  }
  return handles;
}

function detachUserListeners(uio, handles) {
  if (!handles) return;
  for (const [evt, handler] of Object.entries(handles)) {
    try { uio.uIOhook.off(evt, handler); } catch {}
  }
}

// ---------- Synthesized event listener ----------

function makeSynthListener() {
  return (info) => {
    const trigger = `synth.${info.action}`;
    scheduleEventCapture(trigger, DEBOUNCE_BY_TRIGGER[trigger] ?? 50);
  };
}

// ---------- Shutdown ----------

function registerShutdownHooks() {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  process.once('beforeExit', () => {
    if (active) try { stopFeedback(); } catch {}
  });
}

// ---------- Public API ----------

/**
 * Start the feedback loop.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=3000] - Heartbeat interval. Min 250.
 * @param {number} [opts.ringSize=10] - How many recent screenshots to retain.
 *   Range: 1..100. Old entries get dropped FIFO.
 */
export function startFeedback({ intervalMs, ringSize } = {}) {
  if (active) return getFeedbackStatus();

  if (intervalMs !== undefined) {
    if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS) {
      throw new ValidationError(`intervalMs must be a finite number >= ${MIN_INTERVAL_MS}`);
    }
    config.intervalMs = intervalMs;
  }
  if (ringSize !== undefined) {
    if (!Number.isInteger(ringSize) || ringSize < MIN_RING_SIZE || ringSize > MAX_RING_SIZE) {
      throw new ValidationError(`ringSize must be an integer between ${MIN_RING_SIZE} and ${MAX_RING_SIZE}`);
    }
    config.ringSize = ringSize;
    // Trim if shrinking.
    while (ring.length > config.ringSize) {
      ring.shift();
      totalDropped++;
      droppedSinceLastDrain++;
    }
  }

  // Subscribe to uiohook for user clicks and keypresses. acquireHook is
  // refcounted so it doesn't conflict with capture.js running independently.
  let mod;
  try {
    mod = acquireHook();
    listenerHandles = attachUserListeners(mod);
  } catch (err) {
    // uiohook unavailable (no X11, Wayland, etc.). Feedback can still run
    // with just the heartbeat + synthesized events. Record the error so the
    // caller can see why user-input triggers won't fire.
    lastError = err instanceof CoreError ? err.message : (err && err.message ? err.message : String(err));
  }

  // Subscribe to synthesized input events from input.js.
  synthListener = makeSynthListener();
  inputEvents.on('synthesized', synthListener);

  // Start the heartbeat. Calls captureNow directly so it can never cancel
  // a pending event-driven capture.
  heartbeatTimer = setInterval(() => {
    captureNow('interval');
  }, config.intervalMs);
  // Don't pin the event loop just for the heartbeat.
  if (heartbeatTimer.unref) heartbeatTimer.unref();

  registerShutdownHooks();
  active = true;
  // Take an immediate first screenshot so the model has a baseline as soon
  // as the loop starts.
  captureNow('manual');
  return getFeedbackStatus();
}

export function stopFeedback() {
  if (!active) return getFeedbackStatus();

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingTrigger = null;
  }
  if (synthListener) {
    inputEvents.off('synthesized', synthListener);
    synthListener = null;
  }
  if (listenerHandles) {
    try { detachUserListeners(getUiohookModule(), listenerHandles); } catch {}
    listenerHandles = null;
    releaseHook();
  }
  active = false;
  return getFeedbackStatus();
}

/**
 * Drain captured screenshots with id > since. Returns up to `limit` entries
 * (default 1 — the most recent). Pass the previous response's `nextSince` as
 * `since` for incremental polling.
 *
 * The default limit of 1 keeps the response small; the model can ask for
 * more frames if it wants to compare them.
 */
export function drainFeedback(since = 0, limit = 1) {
  if (since === null || since === undefined) since = 0;
  if (limit === null || limit === undefined) limit = 1;
  if (!Number.isFinite(since) || since < 0) {
    throw new ValidationError('since must be a non-negative finite number');
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_RING_SIZE) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_RING_SIZE}`);
  }

  // Collect entries with id > since. Most-recent-first when limit < ring size
  // so the caller gets the freshest frames if they only ask for a few.
  const matches = ring.filter((e) => e.id > since);
  // Tail of the matches (the latest `limit` entries).
  const tail = matches.length > limit ? matches.slice(matches.length - limit) : matches;

  const dropped = droppedSinceLastDrain;
  droppedSinceLastDrain = 0;
  return {
    entries: tail,
    nextSince: tail.length ? tail[tail.length - 1].id : since,
    droppedSinceLastDrain: dropped,
    bufferSize: ring.length,
    totalCaptured,
    totalDropped,
    active,
    config: { ...config },
  };
}

export function getFeedbackStatus() {
  return {
    active,
    bufferSize: ring.length,
    bufferCapacity: config.ringSize,
    intervalMs: config.intervalMs,
    nextId,
    totalCaptured,
    totalDropped,
    pendingTrigger,
    lastCaptureAt,
    ...(lastError && { lastError }),
  };
}

export function clearFeedback() {
  clearEpoch++;  // invalidate any in-flight captures started before now
  ring.length = 0;
  droppedSinceLastDrain = 0;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingTrigger = null;
  }
  return getFeedbackStatus();
}

/**
 * Force-stop the feedback loop. Intended for graceful shutdown by the host
 * process. Idempotent.
 */
export function shutdownFeedback() {
  if (active) {
    try { stopFeedback(); } catch {}
  }
}
