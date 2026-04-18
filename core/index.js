// Public API for kraken-core. Consumers should import from here for the
// flat namespace or from individual subpaths (./exec, ./files, ...) for tree
// shaking and clearer dependency graphs.

export { checkCommandSafety, listSafetyRules } from './safety.js';
export { getPlatformInfo, getDefaultShell } from './system.js';
export { runCommand, runScript } from './exec.js';
export { readFileSafe } from './files.js';
export { captureScreenshot } from './screenshot.js';
export {
  typeText,
  pressKeys,
  clickMouse,
  moveMouse,
  getCursorPosition,
  getScreenSize,
} from './input.js';
export {
  startCapture,
  stopCapture,
  drainEvents,
  getCaptureStatus,
  clearCapture,
  shutdownCapture,
} from './capture.js';
export {
  startFeedback,
  stopFeedback,
  drainFeedback,
  getFeedbackStatus,
  clearFeedback,
  shutdownFeedback,
} from './feedback.js';
export * from './errors.js';
