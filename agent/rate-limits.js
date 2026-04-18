// Proactive rate-limit tracker. Instead of catching 429s reactively (which
// wastes a round-trip and leaves the agent hanging while the provider
// returns the error), we maintain sliding windows of request timestamps per
// (provider, model, keyName) and gate every outgoing call against the known
// caps. If a call would exceed RPM, we can sleep until safe; if it would
// exceed RPD (daily), we treat the key as dead for the rest of the window.
//
// All limits are CONSERVATIVE free-tier defaults. Users on paid tiers can
// override via LLM_LIMIT_<PROVIDER>_<MODEL_SLUG>_{RPM,RPD} env vars.
//
// Limits are per-key (not shared across keys of the same provider), which
// matches how both Gemini and Groq enforce quotas in practice.

import * as log from './logger.js';

const COMP = 'rate-limits';

// Free-tier defaults. See:
//   - https://ai.google.dev/gemini-api/docs/rate-limits
//   - https://console.groq.com/docs/rate-limits
const DEFAULT_LIMITS = {
  // --- Gemini (free tier, per project) ---
  'gemini:gemini-2.5-flash':      { rpm: 10, rpd: 20 },
  'gemini:gemini-2.5-flash-lite': { rpm: 15, rpd: 1000 },
  'gemini:gemini-2.0-flash':      { rpm: 15, rpd: 200 },
  'gemini:gemini-3-flash-preview':{ rpm: 10, rpd: 100 },
  // --- Groq (free tier) ---
  'groq:meta-llama/llama-4-scout-17b-16e-instruct': { rpm: 30, rpd: 1000 },
  'groq:llama-3.3-70b-versatile': { rpm: 30, rpd: 1000 },
  'groq:llama-3.1-8b-instant':    { rpm: 30, rpd: 14400 },
  'groq:qwen/qwen3-32b':          { rpm: 30, rpd: 1000 },
  // --- OpenRouter paid — RPM scales with account credit; no hard daily cap
  // (limited by balance). Conservative default of 60 RPM leaves headroom.
  'openrouter:qwen/qwen2.5-vl-72b-instruct':          { rpm: 60 },
  'openrouter:qwen/qwen2.5-vl-32b-instruct':          { rpm: 60 },
  // --- OpenRouter :free tier — SHARED across all :free models per account.
  // 20 RPM / 50 RPD (200 RPD once account has ≥$10 lifetime credit).
  'openrouter:google/gemma-4-31b-it:free':            { rpm: 20, rpd: 50 },
  'openrouter:google/gemma-4-26b-a4b-it:free':        { rpm: 20, rpd: 50 },
  'openrouter:google/gemma-3-27b-it:free':            { rpm: 20, rpd: 50 },
  'openrouter:nvidia/nemotron-nano-12b-v2-vl:free':   { rpm: 20, rpd: 50 },
  'openrouter:google/gemma-3-12b-it:free':            { rpm: 20, rpd: 50 },
  'openrouter:google/gemma-3-4b-it:free':             { rpm: 20, rpd: 50 },
};

function envOverride(provider, model) {
  const slug = `${provider}_${model}`.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const rpm = parseInt(process.env[`LLM_LIMIT_${slug}_RPM`] || '', 10);
  const rpd = parseInt(process.env[`LLM_LIMIT_${slug}_RPD`] || '', 10);
  if (!Number.isFinite(rpm) && !Number.isFinite(rpd)) return null;
  return {
    ...(Number.isFinite(rpm) ? { rpm } : {}),
    ...(Number.isFinite(rpd) ? { rpd } : {}),
  };
}

export function getLimits(provider, model) {
  const key = `${provider}:${model}`;
  const defaults = DEFAULT_LIMITS[key];
  const override = envOverride(provider, model);
  if (!defaults && !override) return null;  // unlimited / unknown
  return { ...(defaults || {}), ...(override || {}) };
}

// Sliding window of call timestamps per (provider, model, keyName).
// Indexed by "provider:model:keyName".
const windows = {};

function winKey(provider, model, keyName) {
  return `${provider}:${model}:${keyName || '_default'}`;
}

function getWindow(provider, model, keyName) {
  const k = winKey(provider, model, keyName);
  if (!windows[k]) windows[k] = { timestamps: [] };
  return windows[k];
}

/** Record a successful (or attempted) call. Called AFTER a network attempt so
 *  failed-but-billed attempts also count against quota. */
export function recordCall(provider, model, keyName) {
  const w = getWindow(provider, model, keyName);
  w.timestamps.push(Date.now());
  // Prune entries older than 24h to keep memory bounded on long-lived procs
  const cutoff = Date.now() - 24 * 3600 * 1000;
  while (w.timestamps.length && w.timestamps[0] < cutoff) w.timestamps.shift();
}

// Safety margin for RPM — we pause preemptively at this fraction of the cap
// to leave headroom for clock drift, shared-key contention with other
// processes, and upstream re-wrapping that hides the real cap (OpenRouter's
// free tier goes through multiple providers each with their own per-minute
// caps that aren't surfaced). 0.85 = start waiting at 85% usage. Configurable
// via env: LLM_RPM_SAFETY_MARGIN=0.9 makes it more aggressive.
const RPM_SAFETY_MARGIN = parseFloat(process.env.LLM_RPM_SAFETY_MARGIN || '0.85');

/** Check whether a new call is safe to make RIGHT NOW.
 *  Applies a safety margin on RPM: gates at 85% of cap by default so a burst
 *  of 9/10 calls starts pacing instead of squeaking into a 429. RPD has no
 *  margin (only gates at the true cap) since pre-pausing wastes quota.
 *
 *  @returns {{ok: true, usage} | {ok: false, reason: 'rpm'|'rpm-margin'|'rpd', waitMs: number, usage}}
 */
export function checkCall(provider, model, keyName) {
  const limits = getLimits(provider, model);
  const w = getWindow(provider, model, keyName);
  const now = Date.now();
  const minuteAgo = now - 60 * 1000;

  // Prune on read too — cheap and keeps state accurate
  const recent = w.timestamps.filter(t => t > now - 24 * 3600 * 1000);
  w.timestamps = recent;
  const inMinute = recent.filter(t => t > minuteAgo);
  const rpmUsed = inMinute.length;
  const rpdUsed = recent.length;
  const usage = { rpm: rpmUsed, rpd: rpdUsed, limits };

  if (!limits) return { ok: true, usage };

  // Daily cap — gate at the true limit (no margin — pre-pausing here is
  // wasted quota since the only recovery is waiting ~24h regardless).
  if (limits.rpd && rpdUsed >= limits.rpd) {
    const oldest = recent[0];
    const waitMs = 24 * 3600 * 1000 - (now - oldest) + 500;
    return { ok: false, reason: 'rpd', waitMs, usage };
  }

  // Per-minute cap with safety margin. Compute the "safe ceiling":
  //   floor(limit * margin)  e.g. 10 * 0.85 → 8
  // If we're at or above it, wait for the oldest call to roll off so we
  // drop to (safe - 1). This gives predictable burst-then-wait behavior:
  // call fast until 8/10 on a 10 RPM model, then pause until the window
  // rolls so we can burst again.
  if (limits.rpm) {
    const safeCeiling = Math.max(1, Math.floor(limits.rpm * RPM_SAFETY_MARGIN));
    if (rpmUsed >= safeCeiling) {
      const oldest = inMinute[0];
      const waitMs = 60 * 1000 - (now - oldest) + 300;  // +300ms safety buffer
      // Distinguish "hit the real cap" from "hit our conservative margin"
      const reason = rpmUsed >= limits.rpm ? 'rpm' : 'rpm-margin';
      return { ok: false, reason, waitMs, usage };
    }
  }
  return { ok: true, usage };
}

/** Expose the full usage table for the UI / debug endpoints. */
export function snapshot() {
  const out = {};
  const now = Date.now();
  for (const [k, w] of Object.entries(windows)) {
    const [provider, model, keyName] = k.split(':');
    const inMinute = w.timestamps.filter(t => t > now - 60 * 1000).length;
    const inDay = w.timestamps.length;
    const limits = getLimits(provider, model);
    out[k] = { provider, model, keyName, rpm: inMinute, rpd: inDay, limits };
  }
  return out;
}

/** Clear all tracking — useful on reloadKeys() for a clean slate. */
export function reset() {
  for (const k of Object.keys(windows)) delete windows[k];
  log.info(COMP, 'rate-limit windows reset');
}
