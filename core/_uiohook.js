// Internal: shared uiohook-napi lifecycle manager.
//
// Both capture.js and feedback.js want to subscribe to global keyboard/mouse
// events. uiohook-napi exposes a single process-wide hook (uIOhook) — calling
// start() / stop() must be coordinated so one consumer doesn't kill the hook
// out from under another.
//
// This module owns the load + start/stop with a refcount. Each subscriber
// calls acquire() once and release() when done. The native hook is started on
// the first acquire and stopped after the last release.

import { createRequire } from 'module';
import { CaptureUnavailableError } from './errors.js';

const require = createRequire(import.meta.url);

let uioModule = null;
let loadError = null;
let started = false;
let refCount = 0;

function loadUio() {
  if (uioModule) return uioModule;
  if (loadError) throw loadError;
  try {
    uioModule = require('uiohook-napi');
  } catch (err) {
    loadError = new CaptureUnavailableError(`failed to load uiohook-napi: ${err.message}`);
    throw loadError;
  }
  return uioModule;
}

/**
 * Acquire a reference to the uiohook event source. Starts the native hook
 * on the first call. Returns the loaded module so the caller can attach
 * event listeners (e.g. `mod.uIOhook.on('keydown', ...)`).
 */
export function acquireHook() {
  const mod = loadUio();
  if (refCount === 0 && !started) {
    try {
      mod.uIOhook.start();
      started = true;
    } catch (err) {
      loadError = new CaptureUnavailableError(`uIOhook.start() failed: ${err.message}`);
      throw loadError;
    }
  }
  refCount++;
  return mod;
}

/**
 * Release a reference. The native hook stops once the last subscriber
 * releases. Idempotent for callers that release more than once.
 */
export function releaseHook() {
  if (refCount === 0) return;
  refCount--;
  if (refCount === 0 && started) {
    try { uioModule.uIOhook.stop(); } catch {}
    started = false;
  }
}

/**
 * Force-stop the hook regardless of refcount. Intended for graceful shutdown
 * by the host process (SIGTERM handler). Idempotent.
 */
export function forceStopHook() {
  refCount = 0;
  if (started && uioModule) {
    try { uioModule.uIOhook.stop(); } catch {}
    started = false;
  }
}

/** Module access without acquiring (for reverse-lookup tables, etc.). */
export function getUiohookModule() {
  return loadUio();
}

export function getHookStatus() {
  return {
    available: !loadError,
    started,
    refCount,
    ...(loadError && { error: loadError.message }),
  };
}
