// Multi-provider LLM service. Adapted from the Kraken reference project
// (~/Documents/Yatharthk/Kraken/backend/src/ai-agent/llm.service.js).
//
// Two providers: Groq (text-only, fast, default for non-vision tasks) and
// Gemini (vision-capable, used for screenshot analysis — the primary workhorse
// of the agent loop).
//
// Features beyond Kraken:
//   - Auto-fallback: if a call fails with quota/rate-limit, rotate key then
//     switch provider before retrying.
//   - invokeWithVision(): always routes to Gemini for multimodal input.
//   - rotateKey(): cycles to the next available key for a provider.

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as log from './logger.js';
import { checkCall, recordCall, snapshot as rateLimitSnapshot, reset as resetRateLimits } from './rate-limits.js';

const COMP = 'llm';

// ---------- Model catalogs ----------

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', vision: true },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', vision: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', vision: true },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', vision: true },
];

const GROQ_MODELS = [
  // Vision-capable (preview) — preferred when the request contains images.
  // Accepts OpenAI-format image_url blocks with base64 data URIs. Limits:
  // 5 images per request, 4MB base64 per image, 33MP resolution.
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (vision)', vision: true },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', vision: false },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', vision: false },
  { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B', vision: false },
];

// OpenRouter aggregates many providers behind one OpenAI-compatible endpoint.
// Paid models (no :free suffix) run on the account's credit balance — no RPD
// cap, generous RPM, SOTA GUI grounding. :free variants fall back when paid
// credit is exhausted. Listed in descending capability order.
const OPENROUTER_MODELS = [
  // PAID — purpose-trained for GUI grounding, outputs absolute pixel coords
  // natively (no normalization rescaling needed). Recommended primary model.
  { id: 'qwen/qwen2.5-vl-72b-instruct', name: 'Qwen2.5-VL 72B (vision, paid)', vision: true },
  { id: 'qwen/qwen2.5-vl-32b-instruct', name: 'Qwen2.5-VL 32B (vision, paid)', vision: true },
  // FREE — fallback only. Availability fluctuates; 404s gracefully skip.
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B (vision, free)', vision: true },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B MoE (vision, free)', vision: true },
  { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B (vision, free)', vision: true },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'Nemotron Nano 12B VL (vision, free)', vision: true },
  { id: 'google/gemma-3-12b-it:free', name: 'Gemma 3 12B (vision, free)', vision: true },
  { id: 'google/gemma-3-4b-it:free', name: 'Gemma 3 4B (vision, free)', vision: true },
];

const PROVIDERS = {
  gemini:     { name: 'Google Gemini', models: GEMINI_MODELS,     prefix: 'GEMINI_API_KEY_' },
  groq:       { name: 'Groq',          models: GROQ_MODELS,       prefix: 'GROQ_API_KEY_' },
  openrouter: { name: 'OpenRouter',    models: OPENROUTER_MODELS, prefix: 'OPENROUTER_API_KEY_' },
};

// ---------- Key discovery & rotation ----------

function discoverKeys(prefix) {
  const keys = {};
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (envKey.startsWith(prefix) && envVal) {
      keys[envKey.slice(prefix.length)] = envVal;
    }
  }
  return keys;
}

// Keys, active-key pointer, and dead-key set per provider. Built from the
// PROVIDERS registry so adding a new provider just means adding one entry
// above — no hardcoded gemini/groq references here.
const providerKeys = {};
const activeKey = {};
const deadKeys = {};
for (const p of Object.keys(PROVIDERS)) {
  providerKeys[p] = discoverKeys(PROVIDERS[p].prefix);
  activeKey[p] = process.env[`LLM_${p.toUpperCase()}_KEY_NAME`] || Object.keys(providerKeys[p])[0] || null;
  deadKeys[p] = new Set();
}

function isDailyQuotaExhausted(errMsg) {
  return /per.?day|daily|FreeTier|quota.*exceeded/i.test(errMsg || '');
}

/** Return the first vision-capable model id for a provider, or null if none. */
function firstVisionModel(provider) {
  const m = PROVIDERS[provider]?.models.find(m => m.vision);
  return m ? m.id : null;
}

/** Check if the outgoing message array contains any image_url content blocks. */
function messagesHaveImages(messages) {
  return messages.some(m =>
    Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
  );
}

// Max time we'll sit and wait on a per-minute window to clear before giving
// up and rotating to another key / provider. 25s < 60s so we always have a
// chance to succeed on the same slot, but short enough that the user doesn't
// stare at a frozen UI if every key is near its cap.
const MAX_RPM_WAIT_MS = 25_000;

// After all slots have been tried reactively (each got a 429/503 with a
// retry-after hint), we'll sleep for the SHORTEST retry window and retry
// the whole sweep — but only if that wait is reasonable. Longer than this
// and we fail the run so the user can intervene (add keys, upgrade tier).
// 10 minutes is a sensible ceiling for an interactive agent.
const MAX_REACTIVE_WAIT_MS = 10 * 60 * 1000;

/** One gated call attempt. Respects rate limits up front:
 *   - If within limits → call immediately
 *   - If RPM cap hit with short wait → sleep, then call
 *   - If RPD cap hit, or RPM wait too long → return { skipped: true } so the
 *     caller can rotate to another key/provider without burning a round-trip.
 *  Records the call in the rate-limit tracker on success.
 */
async function gatedAttempt({ provider, model, keyName, messages, callOpts, onMeta }) {
  const check = checkCall(provider, model, keyName);
  if (!check.ok) {
    // Both 'rpm' (hit the real cap) and 'rpm-margin' (hit our safety margin
    // before the cap) use the same recovery path: sleep until the oldest
    // in-window request rolls off, then call. The only difference is the
    // UI label so the user knows whether they're being paced preemptively
    // or reacting to a hard limit.
    const isRpmClass = check.reason === 'rpm' || check.reason === 'rpm-margin';
    if (isRpmClass && check.waitMs <= MAX_RPM_WAIT_MS) {
      const label = check.reason === 'rpm-margin' ? 'safety margin' : 'hard RPM cap';
      log.info(COMP, `${provider}/${model}·${keyName} at ${label} (${check.usage.rpm}/${check.usage.limits?.rpm}); sleeping ${check.waitMs}ms before call`);
      onMeta({ event: 'waiting-rate-limit', provider, model, keyName, reason: check.reason, waitMs: check.waitMs, usage: check.usage });
      await new Promise(r => setTimeout(r, check.waitMs));
    } else {
      // RPD hit or wait too long — tell caller to try another slot
      log.info(COMP, `${provider}/${model}·${keyName} rate-limit gate: skip (${check.reason}, wait=${check.waitMs}ms)`);
      onMeta({ event: 'skipped-rate-limit', provider, model, keyName, reason: check.reason, waitMs: check.waitMs, usage: check.usage });
      return { skipped: true, reason: check.reason };
    }
  }

  const llm = createLLM(provider, model);
  onMeta({ event: 'selected', provider, model, keyName, usage: check.usage });
  const response = await llm.invoke(messages, callOpts);
  recordCall(provider, model, keyName);
  onMeta({ event: 'call', provider, model, keyName });
  return { response };
}

/**
 * Re-scan env vars for keys and active-key selectors. Call this after
 * updating process.env at runtime (e.g. the backend pushing API keys from
 * its config store before starting an agent run). Clears cached LLM
 * instances so they pick up the new keys on next call.
 */
export function reloadKeys() {
  for (const p of Object.keys(PROVIDERS)) {
    providerKeys[p] = discoverKeys(PROVIDERS[p].prefix);
    activeKey[p] = process.env[`LLM_${p.toUpperCase()}_KEY_NAME`] || Object.keys(providerKeys[p])[0] || null;
    deadKeys[p].clear();
  }
  // ALSO re-read the active provider/model env vars — otherwise the module's
  // initial values (loaded before the backend pushed config into env) stay
  // cached and the UI's "active provider" selection never takes effect.
  const envProvider = process.env.LLM_MODEL?.toLowerCase();
  if (envProvider && PROVIDERS[envProvider]) {
    currentProvider = envProvider;
  }
  const envModel = process.env[`${currentProvider.toUpperCase()}_MODEL`];
  if (envModel && PROVIDERS[currentProvider]?.models.some(m => m.id === envModel)) {
    currentModel = envModel;
  } else {
    // Fall back to first model of active provider
    currentModel = PROVIDERS[currentProvider].models[0].id;
  }
  resetRateLimits();
  for (const k of Object.keys(instanceCache)) delete instanceCache[k];
  const summary = {};
  for (const p of Object.keys(PROVIDERS)) summary[p] = Object.keys(providerKeys[p]);
  log.info(COMP, 'reloaded keys from env', {
    keys: summary,
    active: { ...activeKey },
    currentProvider, currentModel,
  });
}

function getApiKey(provider) {
  const keys = providerKeys[provider];
  return keys[activeKey[provider]] || Object.values(keys)[0] || null;
}

/**
 * Rotate to the next available key for a provider. Returns the new key name,
 * or null if no other keys exist.
 */
export function rotateKey(provider) {
  const keys = Object.keys(providerKeys[provider]);
  if (keys.length <= 1) return null;
  const currentIdx = keys.indexOf(activeKey[provider]);
  const nextIdx = (currentIdx + 1) % keys.length;
  activeKey[provider] = keys[nextIdx];
  log.info(COMP, `rotated ${provider} key → ${activeKey[provider]}`);
  return activeKey[provider];
}

// ---------- LLM instances ----------

let currentProvider = (process.env.LLM_MODEL?.toLowerCase()) || 'gemini';
let currentModel = currentProvider === 'groq'
  ? (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile')
  : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');

// Cache per provider+model+key so we don't recreate on every call.
const instanceCache = {};

function cacheKey(provider, model) {
  return `${provider}:${model}:${activeKey[provider]}`;
}

function createLLM(provider, model) {
  const key = cacheKey(provider, model);
  if (instanceCache[key]) return instanceCache[key];

  const apiKey = getApiKey(provider);
  if (!apiKey) throw new Error(`no API key for ${provider}`);

  let instance;
  // maxRetries=0 everywhere so quota/rate-limit errors surface immediately;
  // our own invoke() handles rotation and provider fallback. LangChain's
  // default (6 retries with backoff) would add 30+ seconds before we even
  // see the failure — unacceptable for an interactive agent.
  if (provider === 'groq') {
    instance = new ChatGroq({ apiKey, model, maxRetries: 0 });
  } else if (provider === 'gemini') {
    instance = new ChatGoogleGenerativeAI({ apiKey, model, maxRetries: 0 });
  } else if (provider === 'openrouter') {
    // OpenRouter is OpenAI-compatible; just override the base URL. The
    // headers are optional but recommended by OpenRouter for attribution.
    instance = new ChatOpenAI({
      apiKey,
      model,
      maxRetries: 0,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/YatharthKaushal/kraken-assist',
          'X-Title': 'kraken-assist',
        },
      },
    });
  } else {
    throw new Error(`unknown provider: ${provider}`);
  }
  instanceCache[key] = instance;
  return instance;
}

// ---------- Public: config + switching ----------

export function getConfig() {
  return {
    activeProvider: currentProvider,
    activeModel: currentModel,
    activeKeys: { ...activeKey },
    keys: {
      gemini: Object.keys(providerKeys.gemini),
      groq:   Object.keys(providerKeys.groq),
    },
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id, name: p.name, models: p.models,
    })),
  };
}

export function switchModel(provider, model) {
  if (!PROVIDERS[provider]) {
    throw new Error(`invalid provider "${provider}". supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  const models = PROVIDERS[provider].models;
  const valid = model || models[0].id;
  if (!models.some(m => m.id === valid)) {
    throw new Error(`invalid model "${valid}" for ${provider}`);
  }
  currentProvider = provider;
  currentModel = valid;
  log.info(COMP, `switched to ${provider}/${valid}`);
  return getConfig();
}

export function switchKey(provider, keyName) {
  if (!providerKeys[provider]) throw new Error(`invalid provider "${provider}"`);
  if (!providerKeys[provider][keyName]) {
    throw new Error(`key "${keyName}" not found for ${provider}. available: ${Object.keys(providerKeys[provider]).join(', ')}`);
  }
  activeKey[provider] = keyName;
  log.info(COMP, `switched ${provider} key → ${keyName}`);
  return getConfig();
}

export function getLLM(provider, model) {
  const p = provider || currentProvider;
  const m = model || (p === currentProvider ? currentModel : PROVIDERS[p].models[0].id);
  return createLLM(p, m);
}

// ---------- Error classification ----------

// Errors we treat as "try a different slot" — rate limits, quota exhaustion,
// and transient upstream overload (503 / "model overloaded" / "high demand").
// All of these can be resolved by rotating to another key or provider rather
// than failing the whole run. Non-matching errors (auth, 400 bad request,
// network errors) still throw through to the caller.
const TRANSIENT_PATTERNS = [
  /429/i, /quota/i, /rate.?limit/i, /resource.?exhausted/i, /too.?many.?requests/i,
  // 503 / transient upstream — Gemini specifically returns "503 Service
  // Unavailable: This model is currently experiencing high demand" when
  // overloaded, which should behave identically to a rate-limit for routing.
  /503/i, /service.?unavailable/i, /overload/i, /high.?demand/i, /try.?again.?later/i,
  // 502/504 — gateway / timeout flakes are also worth retrying on another slot
  /502/i, /504/i, /bad.?gateway/i, /gateway.?timeout/i,
];

function isTransientError(err) {
  const msg = err?.message || String(err);
  return TRANSIENT_PATTERNS.some(p => p.test(msg));
}

// Slot-specific failures: the request itself might be fine but THIS model /
// endpoint can't serve it. Skip the slot, try another. Includes:
//   - 404s / "model not found" / OpenRouter "No endpoints found"
//   - OpenRouter's generic "400 Provider returned error" — the upstream
//     provider rejected for reasons OpenRouter didn't relay (often capacity
//     / input limits specific to one model). Other models may still work.
const MODEL_SKIP_PATTERNS = [
  /404/, /no endpoints? found/i, /model not found/i, /invalid[_ ]model/i,
  /the model.*does not exist/i, /unknown model/i,
  /400[^0-9].*provider returned error/i,
];
function isModelMissingError(err) {
  const msg = err?.message || String(err);
  return MODEL_SKIP_PATTERNS.some(p => p.test(msg));
}

/** Parse a retry-after hint out of a provider error message.
 *  Supports:
 *    - "Please try again in 23.5s"            (Groq)
 *    - "Please retry in 14.263s"              (Gemini)
 *    - "retryDelay":"51s"                     (Gemini structured)
 *    - Retry-After header value (seconds)     (generic)
 *  Returns ms until retry, or null if nothing parseable.
 */
function parseRetryAfterMs(err) {
  const msg = err?.message || String(err);
  // "in 23.5s", "retry in 14s", "try again in 45.9s"
  const phraseMatch = msg.match(/(?:try again|retry|retryDelay)[^0-9]{0,10}([0-9.]+)\s*s/i);
  if (phraseMatch) {
    const seconds = parseFloat(phraseMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000 + 500);
  }
  // JSON-embedded "retryDelay":"51s"
  const jsonMatch = msg.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i);
  if (jsonMatch) {
    const seconds = parseFloat(jsonMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000 + 500);
  }
  return null;
}

// Kept as an alias so existing call sites read clearly; rate-limit is the
// most common transient class but not the only one.
const isRateLimitError = isTransientError;

// ---------- Public: invoke with auto-fallback ----------

/**
 * Call the LLM with auto-fallback. If the primary provider fails with a
 * rate-limit/quota error:
 *   1. Rotate to the next API key for that provider
 *   2. If no more keys, switch to the other provider
 *   3. Retry once
 *
 * @param {BaseMessage[]} messages - LangChain message array
 * @param {object} [opts]
 * @param {string} [opts.provider] - Override provider for this call
 * @param {string} [opts.model] - Override model for this call
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @returns {Promise<AIMessage>}
 */
export async function invoke(messages, opts = {}) {
  const onMeta = typeof opts.onMeta === 'function' ? opts.onMeta : () => {};
  const needsVision = messagesHaveImages(messages);

  // Pick the initial (provider, model). If the caller asked for a specific
  // provider/model we honor it; otherwise fall back to the session default.
  // If the request contains images, prefer a vision-capable model on the
  // chosen provider — we NEVER silently strip images and go blind.
  const pickModel = (p, override) => {
    if (override) return override;
    if (needsVision) {
      const vm = firstVisionModel(p);
      if (vm) return vm;
    }
    return p === currentProvider ? currentModel : PROVIDERS[p].models[0].id;
  };

  let provider = opts.provider || currentProvider;
  let model = pickModel(provider, opts.model);

  const allKeysDead = (p) => {
    const all = Object.keys(providerKeys[p]);
    return all.length > 0 && all.every(k => deadKeys[p].has(k));
  };
  const hasVision = (p) => PROVIDERS[p].models.some(m => m.vision);
  const hasUsableKeys = (p) => Object.keys(providerKeys[p]).length > 0 && !allKeysDead(p);

  // If the initial provider can't serve this request (no vision model when
  // needed, or all keys dead), hop to a better one up front. Iterate through
  // ALL other providers, not just one "alt" — with 3+ providers configured
  // we want any that can help.
  const needsChange = (needsVision && !hasVision(provider)) || !hasUsableKeys(provider);
  if (needsChange) {
    const candidates = Object.keys(PROVIDERS).filter(p => p !== provider && hasUsableKeys(p) && (!needsVision || hasVision(p)));
    if (candidates.length === 0) {
      throw new Error(`no viable provider — ${provider} cannot serve this request${needsVision ? ' (vision required)' : ''} and no other provider has usable keys`);
    }
    const next = candidates[0];
    const reason = needsVision && !hasVision(provider) ? 'vision-required' : 'all-keys-dead';
    const nextModel = pickModel(next, null);
    onMeta({ event: 'provider-switched', from: provider, to: next, model: nextModel, reason });
    provider = next;
    model = nextModel;
  }
  // Rotate off a dead key if the current active one is known-dead
  while (activeKey[provider] && deadKeys[provider].has(activeKey[provider])) {
    const rotated = rotateKey(provider);
    if (!rotated || deadKeys[provider].has(rotated)) break;
  }

  const callOpts = {};
  if (opts.temperature !== undefined) callOpts.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) callOpts.maxTokens = opts.maxTokens;

  // Build the ordered slot list: primary provider's models first (with the
  // caller-chosen model at the front), then every OTHER provider's models.
  // Within each slot, we'll rotate through all its keys.
  const modelsFor = (p) => {
    const ms = PROVIDERS[p].models;
    const filtered = needsVision ? ms.filter(m => m.vision) : ms;
    if (p === provider) {
      const idx = filtered.findIndex(m => m.id === model);
      if (idx > 0) {
        const [chosen] = filtered.splice(idx, 1);
        filtered.unshift(chosen);
      }
    }
    return filtered.map(m => m.id);
  };
  const providerOrder = [provider, ...Object.keys(PROVIDERS).filter(p => p !== provider && Object.keys(providerKeys[p]).length > 0)];
  const slots = [];
  for (const p of providerOrder) {
    for (const m of modelsFor(p)) slots.push({ p, m });
  }
  if (needsVision && slots.length === 0) {
    throw new Error('no vision-capable model available on any configured provider');
  }

  // Shortest retry-after hint seen in this sweep. If a provider returns
  // "try again in 23.5s" we'll collect it, and if the whole sweep fails,
  // sleep for the minimum and try again rather than failing the run.
  let shortestRetryMs = null;
  const rememberRetry = (err) => {
    const ms = parseRetryAfterMs(err);
    if (ms != null) {
      if (shortestRetryMs == null || ms < shortestRetryMs) shortestRetryMs = ms;
    }
  };

  // Record every 429/503/etc we still hit reactively (tracker might lag)
  const attempt = async (p, m, keyName, attempted) => {
    const slotId = `${p}:${m}:${keyName}`;
    if (attempted.has(slotId)) return { skipped: true, reason: 'already-tried' };
    attempted.add(slotId);
    try {
      return await gatedAttempt({ provider: p, model: m, keyName, messages, callOpts, onMeta });
    } catch (err) {
      // Model ID not currently served (e.g. OpenRouter delisted a :free
      // variant). Skip the slot but DON'T count it as a rate-limit or
      // dead-key — every other key on this provider will hit the same 404.
      if (isModelMissingError(err)) {
        log.warn(COMP, `${p}/${m} endpoint missing — skipping all keys on this model`, { error: err.message });
        onMeta({ event: 'model-unavailable', provider: p, model: m, keyName, error: err.message });
        return { skipped: true, reason: 'model-missing', error: err, allKeysOnModelUseless: true };
      }
      if (!isRateLimitError(err)) throw err;
      log.warn(COMP, `${p}/${m}·${keyName} transient error reactively`, { error: err.message });
      onMeta({ event: 'rate-limited', provider: p, model: m, keyName, error: err.message });
      rememberRetry(err);
      if (isDailyQuotaExhausted(err.message)) {
        deadKeys[p].add(keyName);
        log.info(COMP, `marked ${p} key ${keyName} as dead (daily quota)`);
      }
      return { skipped: true, reason: 'reactive-429', error: err };
    }
  };

  // One full sweep of every (provider, model, key) slot. Returns the
  // successful response if any slot answers, else null.
  const sweepAllSlots = async () => {
    const attempted = new Set();
    let lastErr = null;
    let prevSlot = null;
    for (const slot of slots) {
      if (!prevSlot || prevSlot.p !== slot.p) {
        if (prevSlot) onMeta({ event: 'provider-switched', from: prevSlot.p, to: slot.p, model: slot.m });
      } else if (prevSlot.m !== slot.m) {
        onMeta({ event: 'model-switched', provider: slot.p, from: prevSlot.m, to: slot.m });
      }
      prevSlot = slot;

      const allKeysForProvider = Object.keys(providerKeys[slot.p]);
      const startKey = activeKey[slot.p];
      if (!startKey) continue;
      const orderedKeys = [startKey, ...allKeysForProvider.filter(k => k !== startKey)];
      for (let i = 0; i < orderedKeys.length; i++) {
        const k = orderedKeys[i];
        if (deadKeys[slot.p].has(k)) continue;
        if (i > 0) {
          activeKey[slot.p] = k;
          onMeta({ event: 'key-rotated', provider: slot.p, model: slot.m, from: orderedKeys[0], to: k });
        }
        const result = await attempt(slot.p, slot.m, k, attempted);
        if (result.response) return { response: result.response };
        if (result.error) lastErr = result.error;
        // 404 / missing-model is an endpoint problem, not a key problem —
        // no point trying other keys on the same model, they'll 404 too.
        if (result.allKeysOnModelUseless) break;
      }
    }
    return { lastErr };
  };

  // Try up to a few full sweeps. If every slot reactively rate-limits, the
  // provider error messages often include a retry hint (e.g. "try again in
  // 23.5s"). Instead of failing, sleep for the shortest hint and re-sweep.
  // Caps at MAX_REACTIVE_WAIT_MS total sleep so the run doesn't freeze for
  // hours on a daily-quota scenario.
  let totalSlept = 0;
  let lastErr = null;
  for (let sweep = 0; sweep < 5; sweep++) {
    shortestRetryMs = null;
    const result = await sweepAllSlots();
    if (result.response) return result.response;
    lastErr = result.lastErr;

    // Decide whether to sleep and retry or give up.
    const canSleep = shortestRetryMs != null && shortestRetryMs + totalSlept <= MAX_REACTIVE_WAIT_MS;
    if (!canSleep) break;
    log.info(COMP, `all slots rate-limited; sleeping ${shortestRetryMs}ms before retry sweep (total slept: ${totalSlept}ms)`);
    onMeta({
      event: 'waiting-rate-limit',
      provider: '*', model: '*', keyName: 'all',
      reason: 'reactive-all-slots',
      waitMs: shortestRetryMs,
      usage: null,
    });
    await new Promise(r => setTimeout(r, shortestRetryMs));
    totalSlept += shortestRetryMs;
  }

  const hint = shortestRetryMs
    ? ` (shortest retry window was ${Math.ceil(shortestRetryMs / 1000)}s but cumulative wait would exceed ${MAX_REACTIVE_WAIT_MS / 1000}s)`
    : '';
  throw lastErr || new Error(`all ${slots.length} provider/model slots × their keys are rate-limited${hint}; add more API keys or wait for quotas to reset`);
}

/**
 * Return a copy of the message array with image content blocks replaced by
 * a text placeholder. Used when falling back from a vision provider to a
 * text-only one mid-request.
 */
function stripImagesFromMessages(messages) {
  return messages.map(m => {
    if (typeof m.content === 'string') return m;
    if (!Array.isArray(m.content)) return m;
    const textParts = m.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    // Preserve the message class (HumanMessage/SystemMessage/AIMessage) by
    // constructing a new one of the same type with string content.
    const Ctor = m.constructor;
    return new Ctor(textParts || '[screenshot omitted — text-only fallback]');
  });
}

/**
 * Call the LLM with a screenshot image. Always routes to Gemini (or the
 * first vision-capable provider) because Groq's text models can't process
 * images.
 *
 * @param {string} textPrompt - Text part of the message
 * @param {string} imageBase64 - PNG screenshot as base64 string
 * @param {object} [opts] - Same as invoke opts
 * @param {BaseMessage[]} [opts.prependMessages] - System/context messages to prepend
 * @returns {Promise<AIMessage>}
 */
export async function invokeWithVision(textPrompt, imageBase64, opts = {}) {
  // Find a vision-capable provider. Gemini first, then check Groq models.
  let visionProvider = 'gemini';
  let visionModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const messages = [];
  if (opts.prependMessages) {
    messages.push(...opts.prependMessages);
  }

  messages.push(new HumanMessage({
    content: [
      { type: 'text', text: textPrompt },
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${imageBase64}` },
      },
    ],
  }));

  return invoke(messages, {
    ...opts,
    provider: visionProvider,
    model: visionModel,
  });
}

// Re-export message classes for convenience
export { HumanMessage, SystemMessage };
// Re-export rate-limit inspection for UI / debug endpoints
export { rateLimitSnapshot };
