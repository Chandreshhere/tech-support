import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import {
  runCommand,
  runScript,
  readFileSafe,
  captureScreenshot,
  getPlatformInfo,
  getDefaultShell,
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

const app = express();
const PORT = Number(process.env.PORT) || 3000;
// Bind to localhost by default. Set HOST=0.0.0.0 to expose on all interfaces.
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------- Error mapping ----------
// Map a CoreError code → HTTP status. Anything else becomes 500.
const STATUS_BY_CODE = {
  VALIDATION:            400,
  SAFETY_BLOCKED:        403,
  SHELL_NOT_FOUND:       400,
  TIMEOUT:               408,
  FILE_NOT_FOUND:        404,
  PERMISSION_DENIED:     403,
  INVALID_PATH:          400,
  FILE_TOO_LARGE:        413,
  BUFFER_OVERFLOW:       413,
  CAPTURE_UNAVAILABLE:   501,
  INPUT_UNAVAILABLE:     501,
  SCREENSHOT_UNAVAILABLE: 501,
};

function sendCoreError(res, err) {
  if (res.headersSent) return; // can't recover, fall through
  const status = STATUS_BY_CODE[err.code] ?? 500;
  res.status(status).json({
    error: err.message,
    code: err.code,
    ...(err.rule && { rule: err.rule }),
    ...(err.reason && { reason: err.reason }),
    ...(err.path && { path: err.path }),
    ...(err.shell && { shell: err.shell }),
    ...(err.signal && { signal: err.signal }),
    ...(err.size !== undefined && { size: err.size }),
    ...(err.limit !== undefined && { limit: err.limit }),
  });
}

// Wrap an async route so CoreErrors get translated automatically.
const route = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    if (err instanceof CoreError) return sendCoreError(res, err);
    next(err);
  }
};

// Coerce a query param to a single string. Express turns `?path=a&path=b`
// into an array — reject that explicitly so the underlying core function
// doesn't see an unexpected type.
function singleQueryString(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    const err = new Error(`${name} query param must be a single string`);
    err.status = 400;
    throw err;
  }
  return value;
}

// ---------- Contexts + screen docs routes (context-scoped) ----------
import { readFile as fsReadFile, writeFile as fsWriteFile, unlink as fsUnlink, mkdir as fsMkdir } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import {
  CONTEXTS_ROOT,
  resolveContext,
  listContexts,
  getContext,
  createContext,
  updateContext,
  deleteContext,
  screensDirFor,
  listDocs,
  getDoc,
  upsertDoc,
  removeDoc,
  setNotes,
  markAllIndexed,
  getFileStats,
  getContextStats,
  syncScreensFromDisk,
  migrateLegacyScreens,
  migrateSlugDirsToIdDirs,
  getKeySecret,
  listKeys,
  listKeysByProvider,
  createKey,
  updateKey,
  deleteKey,
} from './db.js';
import { getConfig as getAppConfig, setConfigPath } from './config.js';

const execFileAsync = promisify(execFile);

// One-time startup migrations (both are idempotent)
await migrateLegacyScreens();          // /screens → contexts/<id>/screens
await migrateSlugDirsToIdDirs();       // contexts/<slug> → contexts/<id> for older installs

// Track in-flight ingests per context to prevent concurrent runs
const ingestingContexts = new Set();

// Middleware: resolve :id as context (by id or slug) and attach to req
function withContext(req, res, next) {
  const ctx = resolveContext(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'context not found', id: req.params.id });
  req.ctx = ctx;
  next();
}

// ===== Context CRUD =====

app.get('/contexts', (req, res) => {
  res.json({ contexts: listContexts() });
});

app.post('/contexts', async (req, res, next) => {
  try {
    const { name, description } = req.body || {};
    const result = await createContext({ name, description });
    if (result.error === 'validation') {
      return res.status(400).json({ error: result.message });
    }
    if (result.error === 'name-collision') {
      return res.status(409).json({
        error: `A context named "${result.existing}" already exists`,
        conflict: 'name',
        suggestion: 'Pick a different name, or delete/rename the existing context first.',
      });
    }
    res.status(201).json(result.context);
  } catch (err) { next(err); }
});

app.get('/contexts/:id', withContext, (req, res) => {
  res.json({ ...req.ctx, ...getContextStats(req.ctx.id) });
});

app.patch('/contexts/:id', withContext, (req, res) => {
  const { name, slug, description } = req.body || {};
  const result = updateContext(req.ctx.id, { name, slug, description });
  if (result.error === 'not-found') {
    return res.status(404).json({ error: 'context not found' });
  }
  if (result.error === 'validation') {
    return res.status(400).json({ error: result.message });
  }
  if (result.error === 'name-collision') {
    return res.status(409).json({
      error: `A context named "${result.existing}" already exists`,
      conflict: 'name',
      suggestion: 'Pick a different name, or delete/rename the existing context first.',
    });
  }
  if (result.error === 'slug-collision') {
    return res.status(409).json({
      error: `Slug "${result.existing}" is already taken`,
      conflict: 'slug',
      suggestion: 'Pick a different slug (URL-safe identifier), or delete the context using it.',
    });
  }
  res.json(result.context);
});

app.delete('/contexts/:id', withContext, async (req, res, next) => {
  try {
    // Best-effort delete the ChromaDB collection
    try {
      const chromaUrl = getAppConfig().chromadb.url;
      await fetch(`${chromaUrl}/api/v2/collections/${req.ctx.collection}`, {
        method: 'DELETE', signal: AbortSignal.timeout(3000),
      });
    } catch { /* chroma may be down — we still delete locally */ }
    await deleteContext(req.ctx.id);
    res.json({ deleted: true, id: req.ctx.id });
  } catch (err) { next(err); }
});

app.get('/contexts/:id/stats', withContext, (req, res) => {
  res.json(getContextStats(req.ctx.id));
});

// ===== Context-scoped screens =====

app.get('/contexts/:id/screens', withContext, (req, res) => {
  const docs = listDocs(req.ctx.id);
  res.json({
    docs: docs.map(d => ({
      name: d.name,
      status: d.status,
      indexed_at: d.indexed_at,
      updated_at: d.updated_at,
    })),
  });
});

app.get('/contexts/:id/screens/:name', withContext, async (req, res, next) => {
  try {
    const filePath = path.join(screensDirFor(req.ctx), `${req.params.name}.screen.md`);
    const content = await fsReadFile(filePath, 'utf8');
    res.json({ name: req.params.name, content });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'screen doc not found' });
    next(err);
  }
});

app.put('/contexts/:id/screens/:name', withContext, async (req, res, next) => {
  try {
    const dir = screensDirFor(req.ctx);
    await fsMkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${req.params.name}.screen.md`);
    await fsWriteFile(filePath, req.body.content, 'utf8');
    const doc = upsertDoc(req.ctx.id, req.params.name, filePath, req.body.content);
    res.json({ name: req.params.name, saved: true, status: doc.status });
  } catch (err) { next(err); }
});

app.post('/contexts/:id/screens', withContext, async (req, res, next) => {
  try {
    const { name, content } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    // Prevent collision
    if (getDoc(req.ctx.id, name)) {
      return res.status(409).json({ error: 'a screen doc with that name already exists in this context' });
    }
    const dir = screensDirFor(req.ctx);
    await fsMkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.screen.md`);
    const body = content || `# ${name}\n\n`;
    await fsWriteFile(filePath, body, 'utf8');
    const doc = upsertDoc(req.ctx.id, name, filePath, body);
    res.status(201).json({ name, created: true, status: doc.status });
  } catch (err) { next(err); }
});

app.delete('/contexts/:id/screens/:name', withContext, async (req, res, next) => {
  try {
    const filePath = path.join(screensDirFor(req.ctx), `${req.params.name}.screen.md`);
    try { await fsUnlink(filePath); } catch { /* ok if already gone */ }
    removeDoc(req.ctx.id, req.params.name);
    res.json({ name: req.params.name, deleted: true });
  } catch (err) { next(err); }
});

app.get('/contexts/:id/screens/:name/meta', withContext, async (req, res, next) => {
  try {
    const doc = getDoc(req.ctx.id, req.params.name);
    if (!doc) return res.status(404).json({ error: 'not found' });
    const fileStats = await getFileStats(req.ctx.id, req.params.name);
    res.json({
      name: doc.name,
      filePath: doc.file_path,
      status: doc.status,
      fileHash: doc.file_hash,
      indexedHash: doc.indexed_hash,
      indexedAt: doc.indexed_at,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      customNotes: doc.custom_notes,
      ...fileStats,
    });
  } catch (err) { next(err); }
});

app.put('/contexts/:id/screens/:name/meta', withContext, (req, res) => {
  const { customNotes } = req.body || {};
  if (typeof customNotes !== 'string') {
    return res.status(400).json({ error: 'customNotes (string) required' });
  }
  const doc = setNotes(req.ctx.id, req.params.name, customNotes);
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json({ name: doc.name, customNotes: doc.custom_notes });
});

// ===== Context-scoped RAG ingest =====

app.post('/contexts/:id/ingest', withContext, async (req, res, next) => {
  if (ingestingContexts.has(req.ctx.id)) {
    return res.status(409).json({ error: 'ingest already in progress for this context' });
  }
  ingestingContexts.add(req.ctx.id);
  try {
    const agentPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../agent/index.js'
    );
    const dir = screensDirFor(req.ctx);
    try {
      await execFileAsync('node', [agentPath, '--ingest'], {
        timeout: 180_000,
        env: {
          ...process.env,
          KRAKEN_COLLECTION: req.ctx.collection,
          KRAKEN_SCREENS_DIR: dir,
        },
      });
    } catch (err) {
      return res.status(502).json({
        error: 'agent ingest failed',
        details: err.stderr?.toString?.() || err.message,
      });
    }
    const docs = markAllIndexed(req.ctx.id);
    res.json({ ingested: docs.length, docs: docs.map(d => ({ name: d.name, status: d.status })) });
  } catch (err) { next(err); }
  finally { ingestingContexts.delete(req.ctx.id); }
});

// ---------- Config (editable JSON) ----------

app.get('/config', (req, res) => {
  res.json(getAppConfig());
});

app.patch('/config', (req, res) => {
  const { path: dotPath, value } = req.body || {};
  if (!dotPath || typeof dotPath !== 'string') {
    return res.status(400).json({ error: 'path (string) required' });
  }
  try {
    const updated = setConfigPath(dotPath, value);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- API keys (named secrets) ----------

app.get('/keys', (req, res) => {
  const provider = req.query.provider;
  res.json({ keys: provider ? listKeysByProvider(provider) : listKeys() });
});

app.post('/keys', (req, res) => {
  const { name, provider, secret } = req.body || {};
  if (!name || !provider || !secret) {
    return res.status(400).json({ error: 'name, provider, and secret required' });
  }
  try {
    res.json(createKey({ name, provider, secret }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/keys/:id', (req, res) => {
  const { name, secret } = req.body || {};
  const updated = updateKey(req.params.id, { name, secret });
  if (!updated) return res.status(404).json({ error: 'key not found' });
  res.json(updated);
});

app.delete('/keys/:id', (req, res) => {
  const ok = deleteKey(req.params.id);
  if (!ok) return res.status(404).json({ error: 'key not found' });
  // Also clear any references in config.llm.*.activeKeyId that pointed to this key
  const cfg = getAppConfig();
  for (const provider of ['gemini', 'groq', 'openrouter']) {
    if (cfg.llm?.[provider]?.activeKeyId === req.params.id) {
      setConfigPath(`llm.${provider}.activeKeyId`, null);
    }
  }
  res.json({ deleted: true });
});

// ---------- System info (read-only, detected from the running process) ----------
app.get('/config/system', (req, res) => {
  const info = getPlatformInfo();
  res.json({
    platform: info.platform,
    arch: info.arch,
    release: info.release,
    hostname: info.hostname,
    nodeVersion: info.nodeVersion,
    cpus: info.cpus,
    totalMemoryGB: +(info.totalMemory / 1024 / 1024 / 1024).toFixed(1),
    display: process.env.DISPLAY || '—',
    waylandDisplay: process.env.WAYLAND_DISPLAY || '—',
    sessionType: process.env.XDG_SESSION_TYPE || '—',
    xauthority: process.env.XAUTHORITY || '—',
    shell: info.shell,
    mcpTools: 21,
    screenshotTool: 'gnome-screenshot',
  });
});

// ---------- ChromaDB health (pings the configured URL) ----------
app.get('/config/chroma', async (req, res) => {
  const chromaUrl = getAppConfig().chromadb.url;
  try {
    const response = await fetch(`${chromaUrl}/api/v2/heartbeat`, { signal: AbortSignal.timeout(3000) });
    res.json({ url: chromaUrl, status: response.ok ? 'connected' : 'error' });
  } catch {
    res.json({ url: chromaUrl, status: 'unreachable' });
  }
});

// ---------- Global RAG info (no per-context stats — use /contexts/:id/stats) ----------
app.get('/config/rag', (req, res) => {
  const cfg = getAppConfig();
  res.json({
    embeddingModel: cfg.embeddings.model,
    dimensions: cfg.embeddings.dimensions,
  });
});

// ---------- Routes ----------

app.get('/', (req, res) => {
  res.json({ name: 'kraken-assist-backend', version: '1.0.0' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/system', (req, res) => {
  res.json(getPlatformInfo());
});

// ---- screenshot ----
app.post('/screenshot', route(async (req, res) => {
  const img = await captureScreenshot();
  if (req.query.format === 'base64') {
    res.json({ format: 'png', data: img.toString('base64') });
  } else {
    res.set('Content-Type', 'image/png');
    res.send(img);
  }
}));

// ---- file read ----
app.get('/file', route(async (req, res) => {
  const filePath = singleQueryString(req.query.path, 'path');
  const encoding = singleQueryString(req.query.encoding, 'encoding') || 'utf8';
  const result = await readFileSafe(filePath, encoding);
  res.json(result);
}));

// ---- exec (command or script) ----
app.post('/exec', route(async (req, res) => {
  const { command, script, shell, cwd, timeout } = req.body || {};

  if (!command && !script) {
    return res.status(400).json({ error: 'either command or script (string) required in body' });
  }
  if (command && script) {
    return res.status(400).json({ error: 'provide either command or script, not both' });
  }

  const result = script
    ? await runScript({ script, shell, cwd, timeout })
    : await runCommand({ command, shell, cwd, timeout });

  res.json(result);
}));

// ---- input synthesis ----
app.post('/input/type', route(async (req, res) => {
  const { text } = req.body || {};
  res.json(await typeText(text));
}));

app.post('/input/key', route(async (req, res) => {
  const { keys } = req.body || {};
  res.json(await pressKeys(keys));
}));

app.post('/input/click', route(async (req, res) => {
  res.json(await clickMouse(req.body || {}));
}));

app.post('/input/move', route(async (req, res) => {
  res.json(await moveMouse(req.body || {}));
}));

app.get('/input/cursor', route(async (req, res) => {
  res.json(await getCursorPosition());
}));

app.get('/input/screen', route(async (req, res) => {
  res.json(await getScreenSize());
}));

// ---- global capture (keylog) ----
app.get('/capture/status', route(async (req, res) => {
  res.json(getCaptureStatus());
}));

app.post('/capture/start', route(async (req, res) => {
  res.json(startCapture());
}));

app.post('/capture/stop', route(async (req, res) => {
  res.json(stopCapture());
}));

app.post('/capture/clear', route(async (req, res) => {
  res.json(clearCapture());
}));

app.get('/capture/events', route(async (req, res) => {
  const since = req.query.since !== undefined ? Number(req.query.since) : 0;
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : 1000;
  if (Number.isNaN(since)) return res.status(400).json({ error: 'since must be a number' });
  if (Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' });
  res.json(drainEvents(since, limit));
}));

// ---- feedback loop ----
app.get('/feedback/status', route(async (req, res) => {
  res.json(getFeedbackStatus());
}));

app.post('/feedback/start', route(async (req, res) => {
  const { intervalMs, ringSize } = req.body || {};
  res.json(startFeedback({ intervalMs, ringSize }));
}));

app.post('/feedback/stop', route(async (req, res) => {
  res.json(stopFeedback());
}));

app.post('/feedback/clear', route(async (req, res) => {
  res.json(clearFeedback());
}));

app.get('/feedback/drain', route(async (req, res) => {
  const since = req.query.since !== undefined ? Number(req.query.since) : 0;
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : 1;
  if (Number.isNaN(since)) return res.status(400).json({ error: 'since must be a number' });
  if (Number.isNaN(limit)) return res.status(400).json({ error: 'limit must be a number' });
  res.json(drainFeedback(since, limit));
}));

// ---------- Agent runs (context-scoped) ----------
import { Agent } from 'kraken-assist-agent/agent.service.js';
import { reloadKeys as reloadLlmKeys } from 'kraken-assist-agent/llm.service.js';
import { randomUUID as agentRunId } from 'crypto';

// In-memory run registry. Persists for the lifetime of the backend process.
// runId → { runId, contextId, task, agent, status, result, startedAt, completedAt, pauseReason, pauseMessage }
const agentRuns = new Map();
// Enforce one active run at a time globally (single-user local tool)
let runningRunId = null;

function setApiKeysFromConfig() {
  // Push ALL stored keys (per provider) into process.env so the agent's
  // llm.service can rotate through them when one hits a rate limit.
  // Each key gets its own env var named with a short slug of its UUID.
  // The active key is marked via LLM_<PROVIDER>_KEY_NAME.
  const cfg = getAppConfig();
  const allKeys = listKeys();

  // Clear any previous pushes so stale keys aren't left in env
  const PROVIDERS = ['gemini', 'groq', 'openrouter'];
  for (const envKey of Object.keys(process.env)) {
    for (const p of PROVIDERS) {
      if (envKey.startsWith(`${p.toUpperCase()}_API_KEY_`)) {
        delete process.env[envKey];
        break;
      }
    }
  }

  for (const provider of PROVIDERS) {
    const providerKeys = allKeys.filter(k => k.provider === provider);
    for (const k of providerKeys) {
      const secret = getKeySecret(k.id);
      if (!secret) continue;
      const keySlug = k.id.slice(0, 8);
      process.env[`${provider.toUpperCase()}_API_KEY_${keySlug}`] = secret;
    }
    // Mark the active key by its slug (falls through to "first available" if none active)
    const activeId = cfg.llm?.[provider]?.activeKeyId;
    if (activeId) {
      process.env[`LLM_${provider.toUpperCase()}_KEY_NAME`] = activeId.slice(0, 8);
    } else {
      delete process.env[`LLM_${provider.toUpperCase()}_KEY_NAME`];
    }
  }

  if (cfg.llm?.activeProvider) process.env.LLM_MODEL = cfg.llm.activeProvider;
  if (cfg.llm?.gemini?.activeModel) process.env.GEMINI_MODEL = cfg.llm.gemini.activeModel;
  if (cfg.llm?.groq?.activeModel) process.env.GROQ_MODEL = cfg.llm.groq.activeModel;
  if (cfg.llm?.openrouter?.activeModel) process.env.OPENROUTER_MODEL = cfg.llm.openrouter.activeModel;
  if (cfg.chromadb?.url) process.env.CHROMA_URL = cfg.chromadb.url;
  if (cfg.embeddings?.model) process.env.EMBEDDING_MODEL = cfg.embeddings.model;

  reloadLlmKeys();
}

// Launch a new agent run for a context. Blocks until the run reaches a
// terminal state (done / failed / paused / cancelled). The caller can poll
// or use the returned runId with subsequent resume/cancel calls.
app.post('/contexts/:id/agent/run', withContext, async (req, res, next) => {
  const { task } = req.body || {};
  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({ error: 'task (string) required' });
  }
  if (runningRunId && agentRuns.get(runningRunId)?.status === 'running') {
    return res.status(409).json({
      error: 'an agent run is already in progress',
      runningRunId,
    });
  }

  const runId = agentRunId();
  setApiKeysFromConfig();

  const cfg = getAppConfig();
  const agent = new Agent({
    maxSteps: cfg.agent?.maxSteps || 30,
    maxRetries: cfg.agent?.maxRetries || 3,
    collection: req.ctx.collection,
    screensDir: screensDirFor(req.ctx),
  });

  const run = {
    runId,
    contextId: req.ctx.id,
    task: task.trim(),
    agent,
    status: 'running',
    result: null,
    startedAt: Date.now(),
    completedAt: null,
  };
  agentRuns.set(runId, run);
  runningRunId = runId;

  try {
    const result = await agent.run(task.trim());
    run.result = result;
    run.status = result.status;   // 'done' | 'failed' | 'paused'
    run.pauseReason = result.pauseReason;
    run.pauseMessage = result.pauseMessage;
    if (result.status !== 'paused') run.completedAt = Date.now();
  } catch (err) {
    run.status = 'failed';
    run.result = { status: 'failed', success: false, summary: err.message };
    run.completedAt = Date.now();
  } finally {
    if (run.status !== 'paused') runningRunId = null;
  }

  res.json({
    runId: run.runId,
    status: run.status,
    result: run.result,
    pauseReason: run.pauseReason,
    pauseMessage: run.pauseMessage,
  });
});

// Resume a paused run. Takes a fresh screenshot in the agent, which enters
// the loop with the existing conversation + the new screen state.
app.post('/contexts/:id/agent/runs/:runId/resume', withContext, async (req, res) => {
  const run = agentRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.contextId !== req.ctx.id) return res.status(404).json({ error: 'run does not belong to this context' });
  if (run.status !== 'paused') return res.status(409).json({ error: `run is ${run.status}, not paused` });

  const { note } = req.body || {};
  run.status = 'running';
  run.pauseReason = null;
  run.pauseMessage = null;
  runningRunId = run.runId;

  try {
    const result = await run.agent.resume(note);
    run.result = result;
    run.status = result.status;
    run.pauseReason = result.pauseReason;
    run.pauseMessage = result.pauseMessage;
    if (result.status !== 'paused') run.completedAt = Date.now();
  } catch (err) {
    run.status = 'failed';
    run.result = { status: 'failed', success: false, summary: err.message };
    run.completedAt = Date.now();
  } finally {
    if (run.status !== 'paused') runningRunId = null;
  }

  res.json({
    runId: run.runId,
    status: run.status,
    result: run.result,
    pauseReason: run.pauseReason,
    pauseMessage: run.pauseMessage,
  });
});

// Snapshot of the current run state (for polling / post-refresh recovery)
app.get('/contexts/:id/agent/runs/:runId', withContext, (req, res) => {
  const run = agentRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.contextId !== req.ctx.id) return res.status(404).json({ error: 'run does not belong to this context' });
  res.json({
    runId: run.runId,
    contextId: run.contextId,
    task: run.task,
    status: run.status,
    result: run.result,
    pauseReason: run.pauseReason,
    pauseMessage: run.pauseMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  });
});

// Return the currently executing (or most recently active) run for this
// context, including the live step history. Used by the frontend to poll
// and stream each step the agent takes while the long-poll on /agent/run
// hasn't returned yet.
app.get('/contexts/:id/agent/current', withContext, (req, res) => {
  // Prefer the globally-running run if it belongs to this context
  let run = null;
  if (runningRunId) {
    const r = agentRuns.get(runningRunId);
    if (r && r.contextId === req.ctx.id) run = r;
  }
  // Otherwise return the most recent run for this context (any status)
  if (!run) {
    const candidates = [...agentRuns.values()]
      .filter(r => r.contextId === req.ctx.id)
      .sort((a, b) => b.startedAt - a.startedAt);
    run = candidates[0];
  }
  if (!run) return res.json({ run: null });
  res.json({
    run: {
      runId: run.runId,
      status: run.status,
      task: run.task,
      history: run.agent?.history || [],
      stats: run.agent?.stats || {},
      phase: run.agent?.phase || 'idle',             // current stage of the loop
      phaseDetail: run.agent?.phaseDetail || '',
      phaseSince: run.agent?.phaseSince || null,
      ragResult: run.agent?.ragResult || null,       // retrieved screen docs for this run
      plan: run.agent?.plan || null,                 // structured plan from the planning step
      pauseReason: run.pauseReason,
      pauseMessage: run.pauseMessage,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    },
  });
});

// Cancel whichever run is currently executing for this context. Used by the
// frontend's Stop button, which doesn't know the runId because the long-poll
// on /agent/run hasn't returned yet.
app.post('/contexts/:id/agent/cancel-current', withContext, (req, res) => {
  if (!runningRunId) return res.status(404).json({ error: 'no run in progress' });
  const run = agentRuns.get(runningRunId);
  if (!run || run.contextId !== req.ctx.id) {
    return res.status(404).json({ error: 'no run in progress for this context' });
  }
  if (run.agent && typeof run.agent.cancel === 'function') {
    run.agent.cancel();
  }
  res.json({ cancelled: true, runId: run.runId });
});

// Cancel a run (best-effort; already-in-flight LLM calls will still finish,
// but the loop will exit before the next step instead of running to maxSteps).
app.post('/contexts/:id/agent/runs/:runId/cancel', withContext, (req, res) => {
  const run = agentRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'run not found' });
  if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
    return res.status(409).json({ error: `run already ${run.status}` });
  }
  // Signal the agent loop to stop. The POST /agent/run handler will observe
  // the returned 'failed' result and update run.status itself; here we only
  // need to flip the flag and release the runningRunId slot optimistically.
  if (run.agent && typeof run.agent.cancel === 'function') {
    run.agent.cancel();
  }
  if (runningRunId === run.runId) runningRunId = null;
  res.json({ cancelled: true, runId: run.runId });
});

// ---------- 404 (JSON) ----------
app.use((req, res) => {
  res.status(404).json({ error: 'not found', method: req.method, path: req.path });
});

// ---------- Generic error handler ----------
// Catches anything thrown out of route handlers (including JSON body parser
// errors and malformed-JSON 400s from express). Skips writing if a response
// was already partially sent.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error('[backend]', err);
  }
  res.status(status).json({
    error: status >= 500 ? 'Internal server error' : err.message || 'Bad request',
    ...(status < 500 && err.message ? { message: err.message } : {}),
  });
});

// ---------- Boot ----------
const server = app.listen(PORT, HOST, () => {
  console.log(`kraken-assist backend listening on http://${HOST}:${PORT}  (default shell: ${getDefaultShell()})`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[backend] port ${PORT} is already in use on ${HOST}. Set PORT=<other> or stop the other process.`);
  } else if (err.code === 'EACCES') {
    console.error(`[backend] permission denied binding to ${HOST}:${PORT}. Try a port >= 1024.`);
  } else {
    console.error('[backend] listen error:', err);
  }
  process.exit(1);
});

// ---------- Graceful shutdown ----------
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[backend] received ${signal}, shutting down...`);
  shutdownFeedback();
  shutdownCapture();
  server.close((err) => {
    if (err) {
      console.error('[backend] server.close error:', err);
      process.exit(1);
    }
    process.exit(0);
  });
  // Hard cap: if anything is hung, force-exit after 5s.
  setTimeout(() => {
    console.error('[backend] forced exit after timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP',  () => gracefulShutdown('SIGHUP'));

// Surface unexpected failures instead of dying silently.
process.on('uncaughtException', (err) => {
  console.error('[backend] uncaughtException:', err);
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[backend] unhandledRejection:', reason);
});
