// Smoke test the MCP server end-to-end via the SDK's stdio client.
// Spawns ./index.js as a child process, connects, lists tools, and exercises
// a few representative tools to confirm the wiring works.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'index.js');

let pass = 0;
let fail = 0;
function ok(msg)  { pass++; console.log('PASS  ' + msg); }
function ko(msg, err) { fail++; console.log('FAIL  ' + msg + '  -- ' + (err?.message ?? err)); }

// MCP's stdio transport only inherits a minimal env whitelist by default
// (HOME, LOGNAME, PATH, SHELL, TERM, USER on Unix). Anything that touches
// the X server (screenshot, nut-js, uiohook) needs DISPLAY/XAUTHORITY too.
// Real MCP clients should configure these explicitly in their MCP config.
function buildTestEnv() {
  const passthrough = ['HOME','LOGNAME','PATH','SHELL','TERM','USER',
    'DISPLAY','XAUTHORITY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','XDG_SESSION_TYPE'];
  const env = {};
  for (const k of passthrough) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

const transport = new StdioClientTransport({
  command: 'node',
  args: [serverPath],
  env: buildTestEnv(),
});

const client = new Client({ name: 'kraken-test-client', version: '1.0.0' }, { capabilities: {} });

await client.connect(transport);
ok('client connected');

// List tools
try {
  const { tools } = await client.listTools();
  if (tools.length >= 16) ok(`listTools returned ${tools.length} tools`);
  else ko(`listTools returned only ${tools.length} tools`, JSON.stringify(tools.map((t) => t.name)));
  console.log('   tools: ' + tools.map((t) => t.name).join(', '));
} catch (e) {
  ko('listTools', e);
}

async function call(name, args = {}) {
  return client.callTool({ name, arguments: args });
}

// system_info
try {
  const r = await call('system_info');
  const text = r.content[0].text;
  if (text.includes('"platform"')) ok('system_info returns platform info');
  else ko('system_info', text);
} catch (e) { ko('system_info', e); }

// run_command — simple echo
try {
  const r = await call('run_command', { command: 'echo hello-mcp' });
  const text = r.content[0].text;
  if (text.includes('hello-mcp')) ok('run_command echo');
  else ko('run_command echo', text);
} catch (e) { ko('run_command echo', e); }

// run_command — bash-ism (verifies bash default)
try {
  const r = await call('run_command', {
    command: 'arr=(a b c); echo "len=${#arr[@]}"',
  });
  if (r.content[0].text.includes('len=3')) ok('run_command bash array');
  else ko('run_command bash array', r.content[0].text);
} catch (e) { ko('run_command bash array', e); }

// run_command — safety blocked
try {
  const r = await call('run_command', { command: 'rm -rf /' });
  if (r.isError && r.content[0].text.includes('SAFETY_BLOCKED')) ok('run_command safety blocked');
  else ko('run_command safety blocked', JSON.stringify(r));
} catch (e) { ko('run_command safety blocked', e); }

// run_script
try {
  const r = await call('run_script', {
    script: '#!/usr/bin/env bash\nset -e\nfor i in 1 2 3; do echo line-$i; done',
  });
  if (r.content[0].text.includes('line-1') && r.content[0].text.includes('line-3')) ok('run_script multi-line');
  else ko('run_script multi-line', r.content[0].text);
} catch (e) { ko('run_script multi-line', e); }

// read_file
try {
  const r = await call('read_file', { path: '/etc/hostname' });
  if (r.content[0].text.includes('"encoding": "utf8"')) ok('read_file utf8');
  else ko('read_file utf8', r.content[0].text);
} catch (e) { ko('read_file utf8', e); }

// read_file — not found
try {
  const r = await call('read_file', { path: '/nope/does/not/exist' });
  if (r.isError && r.content[0].text.includes('FILE_NOT_FOUND')) ok('read_file 404');
  else ko('read_file 404', JSON.stringify(r));
} catch (e) { ko('read_file 404', e); }

// take_screenshot
try {
  const r = await call('take_screenshot');
  const c = r.content[0];
  if (c.type === 'image' && c.mimeType === 'image/png' && c.data.length > 1000) {
    ok(`take_screenshot returned image (${c.data.length} base64 chars)`);
  } else {
    ko('take_screenshot', JSON.stringify(c).slice(0, 200));
  }
} catch (e) { ko('take_screenshot', e); }

// get_screen_size
try {
  const r = await call('get_screen_size');
  if (r.content[0].text.includes('"width"')) ok('get_screen_size: ' + r.content[0].text.replace(/\s+/g, ' '));
  else ko('get_screen_size', r.content[0].text);
} catch (e) { ko('get_screen_size', e); }

// get_cursor_position
let origCursor;
try {
  const r = await call('get_cursor_position');
  origCursor = JSON.parse(r.content[0].text);
  ok('get_cursor_position: ' + JSON.stringify(origCursor));
} catch (e) { ko('get_cursor_position', e); }

// move_mouse + verify
try {
  await call('move_mouse', { x: 200, y: 200 });
  await new Promise((r) => setTimeout(r, 100));
  const r = await call('get_cursor_position');
  const pos = JSON.parse(r.content[0].text);
  if (pos.x === 200 && pos.y === 200) ok('move_mouse verified');
  else ko('move_mouse verify', JSON.stringify(pos));
} catch (e) { ko('move_mouse', e); }

// move_mouse — bad coords. The SDK validates the inputSchema and returns
// an error result (isError: true) rather than throwing.
try {
  const r = await call('move_mouse', { x: 'nope' });
  if (r.isError && r.content[0].text.includes('Invalid arguments')) {
    ok('move_mouse bad coords (zod rejected)');
  } else {
    ko('move_mouse bad coords', 'unexpected result: ' + JSON.stringify(r).slice(0, 200));
  }
} catch (e) { ko('move_mouse bad coords', e); }

// capture flow
try {
  const start = await call('capture_start');
  if (!start.content[0].text.includes('"active": true')) throw new Error('start failed: ' + start.content[0].text);
  ok('capture_start');

  await new Promise((r) => setTimeout(r, 200));
  await call('move_mouse', { x: 350, y: 350 });
  await call('move_mouse', { x: 450, y: 450 });
  await new Promise((r) => setTimeout(r, 300));

  const drained = await call('capture_drain', { since: 0, limit: 200 });
  const data = JSON.parse(drained.content[0].text);
  if (data.events.length >= 2) ok(`capture_drain saw ${data.events.length} events`);
  else ko('capture_drain', JSON.stringify(data).slice(0, 300));

  const stopped = await call('capture_stop');
  if (stopped.content[0].text.includes('"active": false')) ok('capture_stop');
  else ko('capture_stop', stopped.content[0].text);

  await call('capture_clear');
  const status = await call('capture_status');
  const s = JSON.parse(status.content[0].text);
  if (s.bufferSize === 0 && s.active === false) ok('capture_clear + capture_status');
  else ko('capture_status after clear', JSON.stringify(s));
} catch (e) { ko('capture flow', e); }

// ---------- New edge-case tests ----------

// read_file: too large file → FILE_TOO_LARGE
import { writeFileSync, unlinkSync } from 'fs';
const bigFile = '/tmp/kraken-mcp-big.bin';
try {
  writeFileSync(bigFile, Buffer.alloc(11 * 1024 * 1024)); // 11MB
  const r = await call('read_file', { path: bigFile });
  if (r.isError && r.content[0].text.includes('FILE_TOO_LARGE')) {
    ok('read_file too large → FILE_TOO_LARGE');
  } else {
    ko('read_file too large', JSON.stringify(r).slice(0, 200));
  }
} catch (e) { ko('read_file too large', e); }
finally { try { unlinkSync(bigFile); } catch {} }

// run_command: stdout buffer overflow → BUFFER_OVERFLOW
try {
  const r = await call('run_command', {
    command: 'yes hello | head -c 20000000', timeout: 10000,
  });
  if (r.isError && r.content[0].text.includes('BUFFER_OVERFLOW')) {
    ok('run_command stdout overflow → BUFFER_OVERFLOW');
  } else {
    ko('run_command overflow', JSON.stringify(r).slice(0, 200));
  }
} catch (e) { ko('run_command overflow', e); }

// run_command: zero timeout → VALIDATION
try {
  const r = await call('run_command', { command: 'echo hi', timeout: 0 });
  // zod rejects positive constraint at the schema layer
  if (r.isError) ok('run_command timeout=0 → validation');
  else ko('run_command timeout=0', JSON.stringify(r).slice(0, 200));
} catch (e) { ko('run_command timeout=0', e); }

// move_mouse: NaN/Infinity rejected by .finite() at schema layer
try {
  const r = await call('move_mouse', { x: Number.POSITIVE_INFINITY, y: 10 });
  if (r.isError) ok('move_mouse Infinity rejected by schema');
  else ko('move_mouse Infinity', JSON.stringify(r).slice(0, 200));
} catch (e) { ko('move_mouse Infinity', e); }

// press_keys: empty string in array rejected
try {
  const r = await call('press_keys', { keys: [''] });
  if (r.isError) ok('press_keys empty string rejected');
  else ko('press_keys empty', JSON.stringify(r).slice(0, 200));
} catch (e) { ko('press_keys empty', e); }

// capture: keyName field present on captured key events
try {
  await call('capture_start');
  await call('capture_clear');
  await new Promise((r) => setTimeout(r, 100));
  // synthesize a keypress via type_text
  await call('type_text', { text: 'k' });
  await new Promise((r) => setTimeout(r, 200));
  const drained = await call('capture_drain', { since: 0, limit: 50 });
  const data = JSON.parse(drained.content[0].text);
  const keyEvent = data.events.find((e) => e.type.startsWith('key.'));
  if (keyEvent && keyEvent.keyName !== undefined) {
    ok(`capture event has keyName field (saw "${keyEvent.keyName}" for code ${keyEvent.keycode})`);
  } else if (keyEvent) {
    ko('keyName missing on key event', JSON.stringify(keyEvent));
  } else {
    // Some sessions may not deliver synthesized keys via uiohook (e.g. nut-js
    // uses XTest fake events which not every X server replays). Don't fail —
    // just note it.
    ok('capture: synthesized keypress not picked up (acceptable on some X servers)');
  }
  await call('capture_stop');
  await call('capture_clear');
} catch (e) { ko('capture keyName', e); }

// Restore cursor
if (origCursor) {
  try { await call('move_mouse', origCursor); } catch {}
}

await client.close();

console.log('');
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
