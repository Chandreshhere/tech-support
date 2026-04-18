// User-editable config persisted to backend/config.json.
// All values are editable from the frontend via PATCH /config.
// First run creates the file with sensible defaults.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const CONFIG_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'config.json'
);

const DEFAULT_CONFIG = {
  llm: {
    activeProvider: 'gemini',
    gemini: {
      activeModel: 'gemini-2.5-flash',
      activeKeyId: null,
    },
    groq: {
      activeModel: 'llama-3.3-70b-versatile',
      activeKeyId: null,
    },
  },
  chromadb: {
    url: 'http://localhost:8000',
    collection: 'kraken-screens',
  },
  embeddings: {
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
  },
  agent: {
    maxSteps: 30,
    maxRetries: 3,
    postActionDelay: 400,
    visionProvider: 'gemini',
    textFallbackProvider: 'groq',
  },
};

// ---------- Load ----------

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(target[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let config;
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    config = structuredClone(DEFAULT_CONFIG);
    saveConfig();
    return;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    // Merge with defaults so any new default fields get filled in on upgrade
    config = deepMerge(DEFAULT_CONFIG, JSON.parse(raw));
  } catch (err) {
    console.error('[config] failed to load, using defaults:', err.message);
    config = structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig() {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

loadConfig();

// ---------- Public API ----------

export function getConfig() {
  return structuredClone(config);
}

/**
 * Set a value by dot-path, e.g. setConfigPath('chromadb.url', 'http://...')
 * Returns the updated config.
 */
export function setConfigPath(dotPath, value) {
  if (!dotPath || typeof dotPath !== 'string') {
    throw new Error('dotPath must be a non-empty string');
  }
  const keys = dotPath.split('.');
  let cursor = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!cursor[k] || typeof cursor[k] !== 'object') cursor[k] = {};
    cursor = cursor[k];
  }
  cursor[keys[keys.length - 1]] = value;
  saveConfig();
  return getConfig();
}

/** Replace the whole config (validated merge with defaults). */
export function replaceConfig(newConfig) {
  config = deepMerge(DEFAULT_CONFIG, newConfig);
  saveConfig();
  return getConfig();
}
