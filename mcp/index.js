#!/usr/bin/env node
// kraken-assist MCP server.
// Exposes the kraken-core capabilities (exec, files, screenshot, input, capture)
// as MCP tools over stdio. Designed to be invoked by an MCP client (e.g. Claude
// Desktop) via:
//   "command": "node",
//   "args": ["/abs/path/to/kraken-assist/mcp/index.js"]
//
// On Linux X11, the MCP client must also pass DISPLAY (and usually XAUTHORITY)
// in the env block — MCP's stdio transport uses a minimal env whitelist that
// strips those out by default.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  runCommand,
  runScript,
  readFileSafe,
  captureScreenshot,
  getPlatformInfo,
  typeText,
  pressKeys,
  clickMouse,
  moveMouse,
  getCursorPosition,
  getScreenSize,
  startCapture,
  stopCapture,
  drainEvents,
  getCaptureStatus,
  clearCapture,
  shutdownCapture,
  startFeedback,
  stopFeedback,
  drainFeedback,
  getFeedbackStatus,
  clearFeedback,
  shutdownFeedback,
  CoreError,
} from 'kraken-core';

const server = new McpServer({
  name: 'kraken-assist',
  version: '1.0.0',
});

// ---------- Helpers ----------

function extractErrorFields(err) {
  const fields = {};
  for (const key of ['rule', 'reason', 'path', 'shell', 'signal', 'size', 'limit']) {
    if (err[key] !== undefined) fields[key] = err[key];
  }
  return fields;
}

/**
 * Wrap a tool handler so any error becomes a clean MCP error response
 * (isError: true) instead of crashing the JSON-RPC handler. CoreErrors are
 * surfaced with their typed code; everything else is reported as INTERNAL.
 */
function safeTool(handler) {
  return async (args, extra) => {
    try {
      return await handler(args, extra);
    } catch (err) {
      if (err instanceof CoreError) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: JSON.stringify(
              { code: err.code, error: err.message, ...extractErrorFields(err) },
              null,
              2
            ),
          }],
        };
      }
      // Unexpected error — log to stderr (NOT stdout, which is the MCP
      // transport) and return a clean isError response.
      process.stderr.write(`[mcp] tool error: ${err && err.stack ? err.stack : err}\n`);
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            code: 'INTERNAL',
            error: err && err.message ? err.message : 'unknown error',
          }, null, 2),
        }],
      };
    }
  };
}

/** Wrap a JSON-serializable value as an MCP text content response. */
function jsonResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

// ---------- System ----------

server.registerTool(
  'system_info',
  {
    title: 'System info',
    description:
      'Return platform, OS release, hostname, CPU/memory stats, default shell, and Node version. Useful for picking the right command for run_command on different OSes.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(getPlatformInfo()))
);

// ---------- Exec ----------

const execCommonSchema = {
  shell: z
    .string()
    .min(1)
    .optional()
    .describe('Shell to use (e.g. "bash", "zsh", "/usr/bin/dash", "pwsh", "cmd"). Defaults to bash on Unix, cmd.exe on Windows.'),
  cwd: z.string().min(1).optional().describe('Working directory for the command.'),
  timeout: z
    .number()
    .int()
    .positive()
    .finite()
    .optional()
    .describe('Timeout in milliseconds (default 30000).'),
};

server.registerTool(
  'run_command',
  {
    title: 'Run shell command',
    description:
      'Run a single inline shell command. Bash by default on Unix; pass shell to override. Blocked by safety guardrails for clearly destructive commands (rm -rf /, mkfs, dd to block devices, fork bombs, shutdown, etc.). Non-zero exit codes resolve normally with exitCode set. Output capped at 10MB; larger output returns BUFFER_OVERFLOW.',
    inputSchema: {
      command: z.string().min(1).describe('The shell command to run.'),
      ...execCommonSchema,
    },
  },
  safeTool(async ({ command, shell, cwd, timeout }) => {
    const result = await runCommand({ command, shell, cwd, timeout });
    return jsonResult(result);
  })
);

server.registerTool(
  'run_script',
  {
    title: 'Run shell script',
    description:
      'Run a multi-line shell script by writing it to a temp file and invoking it with the chosen shell. Use this for scripts with bash-isms ([[ ]], arrays, <<<, functions, set -e, etc.) or anything that would be awkward as a one-liner. Same safety guardrails and 10MB output cap as run_command.',
    inputSchema: {
      script: z.string().min(1).describe('The full script body. May include a shebang.'),
      ...execCommonSchema,
    },
  },
  safeTool(async ({ script, shell, cwd, timeout }) => {
    const result = await runScript({ script, shell, cwd, timeout });
    return jsonResult(result);
  })
);

// ---------- Files ----------

server.registerTool(
  'read_file',
  {
    title: 'Read a file',
    description:
      'Read any file the server process has permission to read. Returns content as utf8 by default; pass encoding="base64" for binary files. Files larger than 10MB return FILE_TOO_LARGE. Returns clear errors for missing files (FILE_NOT_FOUND), permission denied (PERMISSION_DENIED), or non-file paths (INVALID_PATH).',
    inputSchema: {
      path: z.string().min(1).describe('Absolute or relative path to the file.'),
      encoding: z
        .enum(['utf8', 'base64'])
        .optional()
        .describe('Output encoding. Defaults to utf8.'),
    },
  },
  safeTool(async ({ path, encoding }) => {
    const result = await readFileSafe(path, encoding ?? 'utf8');
    return jsonResult(result);
  })
);

// ---------- Screenshot ----------

server.registerTool(
  'take_screenshot',
  {
    title: 'Capture screenshot',
    description:
      'Capture a full-screen PNG screenshot of the primary display. Works on Windows (built-in), macOS (built-in screencapture, requires Screen Recording permission), and Linux (gnome-screenshot/scrot/import/grim — at least one must be installed). Returns the image as MCP image content. Returns SCREENSHOT_UNAVAILABLE if no working tool is found.',
    inputSchema: {},
  },
  safeTool(async () => {
    const buf = await captureScreenshot();
    return {
      content: [{
        type: 'image',
        data: buf.toString('base64'),
        mimeType: 'image/png',
      }],
    };
  })
);

// ---------- Input synthesis ----------

server.registerTool(
  'type_text',
  {
    title: 'Type text',
    description:
      'Type a literal string into the focused window, character by character. The user must have a window focused that accepts text input. Linux requires X11 (Wayland blocks input synthesis from other apps). Returns INPUT_UNAVAILABLE if the input subsystem cannot reach the display server.',
    inputSchema: {
      text: z.string().describe('Text to type. Empty string is allowed (no-op).'),
    },
  },
  safeTool(async ({ text }) => jsonResult(await typeText(text)))
);

server.registerTool(
  'press_keys',
  {
    title: 'Press key chord',
    description:
      'Press a chord of keys simultaneously. Examples: ["control","c"] (copy), ["meta","shift","t"] (reopen tab), ["alt","tab"] (switch window). Aliases recognized: ctrl/control, alt/option, cmd/command/meta/win/super, shift, enter/return, esc/escape, tab, backspace, delete, space, arrow names, f1-f24.',
    inputSchema: {
      keys: z
        .array(z.string().min(1))
        .min(1)
        .describe('Array of key names. Order does not matter for chords.'),
    },
  },
  safeTool(async ({ keys }) => jsonResult(await pressKeys(keys)))
);

server.registerTool(
  'click_mouse',
  {
    title: 'Click mouse',
    description: 'Click a mouse button at the current cursor position.',
    inputSchema: {
      button: z
        .enum(['left', 'right', 'middle'])
        .optional()
        .describe('Mouse button. Defaults to left.'),
      double: z
        .boolean()
        .optional()
        .describe('If true, performs a double-click. Defaults to false.'),
    },
  },
  safeTool(async (args) => jsonResult(await clickMouse(args)))
);

server.registerTool(
  'move_mouse',
  {
    title: 'Move mouse',
    description: 'Move the cursor to absolute screen coordinates (0,0 = top-left).',
    inputSchema: {
      x: z.number().finite().describe('Target X coordinate in pixels.'),
      y: z.number().finite().describe('Target Y coordinate in pixels.'),
      smooth: z
        .boolean()
        .optional()
        .describe('If true, animates the cursor along a path instead of teleporting. Defaults to false.'),
    },
  },
  safeTool(async (args) => jsonResult(await moveMouse(args)))
);

server.registerTool(
  'get_cursor_position',
  {
    title: 'Get cursor position',
    description: 'Return the current cursor position {x, y} in pixels.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(await getCursorPosition()))
);

server.registerTool(
  'get_screen_size',
  {
    title: 'Get screen size',
    description: 'Return the primary display size {width, height} in pixels.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(await getScreenSize()))
);

// ---------- Capture (keylog) ----------

server.registerTool(
  'capture_start',
  {
    title: 'Start input capture',
    description:
      'Start capturing global keyboard and mouse events into an in-memory ring buffer (capacity 10000). Events are NEVER written to disk or logged. Linux requires X11. Windows: low-level hook; some antivirus may flag the process. macOS requires Accessibility + Input Monitoring permissions. Returns CAPTURE_UNAVAILABLE if the underlying hook fails to start.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(startCapture()))
);

server.registerTool(
  'capture_stop',
  {
    title: 'Stop input capture',
    description: 'Stop capturing input events. Buffered events remain available via capture_drain until cleared.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(stopCapture()))
);

server.registerTool(
  'capture_status',
  {
    title: 'Capture status',
    description: 'Return whether capture is active, current buffer size, total events seen, and module availability.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(getCaptureStatus()))
);

server.registerTool(
  'capture_drain',
  {
    title: 'Drain captured events',
    description:
      'Read events from the capture buffer with id strictly greater than `since`. For incremental polling, pass the previous response\'s `nextSince` as the next `since`. Returns events plus nextSince and a count of dropped events (caused by the ring buffer overflowing since the last drain). Each key event includes a `keyName` field with the human-readable name when available.',
    inputSchema: {
      since: z
        .number()
        .int()
        .nonnegative()
        .finite()
        .optional()
        .describe('Return events with id > since. Default 0 (return everything).'),
      limit: z
        .number()
        .int()
        .positive()
        .finite()
        .max(10000)
        .optional()
        .describe('Maximum number of events to return. Default 1000.'),
    },
  },
  safeTool(async ({ since, limit }) => jsonResult(drainEvents(since ?? 0, limit ?? 1000)))
);

server.registerTool(
  'capture_clear',
  {
    title: 'Clear capture buffer',
    description: 'Drop all buffered events. The capture stays active if it was active.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(clearCapture()))
);

// ---------- Feedback loop ----------

server.registerTool(
  'feedback_start',
  {
    title: 'Start feedback loop',
    description:
      'Start a constant-feedback screenshot loop. Captures a screenshot periodically (heartbeat, default every 3000 ms) AND on every interesting input event: real user clicks/keypresses, plus your own synthesized actions (type_text, press_keys, click_mouse, move_mouse). User mouse moves are intentionally ignored. Synthesized mouse moves capture AFTER the cursor stops. Bursts of the same trigger debounce so you get one screenshot per pause, not one per keystroke. Drain with feedback_drain. Stop with feedback_stop.',
    inputSchema: {
      intervalMs: z
        .number()
        .int()
        .min(250)
        .finite()
        .optional()
        .describe('Heartbeat interval in milliseconds. Minimum 250, default 3000.'),
      ringSize: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How many recent screenshots to retain. Default 10, max 100. Old frames are dropped FIFO.'),
    },
  },
  safeTool(async ({ intervalMs, ringSize }) => jsonResult(startFeedback({ intervalMs, ringSize })))
);

server.registerTool(
  'feedback_stop',
  {
    title: 'Stop feedback loop',
    description: 'Stop the feedback loop. Buffered frames remain available via feedback_drain until cleared.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(stopFeedback()))
);

server.registerTool(
  'feedback_status',
  {
    title: 'Feedback loop status',
    description: 'Return whether the feedback loop is active, current buffer size, total captures, and the last error (if any).',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(getFeedbackStatus()))
);

server.registerTool(
  'feedback_drain',
  {
    title: 'Drain feedback frames',
    description:
      'Read screenshots from the feedback buffer with id > since. Returns each frame as an image content block (so you actually SEE them) followed by a small text block describing trigger, timestamp, and id. Default limit is 1 (just the most recent frame). Pass the previous response\'s nextSince via a follow-up status call to poll incrementally. Note: each screenshot capture takes ~500-600ms on Linux (gnome-screenshot). After triggering an action, wait at least 1-2 seconds before draining to ensure the event-driven screenshot has completed.',
    inputSchema: {
      since: z
        .number()
        .int()
        .nonnegative()
        .finite()
        .optional()
        .describe('Return frames with id > since. Default 0.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe('Maximum frames to return. Default 1 (most recent only).'),
    },
  },
  safeTool(async ({ since, limit }) => {
    const result = drainFeedback(since ?? 0, limit ?? 1);
    // Build a mixed response: a summary text block, then for each entry an
    // image content block followed by a small text block describing it. The
    // model sees the images as actual images, not as base64 in JSON.
    const content = [
      {
        type: 'text',
        text: JSON.stringify({
          nextSince: result.nextSince,
          droppedSinceLastDrain: result.droppedSinceLastDrain,
          bufferSize: result.bufferSize,
          totalCaptured: result.totalCaptured,
          totalDropped: result.totalDropped,
          active: result.active,
          returned: result.entries.length,
        }, null, 2),
      },
    ];
    for (const entry of result.entries) {
      content.push({
        type: 'image',
        data: entry.pngBase64,
        mimeType: 'image/png',
      });
      content.push({
        type: 'text',
        text: `frame id=${entry.id} trigger=${entry.trigger} timestamp=${new Date(entry.timestamp).toISOString()} bytes=${entry.pngBytes}`,
      });
    }
    return { content };
  })
);

server.registerTool(
  'feedback_clear',
  {
    title: 'Clear feedback buffer',
    description: 'Drop all buffered frames. The loop stays active if it was active.',
    inputSchema: {},
  },
  safeTool(async () => jsonResult(clearFeedback()))
);

// ---------- Graceful shutdown ----------
// uiohook holds a native thread that pins the event loop. Without these
// handlers the process would hang after the MCP client disconnects.

let shuttingDown = false;
function gracefulExit(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(`[mcp] shutting down (${reason})\n`);
  try { shutdownFeedback(); } catch {}
  try { shutdownCapture(); } catch {}
  // Hard cap so we never hang forever even if something misbehaves.
  setTimeout(() => process.exit(code), 1000).unref();
  process.exit(code);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => gracefulExit(sig, 0));
}
// When the parent (MCP client) closes our stdin, exit cleanly. The MCP SDK
// also notices this on its transport, but we register an explicit handler so
// uiohook gets stopped before the process tries to exit.
process.stdin.on('end', () => gracefulExit('stdin-end', 0));
process.stdin.on('close', () => gracefulExit('stdin-close', 0));

process.on('uncaughtException', (err) => {
  process.stderr.write(`[mcp] uncaughtException: ${err && err.stack ? err.stack : err}\n`);
  gracefulExit('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[mcp] unhandledRejection: ${reason}\n`);
});

// ---------- Boot ----------
try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`kraken-assist MCP server ready (${process.platform})\n`);
} catch (err) {
  process.stderr.write(`[mcp] failed to start: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
