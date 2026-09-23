/**
 * merge-banks.mjs
 * Merges multiple knowledge-bank JSON files (new schema) and/or the legacy
 * embeddings.json (array schema) into a single data/knowledge-bank.json.
 *
 * Usage:  node scripts/merge-banks.mjs <file1.json> <file2.json> ...
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'data', 'knowledge-bank.json');

const inputs = process.argv.slice(2);
if (inputs.length < 2) {
  console.error('Usage: node scripts/merge-banks.mjs <file1.json> <file2.json> [...]');
  process.exit(1);
}

const allChunks = [];
const seenIds = new Set();

for (const input of inputs) {
  const filePath = path.resolve(ROOT, input);
  console.log(`Reading ${filePath}...`);
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  const isLegacy = Array.isArray(parsed);
  const chunks = isLegacy ? parsed : parsed.chunks;

  if (!Array.isArray(chunks) || chunks.length === 0) {
    console.warn(`  Skipping ${input}: no chunks found.`);
    continue;
  }

  let added = 0;
  let skipped = 0;
  for (const chunk of chunks) {
    // Ensure every chunk has required metadata fields (normalise legacy chunks)
    if (!chunk.metadata) chunk.metadata = {};
    if (!chunk.metadata.chapter) chunk.metadata.chapter = chunk.metadata.topic ?? 'Section not recorded';
    if (!chunk.metadata.topic)   chunk.metadata.topic   = chunk.metadata.title ?? 'Unknown';
    if (!chunk.metadata.statusTag) chunk.metadata.statusTag = 'VERIFY';

    // De-duplicate by id
    if (seenIds.has(chunk.id)) { skipped++; continue; }
    seenIds.add(chunk.id);
    allChunks.push(chunk);
    added++;
  }
  console.log(`  Added ${added} chunks (${skipped} duplicates skipped).`);
}

if (allChunks.length === 0) {
  console.error('No chunks to write — aborting.');
  process.exit(1);
}

const contentSha256 = createHash('sha256').update(JSON.stringify(allChunks)).digest('hex');

const bank = {
  schemaVersion: 1,
  manifest: {
    generatorVersion: 'nour-merge-v1',
    retrievalAlgorithm: 'BM25',
    generatedAt: new Date().toISOString(),
    chunkCount: allChunks.length,
    contentSha256,
    sources: inputs,
  },
  chunks: allChunks,
};

const tmp = `${OUTPUT}.${process.pid}.tmp`;
await fs.writeFile(tmp, JSON.stringify(bank, null, 2));
await fs.rename(tmp, OUTPUT);

console.log(`\nMerged ${allChunks.length} total chunks -> ${OUTPUT}`);
console.log(`Content SHA-256: ${contentSha256}`);
