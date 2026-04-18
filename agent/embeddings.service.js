// Local embeddings via @huggingface/transformers (formerly @xenova/transformers).
// Wraps the transformers.js feature-extraction pipeline as a LangChain
// Embeddings subclass so it can be used directly with any LangChain vector
// store or passed to ChromaDB as pre-computed vectors.
//
// Model: Xenova/all-MiniLM-L6-v2 (384-dim, ~80MB download on first run)
// Fully offline after first download — no API keys, no cost.

import { Embeddings } from '@langchain/core/embeddings';
import * as log from './logger.js';

const COMP = 'embeddings';
const DEFAULT_MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';

let pipelinePromise = null;

async function loadPipeline(modelName) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      log.info(COMP, `loading model ${modelName} (first run downloads ~25MB quantized)...`);
      const { pipeline } = await import('@huggingface/transformers');
      // Use the library's default dtype (quantized int8 for this model).
      // Quantized is ~25MB vs ~90MB for fp32, with negligible accuracy
      // difference for sentence embedding at 384 dims. If quality matters
      // more than size, override to 'fp32' here (and clear the cache).
      const pipe = await pipeline('feature-extraction', modelName);
      log.info(COMP, `model loaded`);
      return pipe;
    })();
    // Prevent unhandled rejection if the first caller hasn't awaited yet
    pipelinePromise.catch(() => {});
  }
  return pipelinePromise;
}

/**
 * Mean-pool token-level embeddings into a single sentence vector.
 * transformers.js returns shape [1, seq_len, hidden_dim] for each input.
 */
function meanPool(output) {
  const data = output.data;
  const dims = output.dims; // [1, seq_len, hidden_dim]
  const seqLen = dims[1];
  const hiddenDim = dims[2];
  const result = new Array(hiddenDim).fill(0);
  for (let t = 0; t < seqLen; t++) {
    for (let d = 0; d < hiddenDim; d++) {
      result[d] += data[t * hiddenDim + d];
    }
  }
  for (let d = 0; d < hiddenDim; d++) {
    result[d] /= seqLen;
  }
  return result;
}

export class LocalTransformersEmbeddings extends Embeddings {
  constructor({ modelName } = {}) {
    super({});
    this.modelName = modelName || DEFAULT_MODEL;
  }

  async embedDocuments(texts) {
    const pipe = await loadPipeline(this.modelName);
    const results = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data));
    }
    return results;
  }

  async embedQuery(text) {
    const pipe = await loadPipeline(this.modelName);
    const output = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }
}

// Module-level singleton
let instance = null;

export function getEmbeddings() {
  if (!instance) {
    instance = new LocalTransformersEmbeddings();
  }
  return instance;
}
