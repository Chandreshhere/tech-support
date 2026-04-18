import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import screenshot from 'screenshot-desktop';

import { ScreenshotUnavailableError } from './errors.js';

const execFileAsync = promisify(execFile);

const LINUX_TOOLS = [
  { cmd: 'gnome-screenshot', args: (f) => ['-f', f] },
  { cmd: 'scrot',            args: (f) => ['-z', f] },
  { cmd: 'import',           args: (f) => ['-window', 'root', f] },
  { cmd: 'grim',             args: (f) => [f] }, // wlroots-based Wayland
];

/**
 * Classify a thrown error from execFile / readFile so the user-visible
 * message says exactly what went wrong:
 *   - spawn ENOENT       → tool binary not on PATH ("not installed")
 *   - readFile ENOENT    → tool ran but didn't create the output file
 *                          (typical when concurrent gnome-screenshot calls
 *                          collide on a global lock)
 *   - anything else      → the underlying message
 */
function classifyToolError(e) {
  if (e && e.code === 'ENOENT' && e.syscall === 'spawn') return 'not installed';
  if (e && e.code === 'ENOENT' && e.syscall === 'open')  return 'tool ran but produced no output file';
  return (e && e.message) || 'unknown error';
}

/**
 * Linux fallback chain. screenshot-desktop only knows about scrot and
 * imagemagick `import`, but many distros (Mint/GNOME) ship gnome-screenshot
 * instead. Try each tool in order, collecting errors so the final message
 * tells the caller exactly what was tried and why each failed.
 */
async function captureLinuxFallbackOnce() {
  const tmpFile = path.join(tmpdir(), `kraken-shot-${randomUUID()}.png`);
  const failures = [];

  try {
    for (const { cmd, args } of LINUX_TOOLS) {
      try {
        await execFileAsync(cmd, args(tmpFile), { timeout: 10_000 });
        return await readFile(tmpFile);
      } catch (e) {
        failures.push(`${cmd}: ${classifyToolError(e)}`);
      }
    }
    throw new ScreenshotUnavailableError(
      `no working screenshot tool found. Tried: ${failures.join('; ')}. ` +
      `On Linux, install one of: gnome-screenshot, scrot, imagemagick (provides 'import'), or grim (Wayland).`
    );
  } finally {
    try { await unlink(tmpFile); } catch {}
  }
}

// ---------- Serialization ----------
// gnome-screenshot (and likely some other backends) use a process-singleton
// lock under the hood. Calling captureScreenshot concurrently leads to one
// success and the rest failing because their `-f` output files never get
// written. We serialize calls through a promise chain so callers stack up
// instead of fighting each other.
let captureChain = Promise.resolve();

async function doCapture() {
  if (process.platform === 'linux') {
    return captureLinuxFallbackOnce();
  }
  try {
    return await screenshot({ format: 'png' });
  } catch (err) {
    if (err instanceof ScreenshotUnavailableError) throw err;
    throw new ScreenshotUnavailableError(err.message || 'unknown failure');
  }
}

/**
 * Capture a full-screen screenshot as a PNG buffer.
 *
 * - macOS / Windows: use screenshot-desktop, which wraps the OS built-ins
 *   (screencapture / a bundled .bat using .NET) — both are always available.
 * - Linux: skip screenshot-desktop entirely. It only knows scrot and `import`
 *   (neither of which is preinstalled on most distros), AND it triggers an
 *   unhandled promise rejection if `xrandr --current` fails (e.g. no DISPLAY
 *   set), which crashes the host process. Our fallback chain is strictly
 *   better: it tries gnome-screenshot, scrot, import, and grim in order, and
 *   handles each error cleanly.
 *
 * Concurrent calls are serialized — only one actual screenshot is taken at
 * a time, regardless of how many callers are waiting. Each caller still
 * gets a fresh frame, just sequentially.
 *
 * Throws `ScreenshotUnavailableError` (code: SCREENSHOT_UNAVAILABLE) when no
 * working tool is found, so the HTTP/MCP layers can return a clean 501 instead
 * of a generic 500.
 */
export async function captureScreenshot() {
  // Chain this call onto the previous one so they run sequentially. We
  // attach .catch(() => {}) to the chain promise so a previous failure
  // doesn't poison the chain — each caller gets its own error/result.
  const next = captureChain.then(() => doCapture(), () => doCapture());
  captureChain = next.catch(() => {});
  return next;
}
