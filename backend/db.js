// Local SQLite database for tracking software contexts, screen docs,
// and API keys. Uses better-sqlite3 (embedded, synchronous, zero-config).

import Database from 'better-sqlite3';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { readFile, stat, readdir, mkdir, rename, rm } from 'fs/promises';
import { existsSync } from 'fs';

const DB_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'kraken-assist.db'
);

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..'
);

export const LEGACY_SCREENS_DIR = path.join(PROJECT_ROOT, 'screens');
export const CONTEXTS_ROOT = path.join(PROJECT_ROOT, 'contexts');

// ---------- DB init ----------

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS contexts (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    collection  TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    provider      TEXT NOT NULL,
    secret        TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER,
    usage_count   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
`);

// ---------- screen_docs migration (flat → context-scoped) ----------
// The old schema had `name` as PK and no context_id. We can't ALTER PK in SQLite,
// so we create a new table, copy data if any, and swap.

function migrateScreenDocsSchema() {
  const currentColumns = db.prepare("PRAGMA table_info(screen_docs)").all().map(r => r.name);
  const hasContextId = currentColumns.includes('context_id');
  const tableExists = currentColumns.length > 0;

  if (tableExists && hasContextId) return; // already migrated

  // Fresh or old-schema: drop any old table, create the new one.
  // Row-level state (indexed_at, custom_notes) is rebuilt from disk by the
  // legacy-screens migrator below — the .md files on disk are the source of
  // truth. Users will need to re-index into the new collection anyway.
  if (tableExists) db.exec('DROP TABLE screen_docs');

  db.exec(`
    CREATE TABLE screen_docs (
      context_id   TEXT NOT NULL REFERENCES contexts(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      file_path    TEXT NOT NULL,
      file_hash    TEXT NOT NULL,
      indexed_at   INTEGER,
      indexed_hash TEXT,
      custom_notes TEXT NOT NULL DEFAULT '',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (context_id, name)
    );
  `);
}

migrateScreenDocsSchema();

// ---------- Slug helper ----------

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'context';
}

function uniqueSlug(base, excludeId = null) {
  const root = slugify(base);
  let slug = root;
  let suffix = 1;
  const check = db.prepare('SELECT 1 FROM contexts WHERE slug = ? AND id != ?');
  while (check.get(slug, excludeId ?? '')) {
    suffix++;
    slug = `${root}-${suffix}`;
  }
  return slug;
}

function nameExists(name, excludeId = null) {
  return !!db.prepare(
    'SELECT 1 FROM contexts WHERE LOWER(name) = LOWER(?) AND id != ?'
  ).get(name, excludeId ?? '');
}

function slugExists(slug, excludeId = null) {
  return !!db.prepare(
    'SELECT 1 FROM contexts WHERE slug = ? AND id != ?'
  ).get(slug, excludeId ?? '');
}

// ---------- Hashing ----------

export function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ---------- Context queries ----------

const ctxQueries = {
  getAll: db.prepare('SELECT * FROM contexts ORDER BY created_at DESC'),
  getOne: db.prepare('SELECT * FROM contexts WHERE id = ?'),
  getBySlug: db.prepare('SELECT * FROM contexts WHERE slug = ?'),
  insert: db.prepare(`
    INSERT INTO contexts (id, slug, name, description, collection, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  update: db.prepare(`
    UPDATE contexts SET name = ?, slug = ?, description = ?, updated_at = ? WHERE id = ?
  `),
  remove: db.prepare('DELETE FROM contexts WHERE id = ?'),
};

/** Resolve a context by its id (preferred) or slug (fallback). */
export function resolveContext(idOrSlug) {
  if (!idOrSlug) return null;
  return ctxQueries.getOne.get(idOrSlug) || ctxQueries.getBySlug.get(idOrSlug) || null;
}

/**
 * Physical storage paths are derived from the immutable context id — NOT the
 * mutable slug. This means renaming a context is a cheap metadata update: no
 * folders get renamed, no ChromaDB collections get recreated.
 */
export function screensDirFor(ctx) {
  if (!ctx) return null;
  return path.join(CONTEXTS_ROOT, ctx.id, 'screens');
}

export function collectionNameFor(ctx) {
  // Short form of the UUID for readability in ChromaDB. 8 hex chars → 4 billion
  // combinations, more than enough uniqueness for a local tool. Stored in the
  // `collection` column so it's stable even if we ever change this derivation.
  if (!ctx) return null;
  return ctx.collection;
}

export function listContexts() {
  return ctxQueries.getAll.all().map((ctx) => {
    const stats = getContextStats(ctx.id);
    return {
      id: ctx.id,
      slug: ctx.slug,
      name: ctx.name,
      description: ctx.description,
      collection: ctx.collection,
      created_at: ctx.created_at,
      updated_at: ctx.updated_at,
      ...stats,
    };
  });
}

export function getContext(idOrSlug) {
  const ctx = resolveContext(idOrSlug);
  if (!ctx) return null;
  const stats = getContextStats(ctx.id);
  return { ...ctx, ...stats };
}

export async function createContext({ name, description }) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return { error: 'validation', message: 'context name is required' };
  }
  if (nameExists(trimmed)) {
    return { error: 'name-collision', existing: trimmed };
  }

  const id = randomUUID();
  const slug = uniqueSlug(trimmed);
  // Collection name derived from the immutable id, so renaming the context
  // never requires recreating the collection. Short-UUID prefix keeps it
  // readable in ChromaDB's admin.
  const collection = `kraken-${id.slice(0, 8)}`;
  const now = Date.now();

  ctxQueries.insert.run(id, slug, trimmed, description || '', collection, now, now);

  // Ensure id-based storage folder exists
  const screensDir = path.join(CONTEXTS_ROOT, id, 'screens');
  await mkdir(screensDir, { recursive: true });

  // If files happen to already be there (manual drop-in), sync them now
  await syncScreensFromDisk(id);

  return { ok: true, context: getContext(id) };
}

/**
 * Update a context's display name / slug / description. Physical storage
 * (folder + ChromaDB collection) is untouched because they're keyed by the
 * immutable id. Uniqueness validated on both name (case-insensitive) and
 * slug — returns structured errors for the route layer to translate to 409.
 */
export function updateContext(idOrSlug, { name, slug, description }) {
  const ctx = resolveContext(idOrSlug);
  if (!ctx) return { error: 'not-found' };

  const newName = (name ?? ctx.name).trim();
  const newDesc = description ?? ctx.description;
  let newSlug = ctx.slug;

  // Validate new name
  if (!newName) {
    return { error: 'validation', message: 'name cannot be empty' };
  }
  if (newName !== ctx.name && nameExists(newName, ctx.id)) {
    return { error: 'name-collision', existing: newName };
  }

  // Slug: explicit override OR auto-regenerate from new name when name changed
  if (slug !== undefined) {
    const desired = slugify(slug);
    if (!desired) return { error: 'validation', message: 'slug is invalid' };
    if (desired !== ctx.slug && slugExists(desired, ctx.id)) {
      return { error: 'slug-collision', existing: desired };
    }
    newSlug = desired;
  } else if (newName !== ctx.name) {
    newSlug = uniqueSlug(newName, ctx.id);
  }

  ctxQueries.update.run(newName, newSlug, newDesc, Date.now(), ctx.id);
  return { ok: true, context: getContext(ctx.id) };
}

export async function deleteContext(idOrSlug) {
  const ctx = resolveContext(idOrSlug);
  if (!ctx) return false;
  ctxQueries.remove.run(ctx.id); // CASCADE drops screen_docs rows
  const folder = path.join(CONTEXTS_ROOT, ctx.id); // id-based storage
  try { await rm(folder, { recursive: true, force: true }); } catch { /* ignore */ }
  return true;
}

// ---------- Screen doc queries (context-scoped) ----------

const docQueries = {
  getAll: db.prepare('SELECT * FROM screen_docs WHERE context_id = ? ORDER BY name'),
  getOne: db.prepare('SELECT * FROM screen_docs WHERE context_id = ? AND name = ?'),
  insert: db.prepare(`
    INSERT INTO screen_docs (context_id, name, file_path, file_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(context_id, name) DO UPDATE SET
      file_path = excluded.file_path,
      file_hash = excluded.file_hash,
      updated_at = excluded.updated_at
  `),
  markIndexed: db.prepare(`
    UPDATE screen_docs SET indexed_at = ?, indexed_hash = ? WHERE context_id = ? AND name = ?
  `),
  markAllIndexed: db.prepare(`
    UPDATE screen_docs SET indexed_at = ?, indexed_hash = file_hash WHERE context_id = ?
  `),
  setNotes: db.prepare(`
    UPDATE screen_docs SET custom_notes = ?, updated_at = ? WHERE context_id = ? AND name = ?
  `),
  remove: db.prepare('DELETE FROM screen_docs WHERE context_id = ? AND name = ?'),
};

export function indexStatus(row) {
  if (!row) return 'unknown';
  if (!row.indexed_at) return 'not-indexed';
  if (row.indexed_hash !== row.file_hash) return 'stale';
  return 'indexed';
}

export function listDocs(contextId) {
  return docQueries.getAll.all(contextId).map(r => ({ ...r, status: indexStatus(r) }));
}

export function getDoc(contextId, name) {
  const row = docQueries.getOne.get(contextId, name);
  return row ? { ...row, status: indexStatus(row) } : null;
}

export function upsertDoc(contextId, name, filePath, content) {
  const now = Date.now();
  const hash = hashContent(content);
  docQueries.insert.run(contextId, name, filePath, hash, now, now);
  return getDoc(contextId, name);
}

export function markAllIndexed(contextId) {
  docQueries.markAllIndexed.run(Date.now(), contextId);
  return listDocs(contextId);
}

export function setNotes(contextId, name, notes) {
  docQueries.setNotes.run(notes, Date.now(), contextId, name);
  return getDoc(contextId, name);
}

export function removeDoc(contextId, name) {
  docQueries.remove.run(contextId, name);
}

export async function getFileStats(contextId, name) {
  const doc = getDoc(contextId, name);
  if (!doc) return null;
  try {
    const info = await stat(doc.file_path);
    return {
      size: info.size,
      birthtime: info.birthtime.toISOString(),
      mtime: info.mtime.toISOString(),
      filePath: doc.file_path,
    };
  } catch { return null; }
}

export function getContextStats(contextId) {
  const rows = docQueries.getAll.all(contextId);
  const total = rows.length;
  const indexed = rows.filter(r => indexStatus(r) === 'indexed').length;
  const stale = rows.filter(r => indexStatus(r) === 'stale').length;
  const notIndexed = rows.filter(r => indexStatus(r) === 'not-indexed').length;
  return { total, indexed, stale, notIndexed };
}

// ---------- Disk sync ----------

export async function syncScreensFromDisk(contextId) {
  const ctx = resolveContext(contextId);
  if (!ctx) return { synced: 0, error: 'context not found' };

  const dir = path.join(CONTEXTS_ROOT, ctx.id, 'screens');
  let files;
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.screen.md'));
  } catch {
    await mkdir(dir, { recursive: true });
    return { synced: 0 };
  }

  let synced = 0;
  for (const file of files) {
    const filePath = path.join(dir, file);
    const name = file.replace(/\.screen\.md$/, '');
    try {
      const content = await readFile(filePath, 'utf8');
      upsertDoc(ctx.id, name, filePath, content);
      synced++;
    } catch { /* skip unreadable */ }
  }
  return { synced };
}

// ---------- One-time migration from legacy /screens ----------

export async function migrateLegacyScreens() {
  const existingCount = db.prepare('SELECT COUNT(*) AS n FROM contexts').get().n;

  let legacyFiles = [];
  if (existsSync(LEGACY_SCREENS_DIR)) {
    try {
      legacyFiles = (await readdir(LEGACY_SCREENS_DIR)).filter(f => f.endsWith('.screen.md'));
    } catch { /* ignore */ }
  }

  if (!(existingCount === 0 && legacyFiles.length > 0)) {
    return { migrated: false };
  }

  const result = await createContext({
    name: 'Default',
    description: 'Migrated from legacy /screens folder',
  });
  if (result.error) return { migrated: false, error: result.error };
  const defaultCtx = result.context;

  // Target uses id-based folder, not slug
  const targetDir = path.join(CONTEXTS_ROOT, defaultCtx.id, 'screens');
  await mkdir(targetDir, { recursive: true });
  for (const file of legacyFiles) {
    const src = path.join(LEGACY_SCREENS_DIR, file);
    const dst = path.join(targetDir, file);
    try { await rename(src, dst); } catch { /* ignore */ }
  }
  try { await rm(LEGACY_SCREENS_DIR, { recursive: true, force: true }); } catch { /* ignore */ }

  await syncScreensFromDisk(defaultCtx.id);

  return { migrated: true, contextId: defaultCtx.id, filesMoved: legacyFiles.length };
}

/**
 * One-time migration: early contexts were stored at `contexts/<slug>/...`.
 * Move them to `contexts/<id>/...` so that renaming is purely a metadata
 * operation. Also regenerate ChromaDB collection name to the id-based form
 * (old collection is orphaned in Chroma, best-effort — user can re-index).
 */
export async function migrateSlugDirsToIdDirs() {
  const contexts = db.prepare('SELECT id, slug, collection FROM contexts').all();
  let moved = 0;

  for (const ctx of contexts) {
    const slugDir = path.join(CONTEXTS_ROOT, ctx.slug);
    const idDir = path.join(CONTEXTS_ROOT, ctx.id);
    if (!existsSync(slugDir) || existsSync(idDir)) continue;

    try {
      await rename(slugDir, idDir);
    } catch { continue; }

    // Rewrite file_path for every doc in this context
    const newScreensDir = path.join(idDir, 'screens');
    const docs = db.prepare('SELECT name FROM screen_docs WHERE context_id = ?').all(ctx.id);
    const upd = db.prepare(
      'UPDATE screen_docs SET file_path = ?, indexed_at = NULL, indexed_hash = NULL WHERE context_id = ? AND name = ?'
    );
    for (const d of docs) {
      const newPath = path.join(newScreensDir, `${d.name}.screen.md`);
      upd.run(newPath, ctx.id, d.name);
    }

    // Migrate collection name to id-based form if it's still slug-based
    const desiredCollection = `kraken-${ctx.id.slice(0, 8)}`;
    if (ctx.collection !== desiredCollection) {
      db.prepare('UPDATE contexts SET collection = ? WHERE id = ?').run(desiredCollection, ctx.id);
    }

    moved++;
  }

  return { migrated: moved };
}

// ---------- API keys (unchanged from previous schema) ----------

const keyQueries = {
  getAll: db.prepare('SELECT id, name, provider, secret, created_at, last_used_at, usage_count FROM api_keys ORDER BY provider, name'),
  getOne: db.prepare('SELECT id, name, provider, secret, created_at, last_used_at, usage_count FROM api_keys WHERE id = ?'),
  insert: db.prepare('INSERT INTO api_keys (id, name, provider, secret, created_at) VALUES (?, ?, ?, ?, ?)'),
  update: db.prepare('UPDATE api_keys SET name = ?, secret = ? WHERE id = ?'),
  remove: db.prepare('DELETE FROM api_keys WHERE id = ?'),
  touchUsed: db.prepare('UPDATE api_keys SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?'),
};

function maskSecret(secret) {
  if (!secret) return '';
  if (secret.length <= 10) return '•'.repeat(secret.length);
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function sanitizeKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    maskedSecret: maskSecret(row.secret),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    usageCount: row.usage_count,
  };
}

export function listKeys() { return keyQueries.getAll.all().map(sanitizeKey); }
export function listKeysByProvider(p) { return keyQueries.getAll.all().filter(r => r.provider === p).map(sanitizeKey); }
export function getKeySecret(id) { const r = keyQueries.getOne.get(id); return r?.secret ?? null; }
export function getKey(id) { return sanitizeKey(keyQueries.getOne.get(id)); }
export function createKey({ name, provider, secret }) {
  if (!name || !provider || !secret) throw new Error('name, provider, and secret are required');
  const id = randomUUID();
  keyQueries.insert.run(id, name, provider, secret, Date.now());
  return getKey(id);
}
export function updateKey(id, { name, secret }) {
  const e = keyQueries.getOne.get(id); if (!e) return null;
  keyQueries.update.run(name ?? e.name, secret ?? e.secret, id);
  return getKey(id);
}
export function deleteKey(id) {
  if (!keyQueries.getOne.get(id)) return false;
  keyQueries.remove.run(id);
  return true;
}
export function touchKeyUsed(id) { keyQueries.touchUsed.run(Date.now(), id); }

export default db;
