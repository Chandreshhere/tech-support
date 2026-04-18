#!/usr/bin/env node
// CLI entry point for the kraken-assist agent.
//
// Usage:
//   node agent/index.js "change my email on Discord"   — run a task
//   node agent/index.js --ingest                       — index screen docs into ChromaDB
//   node agent/index.js --config                       — show LLM + RAG config
//   node agent/index.js --health                       — check ChromaDB + LLM health

import 'dotenv/config';
import { Agent } from './agent.service.js';
import { ingestScreenDocs, queryScreens, healthCheck } from './rag.service.js';
import { getConfig } from './llm.service.js';
import * as log from './logger.js';

const COMP = 'cli';

const args = process.argv.slice(2);
const command = args.join(' ').trim();

if (!command) {
  process.stderr.write(`
kraken-assist agent — autonomous UI navigation via AI

Usage:
  node agent/index.js "task description"    Run a task (e.g. "change my email")
  node agent/index.js --ingest              Index screen docs from screens/ into ChromaDB
  node agent/index.js --query "text"        Test RAG retrieval for a query
  node agent/index.js --config              Show LLM and key configuration
  node agent/index.js --health              Check ChromaDB connectivity

Prerequisites:
  1. ChromaDB running: chroma run --host 0.0.0.0 --port 8000
  2. API keys in .env: GEMINI_API_KEY_key_1=..., GROQ_API_KEY_key_1=...
  3. Screen docs indexed: node agent/index.js --ingest
`);
  process.exit(1);
}

try {
  if (command === '--ingest') {
    await healthCheck();
    const result = await ingestScreenDocs();
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === '--config') {
    console.log(JSON.stringify(getConfig(), null, 2));
    process.exit(0);
  }

  if (command === '--health') {
    await healthCheck();
    log.info(COMP, 'ChromaDB is healthy');
    console.log(JSON.stringify({ chromadb: 'ok', llm: getConfig() }, null, 2));
    process.exit(0);
  }

  if (command.startsWith('--query ')) {
    const query = command.slice('--query '.length).trim();
    await healthCheck();
    const screens = await queryScreens(query, 5);
    console.log(JSON.stringify(screens.map(s => ({
      screen: s.screenName,
      category: s.featureCategory,
      score: s.score?.toFixed(4),
      preview: s.content.slice(0, 100) + '...',
    })), null, 2));
    process.exit(0);
  }

  // Default: run a task
  await healthCheck();
  const agent = new Agent({ verbose: true });
  const result = await agent.run(command);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);

} catch (err) {
  log.error(COMP, err.message);
  process.exit(1);
}
