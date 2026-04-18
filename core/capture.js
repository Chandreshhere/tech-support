// Global input capture (a.k.a. "keylog"). Records keyboard and mouse events
// system-wide into an in-memory ring buffer. Backed by uiohook-napi (libuiohook),
// shared via _uiohook.js so capture and feedback can both subscribe.
//
// Privacy / safety:
//   - Capture is OFF until startCapture() is called.
//   - Events are kept in a bounded in-memory buffer (default 10000 events).
//   - NEVER written to disk. NEVER logged to stdout/stderr.
//   - drainEvents(since) returns events with id > since so callers can poll
//     incrementally without losing or duplicating events.
//
// Linux note: requires X11. Wayland sessions cannot capture other apps' input
// — that's a Wayland security feature, not a uiohook bug.

import { acquireHook, releaseHook, forceStopHook, getUiohookModule } from './_uiohook.js';
import { CaptureUnavailableError, ValidationError } from './errors.js';

const RING_CAPACITY = 10_000;

// State
let active = false;
let listenersAttached = false;
let listenerHandles = null; // { keydown, keyup, mousedown, mouseup, click, mousemove, wheel }
let shutdownRegistered = false;
const ring = [];
let nextId = 1;
let totalSeen = 0;
let droppedSinceLastDrain = 0;
let keyNameByCode = null;

// uiohook-napi event types we care about. The library uses numeric codes.
const EVENT_TYPES = {
  3: 'key.down',     // EVENT_KEY_PRESSED
  4: 'key.up',       // EVENT_KEY_RELEASED
  5: 'mouse.click',  // EVENT_MOUSE_CLICKED
  6: 'mouse.down',   // EVENT_MOUSE_PRESSED
  7: 'mouse.up',     // EVENT_MOUSE_RELEASED
  8: 'mouse.move',   // EVENT_MOUSE_MOVED
  9: 'mouse.drag',   // EVENT_MOUSE_DRAGGED
 10: 'wheel',        // EVENT_MOUSE_WHEEL
};

function buildKeyNameMap() {
  if (keyNameByCode) return;
  const mod = getUiohookModule();
  if (!mod.UiohookKey) return;
  keyNameByCode = {};
  for (const [name, code] of Object.entries(mod.UiohookKey)) {
    if (typeof code === 'number' && typeof name === 'string' && /^[A-Za-z]/.test(name)) {
      keyNameByCode[code] = name;
    }
  }
}

function keyName(code) {
  return (keyNameByCode && keyNameByCode[code]) || null;
}

function pushEvent(rawType, payload) {
  const type = EVENT_TYPES[rawType] || `unknown(${rawType})`;
  const event = {
    id: nextId++,
    timestamp: Date.now(),
    type,
    ...payload,
  };
  ring.push(event);
  if (ring.length > RING_CAPACITY) {
    ring.shift();
    droppedSinceLastDrain++;
  }
  totalSeen++;
}

function attachListeners(uio) {
  const handles = {
    keydown: (e) => pushEvent(3, {
      keycode: e.keycode, keyName: keyName(e.keycode), rawcode: e.rawcode,
      altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
    }),
    keyup: (e) => pushEvent(4, {
      keycode: e.keycode, keyName: keyName(e.keycode), rawcode: e.rawcode,
      altKey: e.altKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
    }),
    mousedown: (e) => pushEvent(6, { x: e.x, y: e.y, button: e.button, clicks: e.clicks }),
    mouseup:   (e) => pushEvent(7, { x: e.x, y: e.y, button: e.button, clicks: e.clicks }),
    click:     (e) => pushEvent(5, { x: e.x, y: e.y, button: e.button, clicks: e.clicks }),
    mousemove: (e) => pushEvent(8, { x: e.x, y: e.y }),
    wheel:     (e) => pushEvent(10, { x: e.x, y: e.y, rotation: e.rotation, direction: e.direction, amount: e.amount }),
  };
  for (const [evt, handler] of Object.entries(handles)) {
    uio.uIOhook.on(evt, handler);
  }
  return handles;
}

function detachListeners(uio, handles) {
  if (!handles) return;
  for (const [evt, handler] of Object.entries(handles)) {
    try { uio.uIOhook.off(evt, handler); } catch {}
  }
}

/**
 * Register process-exit handlers ONCE so the native uiohook thread gets
 * stopped before the process tries to exit. Without this, a running capture
 * keeps libuv alive and the process hangs.
 */
function registerShutdownHooks() {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  process.once('beforeExit', () => {
    if (active) try { stopCapture(); } catch {}
  });
}

export function startCapture() {
  if (active) return getCaptureStatus();
  let mod;
  try {
    mod = acquireHook();
  } catch (err) {
    if (err instanceof CaptureUnavailableError) throw err;
    throw new CaptureUnavailableError(`acquireHook failed: ${err.message}`);
  }
  buildKeyNameMap();
  if (!listenersAttached) {
    listenerHandles = attachListeners(mod);
    listenersAttached = true;
  }
  registerShutdownHooks();
  active = true;
  return getCaptureStatus();
}

export function stopCapture() {
  if (!active) return getCaptureStatus();
  // Detach our listeners BEFORE releasing so we don't keep firing events
  // for whoever else might still be subscribed.
  if (listenerHandles) {
    try {
      detachListeners(getUiohookModule(), listenerHandles);
    } catch {}
    listenerHandles = null;
    listenersAttached = false;
  }
  releaseHook();
  active = false;
  return getCaptureStatus();
}

/**
 * Drain captured events with id strictly greater than `since`.
 * Returns up to `limit` events. The caller should pass the highest id it
 * received last time as `since` to get incremental polling without gaps.
 */
export function drainEvents(since = 0, limit = 1000) {
  if (since === null || since === undefined) since = 0;
  if (limit === null || limit === undefined) limit = 1000;
  if (!Number.isFinite(since) || since < 0) {
    throw new ValidationError('since must be a non-negative finite number');
  }
  if (!Number.isFinite(limit) || limit <= 0 || limit > RING_CAPACITY) {
    throw new ValidationError(`limit must be between 1 and ${RING_CAPACITY}`);
  }
  const events = [];
  for (const e of ring) {
    if (e.id > since) {
      events.push(e);
      if (events.length >= limit) break;
    }
  }
  const dropped = droppedSinceLastDrain;
  droppedSinceLastDrain = 0;
  return {
    events,
    nextSince: events.length ? events[events.length - 1].id : since,
    dropped,
    bufferSize: ring.length,
    totalSeen,
    active,
  };
}

export function getCaptureStatus() {
  return {
    available: true,
    active,
    bufferSize: ring.length,
    bufferCapacity: RING_CAPACITY,
    nextId,
    totalSeen,
  };
}

/**
 * Reset the buffer (drop everything, keep monotonic ids).
 */
export function clearCapture() {
  ring.length = 0;
  droppedSinceLastDrain = 0;
  return getCaptureStatus();
}

/**
 * Force-stop capture and detach handlers. Intended for graceful shutdown by
 * the host process (SIGTERM). Idempotent.
 */
export function shutdownCapture() {
  if (active) {
    try { stopCapture(); } catch {}
  }
  // Belt and braces: even if our state was somehow out of sync, force the
  // native hook off so the process can exit.
  try { forceStopHook(); } catch {}
}
