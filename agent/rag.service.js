// RAG service: ChromaDB vector store for screen documentation.
//
// Each .md file is one document (no splitting). Documents are embedded
// locally via transformers.js and stored in ChromaDB with metadata.
// Queries embed the task description locally and retrieve the top-K
// most similar screen docs.
//
// Collection name and source directory can be specified three ways:
//   1. Explicit options param (highest priority) — for multi-context use
//   2. process.env.KRAKEN_COLLECTION / KRAKEN_SCREENS_DIR — for CLI / backend-spawn
//   3. Built-in defaults — for standalone CLI runs against legacy /screens
//
// No caching of collection objects at module scope — each call resolves
// fresh, so multiple contexts can share one process without stomping on
// each other's state.

import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { ChromaClient } from 'chromadb';
import { getEmbeddings } from './embeddings.service.js';
import * as log from './logger.js';

const COMP = 'rag';

const DEFAULT_SCREENS_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../screens'
);

function resolveCollection(opts = {}) {
  return opts.collection || process.env.KRAKEN_COLLECTION || 'kraken-screens';
}

function resolveScreensDir(opts = {}) {
  if (opts.screensDir) return path.resolve(opts.screensDir);
  if (process.env.KRAKEN_SCREENS_DIR) return path.resolve(process.env.KRAKEN_SCREENS_DIR);
  return DEFAULT_SCREENS_DIR;
}

// Feature category inference from filename
const CATEGORY_MAP = {
  login: 'auth', signup: 'auth', 'forgot-password': 'auth', register: 'auth',
  home: 'core', channel: 'core', dm: 'core', 'voice-channel': 'core',
  friends: 'social', 'friend-requests': 'social',
  'user-settings': 'settings', 'account-settings': 'settings',
  'server-settings': 'settings', 'privacy-settings': 'settings',
  'notification-settings': 'settings',
  search: 'utility', 'create-server': 'utility', 'invite': 'utility',
  'navigation-overview': 'meta',
};

function inferCategory(filename) {
  const base = filename.replace(/\.screen\.md$/i, '').toLowerCase();
  return CATEGORY_MAP[base] || 'other';
}

// ---------- ChromaDB client (fresh per call) ----------
// Do NOT cache the client as a module-level singleton. ChromaClient holds
// no persistent socket — it is a thin HTTP wrapper — so creating one per
// call is essentially free. The singleton pattern caused a hard-to-diagnose
// bug: if ChromaDB is down when the backend process starts, the first
// getClient() call creates an object that internally marks the server as
// unreachable. Every subsequent call in the same process reuses that stale
// object and keeps failing even after ChromaDB recovers.

function getClient() {
  const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
  return new ChromaClient({ path: chromaUrl });
}

/** Fetch (or create) a collection. Not cached — cheap to call. */
async function openCollection(name) {
  return getClient().getOrCreateCollection({
    name,
    metadata: { description: 'UI screen documentation for kraken-assist agent' },
  });
}

// ---------- Public API ----------

/**
 * Check that ChromaDB is reachable. Throws if not.
 */
export async function healthCheck() {
  try {
    const hb = await getClient().heartbeat();
    log.info(COMP, 'ChromaDB healthy', { heartbeat: hb });
    return true;
  } catch (err) {
    throw new Error(
      `ChromaDB unreachable at ${process.env.CHROMA_URL || 'http://localhost:8000'}. ` +
      `Start it with: chroma run --host 0.0.0.0 --port 8000. ` +
      `Original error: ${err.message}`
    );
  }
}

/**
 * Read all *.screen.md files from the source dir, embed them locally,
 * and upsert into the target ChromaDB collection.
 *
 * @param {object} [opts]
 * @param {string} [opts.screensDir] - Source directory (overrides env/default)
 * @param {string} [opts.collection] - Target collection (overrides env/default)
 * @returns {{ ingested: number, collection: string }}
 */
export async function ingestScreenDocs(opts = {}) {
  const dir = resolveScreensDir(opts);
  const collectionName = resolveCollection(opts);

  const files = (await readdir(dir)).filter(f => f.endsWith('.screen.md'));
  if (files.length === 0) {
    throw new Error(`no *.screen.md files found in ${dir}`);
  }

  log.info(COMP, `ingesting ${files.length} docs from ${dir} → ${collectionName}`);

  const ids = [];
  const documents = [];
  const metadatas = [];

  for (const file of files) {
    const content = await readFile(path.join(dir, file), 'utf8');
    const screenName = file.replace(/\.screen\.md$/i, '');
    ids.push(screenName);
    documents.push(content);
    metadatas.push({
      screenName,
      featureCategory: inferCategory(file),
      fileName: file,
    });
  }

  const embeddings = getEmbeddings();
  const vectors = await embeddings.embedDocuments(documents);

  const col = await openCollection(collectionName);
  await col.upsert({ ids, documents, metadatas, embeddings: vectors });

  log.info(COMP, `upserted ${ids.length} docs into "${collectionName}"`);
  return { ingested: ids.length, collection: collectionName };
}

/**
 * Query for screens relevant to a task description.
 *
 * @param {string} taskDescription
 * @param {number} [topK=5]
 * @param {object} [opts]
 * @param {string} [opts.collection] - Target collection (overrides env/default)
 */
export async function queryScreens(taskDescription, topK = 5, opts = {}) {
  const collectionName = resolveCollection(opts);
  const embeddings = getEmbeddings();
  const queryVector = await embeddings.embedQuery(taskDescription);

  const col = await openCollection(collectionName);
  const results = await col.query({
    queryEmbeddings: [queryVector],
    nResults: topK,
  });

  const screens = [];
  if (results.ids && results.ids[0]) {
    for (let i = 0; i < results.ids[0].length; i++) {
      screens.push({
        screenName: results.ids[0][i],
        content: results.documents[0][i],
        score: results.distances ? 1 / (1 + results.distances[0][i]) : null,
        featureCategory: results.metadatas?.[0]?.[i]?.featureCategory || 'other',
      });
    }
  }

  log.info(COMP, `query "${taskDescription.slice(0, 60)}..." in ${collectionName} → ${screens.length} results`);
  return screens;
}

/**
 * Delete a collection. Useful for a clean re-ingest.
 */
export async function deleteCollection(opts = {}) {
  const collectionName = resolveCollection(opts);
  try {
    await getClient().deleteCollection({ name: collectionName });
    log.info(COMP, `deleted collection "${collectionName}"`);
  } catch { /* didn't exist — fine */ }
}
