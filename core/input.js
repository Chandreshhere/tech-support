// Input synthesis: programmatically type text, press key chords, click,
// and move the mouse. Backed by @nut-tree-fork/nut-js (cross-platform via
// libnut). nut-js is loaded lazily so a missing/broken native binary
// surfaces as a clean InputUnavailableError instead of crashing the process
// at import time.

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { InputUnavailableError, ValidationError, CoreError } from './errors.js';

/**
 * Module-level emitter that fires after each successful synthesized action.
 * feedback.js subscribes to this to know when to take a screenshot.
 *
 * Events:
 *   'synthesized'  payload: { action: 'type'|'key'|'click'|'move', ...details }
 *
 * Consumers attach with `inputEvents.on('synthesized', handler)`. The emitter
 * has no max-listener limit warning bumped because we expect at most a handful
 * of consumers in this codebase.
 */
export const inputEvents = new EventEmitter();
inputEvents.setMaxListeners(20);

let nutPromise = null;
async function loadNut() {
  if (!nutPromise) {
    nutPromise = (async () => {
      try {
        const nut = await import('@nut-tree-fork/nut-js');
        // Tune defaults: nut-js ships with very conservative delays.
        nut.keyboard.config.autoDelayMs = 0;
        nut.mouse.config.mouseSpeed = 1500;
        nut.mouse.config.autoDelayMs = 0;
        return nut;
      } catch (err) {
        throw new InputUnavailableError(
          `failed to load @nut-tree-fork/nut-js: ${err.message}`
        );
      }
    })();
    // Make sure a rejection here doesn't become an unhandled rejection
    // before the first caller awaits it.
    nutPromise.catch(() => {});
  }
  return nutPromise;
}

/**
 * Run a nut-js call and translate any underlying failure into a typed
 * InputUnavailableError so HTTP/MCP layers can return a clean 501 instead of
 * leaking generic exceptions. CoreErrors (validation, etc.) pass through.
 */
async function callNut(label, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CoreError) throw err;
    const msg = err && err.message ? err.message : String(err);
    throw new InputUnavailableError(`${label} failed: ${msg}`);
  }
}

// ---------- Key name resolution ----------
// Accepts case-insensitive names plus common aliases. Maps to nut-js Key enum.

const KEY_ALIASES = {
  ctrl: 'LeftControl',          control: 'LeftControl',
  rctrl: 'RightControl',        rcontrol: 'RightControl',
  shift: 'LeftShift',           rshift: 'RightShift',
  alt: 'LeftAlt',               option: 'LeftAlt',  ralt: 'RightAlt',
  meta: 'LeftSuper',            cmd: 'LeftSuper',   command: 'LeftSuper',
  win: 'LeftSuper',             windows: 'LeftSuper',  super: 'LeftSuper',
  enter: 'Enter',               return: 'Enter',
  esc: 'Escape',                escape: 'Escape',
  tab: 'Tab',                   backspace: 'Backspace',
  delete: 'Delete',             del: 'Delete',
  space: 'Space',               spacebar: 'Space',
  up: 'Up',                     down: 'Down',
  left: 'Left',                 right: 'Right',
  home: 'Home',                 end: 'End',
  pageup: 'PageUp',             pagedown: 'PageDown',
  capslock: 'CapsLock',         caps: 'CapsLock',
  insert: 'Insert',             ins: 'Insert',
  printscreen: 'Print',         print: 'Print',
};

function resolveKeyName(name) {
  if (typeof name !== 'string' || !name) {
    throw new ValidationError(`invalid key name: ${name}`);
  }
  const lower = name.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  // Single character → uppercase letter (nut-js Key.A, Key.B, ...)
  if (name.length === 1) return name.toUpperCase();
  // Function keys like f1, F12
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(name)) return name.toUpperCase();
  // Digits stay digits but nut-js calls them Num0..Num9
  if (/^[0-9]$/.test(name)) return `Num${name}`;
  // Pass through PascalCase as-is (caller already knows the nut-js name)
  return name;
}

async function lookupKey(name) {
  const { Key } = await loadNut();
  const resolved = resolveKeyName(name);
  if (Key[resolved] !== undefined) return Key[resolved];
  // Try uppercase fallback
  const upper = resolved.toUpperCase();
  if (Key[upper] !== undefined) return Key[upper];
  throw new ValidationError(`unknown key: ${name}`);
}

// ---------- Clipboard-based typing (Linux) ----------
// nut-js's keyboard.type() sends raw keycodes and mangles shifted symbols
// (! → 1, ? → /, @ → 2, etc.) on Linux/X11. The proven fix: write text to
// the X11 clipboard via xclip and press Ctrl+V. This handles ALL characters,
// newlines, and unicode correctly because it bypasses keyboard layout mapping.
// On non-Linux platforms, fall back to nut-js keyboard.type.

function hasXclip() {
  if (process.platform !== 'linux') return false;
  try {
    execSync('which xclip', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const USE_CLIPBOARD = hasXclip();

/**
 * Set the X11 CLIPBOARD selection to the given text via xclip.
 * Synchronous — blocks until xclip writes the selection.
 */
function setClipboard(text) {
  execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
}

// ---------- Public API ----------

/**
 * Type a literal string into the focused window. On Linux, uses clipboard
 * paste (xclip + Ctrl+V) for perfect character fidelity. On other platforms,
 * falls back to nut-js keyboard.type.
 */
export async function typeText(text) {
  if (typeof text !== 'string') {
    throw new ValidationError('text must be a string');
  }
  const result = await callNut('typeText', async () => {
    const { keyboard, Key } = await loadNut();

    if (USE_CLIPBOARD) {
      setClipboard(text);
      await keyboard.type(Key.LeftControl, Key.V);
    } else {
      await keyboard.type(text);
    }

    return { typed: text.length };
  });
  inputEvents.emit('synthesized', { action: 'type', length: text.length });
  return result;
}

/**
 * Press a chord of keys simultaneously (e.g. ['control','c'] or ['cmd','shift','t']).
 * All keys are pressed and released as a chord by nut-js.
 */
export async function pressKeys(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new ValidationError('keys must be a non-empty array');
  }
  // Resolve key names BEFORE entering callNut so a ValidationError for an
  // unknown key isn't masked as InputUnavailableError.
  const resolved = [];
  for (const k of keys) resolved.push(await lookupKey(k));
  const result = await callNut('pressKeys', async () => {
    const { keyboard } = await loadNut();
    await keyboard.type(...resolved);
    return { pressed: keys };
  });
  inputEvents.emit('synthesized', { action: 'key', keys });
  return result;
}

const BUTTON_NAMES = { left: 'LEFT', right: 'RIGHT', middle: 'MIDDLE' };

/**
 * Click a mouse button at the current cursor position.
 * @param {object} opts
 * @param {'left'|'right'|'middle'} [opts.button='left']
 * @param {boolean} [opts.double=false]
 */
export async function clickMouse({ button = 'left', double = false } = {}) {
  const buttonKey = BUTTON_NAMES[button];
  if (!buttonKey) {
    throw new ValidationError(`button must be one of left|right|middle, got: ${button}`);
  }
  const result = await callNut('clickMouse', async () => {
    const nut = await loadNut();
    const buttonEnum = nut.Button[buttonKey];

    if (double) {
      await nut.mouse.doubleClick(buttonEnum);
    } else if (button === 'left') {
      await nut.mouse.leftClick();
    } else if (button === 'right') {
      await nut.mouse.rightClick();
    } else {
      // middle button — nut-js has no middleClick. Use pressButton/releaseButton
      // and guarantee release in finally so a thrown press doesn't leave the
      // button held down.
      let pressed = false;
      try {
        await nut.mouse.pressButton(buttonEnum);
        pressed = true;
      } finally {
        if (pressed) {
          try { await nut.mouse.releaseButton(buttonEnum); } catch {}
        }
      }
    }
    return { button, double };
  });
  inputEvents.emit('synthesized', { action: 'click', button, double });
  return result;
}

// Ease-in-out cubic: starts slow, accelerates through the middle, decelerates
// to a stop. Gives the cursor a natural, human-like feel.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Move the cursor to absolute screen coordinates with smooth animated travel.
 * The cursor always animates — no instant teleport — so it looks like a human
 * moving the mouse rather than a programmatic jump.
 *
 * Speed is tuned to be fast-but-visible: ~2000 px/s cruise speed with
 * ease-in-out-cubic easing, clamped to 60–600ms regardless of distance.
 * A 400px move takes ~200ms; a full-diagonal move (~1570px) takes ~600ms.
 */
export async function moveMouse({ x, y } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new ValidationError('x and y must be finite numbers');
  }
  const result = await callNut('moveMouse', async () => {
    const nut = await loadNut();

    // Read current position so we know where to start the animation from.
    let from;
    try {
      from = await nut.mouse.getPosition();
    } catch {
      // If we can't read the position, fall back to an instant move.
      await nut.mouse.setPosition(new nut.Point(x, y));
      return { x, y };
    }

    const dx = x - from.x;
    const dy = y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Skip animation for sub-pixel moves (e.g. double-clicks at same position).
    if (distance < 2) {
      await nut.mouse.setPosition(new nut.Point(x, y));
      return { x, y };
    }

    // Duration: distance / 2000 px·s⁻¹, clamped to [60, 600] ms.
    // At 2000 px/s: a 300px move → 150ms, 600px → 300ms, 1000px+ → capped at 600ms.
    const durationMs = Math.min(600, Math.max(60, (distance / 2000) * 1000));
    const stepMs = 12; // ~83 fps — smooth without hammering the IPC channel
    const steps = Math.round(durationMs / stepMs);

    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const t = easeInOutCubic(i / steps);
      const nx = Math.round(from.x + dx * t);
      const ny = Math.round(from.y + dy * t);
      await nut.mouse.setPosition(new nut.Point(nx, ny));

      // Sleep for the remaining time in this step (compensate for IPC latency).
      const elapsed = Date.now() - t0;
      const targetMs = (i / steps) * durationMs;
      const wait = targetMs - elapsed;
      if (wait > 1) await new Promise(r => setTimeout(r, wait));
    }

    // Final snap to exact target (easing may leave a sub-pixel gap).
    await nut.mouse.setPosition(new nut.Point(x, y));
    return { x, y };
  });
  inputEvents.emit('synthesized', { action: 'move', x, y });
  return result;
}

/**
 * Get the current cursor position.
 * @returns {{ x: number, y: number }}
 */
export async function getCursorPosition() {
  return callNut('getCursorPosition', async () => {
    const { mouse } = await loadNut();
    const pos = await mouse.getPosition();
    return { x: pos.x, y: pos.y };
  });
}

/**
 * Get the primary screen size in pixels.
 * @returns {{ width: number, height: number }}
 */
export async function getScreenSize() {
  return callNut('getScreenSize', async () => {
    const { screen } = await loadNut();
    const [width, height] = await Promise.all([screen.width(), screen.height()]);
    return { width, height };
  });
}
