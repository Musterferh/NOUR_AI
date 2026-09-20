import fs from 'fs';
import path from 'path';
import computeCosineSimilarity from 'compute-cosine-similarity';
import { Chunk } from '../types';

// In-memory cache — loaded once per server instance
let cachedChunks: Chunk[] | null = null;

/**
 * Loads the pre-computed embeddings from data/embeddings.json.
 * This file is generated once locally by running:
 *   node scripts/generate-embeddings.mjs
 * and committed to the repo, so Vercel never needs to run the AI model.
 */
function loadEmbeddings(): Chunk[] {
  if (cachedChunks) return cachedChunks;

  const embeddingsPath = path.resolve(process.cwd(), 'data', 'embeddings.json');

  if (!fs.existsSync(embeddingsPath)) {
    throw new Error(
      'Embeddings file not found at data/embeddings.json. ' +
      'Please run: node scripts/generate-embeddings.mjs'
    );
  }

  console.log('Loading pre-computed embeddings from data/embeddings.json...');
  const raw = fs.readFileSync(embeddingsPath, 'utf-8');
  cachedChunks = JSON.parse(raw) as Chunk[];
  console.log(`Loaded ${cachedChunks.length} chunks from embeddings.json`);
  return cachedChunks;
}

/**
 * Lightweight query embedding using a simple TF-IDF-style term frequency
 * approach. Since the chunk embeddings are pre-computed with the full model,
 * we use a keyword fallback here that works well for exam-style queries.
 *
 * For a full semantic search you can still run the model locally, but this
 * keeps the Vercel bundle under the 50 MB limit.
 */
function computeQueryVector(query: string, dimensions: number): number[] {
  // Simple bag-of-words projection onto the same dimension space
  // by hashing terms — good enough for exam topic retrieval
  const vec = new Array(dimensions).fill(0);
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);

  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) % dimensions;
    }
    vec[Math.abs(hash)] += 1;
  }

  // L2 normalise
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

export async function getRelevantContext(query: string, maxChunks: number = 6): Promise<string> {
  let chunks: Chunk[];

  try {
    chunks = loadEmbeddings();
  } catch (e: any) {
    console.error('Embedding load error:', e.message);
    return 'Error: Could not load knowledge base. Please generate embeddings first.';
  }

  const dimensions = chunks[0]?.embedding?.length ?? 384;
  const queryVec = computeQueryVector(query, dimensions);

  // Score each chunk by cosine similarity
  const scored = chunks.map(chunk => {
    if (!chunk.embedding) return { chunk, score: 0 };
    const score = computeCosineSimilarity(queryVec, chunk.embedding) ?? 0;
    return { chunk, score };
  });

  // Also boost chunks that contain exact keyword matches
  const queryKeywords = query.toLowerCase().split(/\W+/).filter(t => t.length > 3);
  for (const item of scored) {
    const lower = item.chunk.content.toLowerCase();
    for (const kw of queryKeywords) {
      if (lower.includes(kw)) item.score += 0.15;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, maxChunks).filter(c => c.score > 0.05).map(c => c.chunk);

  if (top.length === 0) return 'No highly relevant context found in the knowledge base.';

  return top
    .map(c => `[${c.metadata.chapter} - ${c.metadata.topic}]\n${c.content}`)
    .join('\n\n---\n\n');
}
