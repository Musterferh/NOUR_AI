import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRetrievalQuery, createKnowledgeIndex, normalizeChunk, searchKnowledgeIndex, searchKnowledgeTopics } from '../src/lib/knowledge-retrieval';
import { KnowledgeBaseError, loadKnowledgeIndex } from '../src/lib/pdf-pipeline';
import type { Chunk } from '../src/types';

const chunk = (id: string, content: string): Chunk => ({
  id, content, metadata: { id, chapter: 'Chapter 22', topic: 'Wrong topic', statusTag: 'Active' },
});

test('legacy labels come from the text and never fabricate a single page or verified status', () => {
  const normalized = normalizeChunk(chunk('test-1', 'NCC Promotion Exam  Page 171  DEEP CHAPTER 27 - LICENSING\nNCC Promotion Exam  Page 172  Continued'), true);
  assert.equal(normalized.metadata.section, 'DEEP CHAPTER 27');
  assert.equal(normalized.metadata.page, undefined);
  assert.equal(normalized.metadata.statusTag, 'VERIFY');
  assert.equal(normalized.metadata.version, 'unknown');
  const singlePage = normalizeChunk(chunk('test-2', 'NCC Promotion Exam  Page 171  DEEP CHAPTER 27 - LICENSING'), true);
  assert.equal(singlePage.metadata.page, 171);
});

test('quiz replies and generic drills retain the conversation topic', () => {
  assert.equal(buildRetrievalQuery({ query: 'B', category: 'General', history: [{ role: 'user', content: 'Explain spectrum assignment' }, { role: 'assistant', content: 'Choose A or B.' }] }), 'Explain spectrum assignment');
  assert.equal(buildRetrievalQuery({ query: 'Quiz me', category: 'QoS vs QoE' }), 'QoS vs QoE');
  assert.equal(buildRetrievalQuery({ query: 'Quiz me', category: 'QoS vs QoE', history: [{ role: 'user', content: 'Explain spectrum assignment' }] }), 'QoS vs QoE');
  assert.equal(buildRetrievalQuery({ query: 'Explain spectrum assignment', category: 'Memo writing' }), 'Explain spectrum assignment');
  assert.equal(buildRetrievalQuery({ query: 'Tell me more about photosynthesis', category: 'NCA 2003' }), 'Tell me more about photosynthesis');
});

test('follow-ups preserve only real source IDs and unrelated new requests cannot pin old evidence', () => {
  const index = createKnowledgeIndex([normalizeChunk(chunk('licensing', 'A licence authorises a communications service.'), true), normalizeChunk(chunk('spectrum', 'Spectrum assignment concerns a specific frequency.'), true)]);
  const result = searchKnowledgeIndex(index, { query: 'B', sourceIds: ['invented', 'spectrum', 'spectrum'] });
  assert.deepEqual(result.sources.map(source => source.id), ['spectrum']);
  assert.equal(result.quality, 'matched');
  assert.ok(index.byId.get('spectrum')?.chunk.content.includes(result.sources[0].excerpt));
  assert.equal(searchKnowledgeIndex(index, { query: 'Bake a chocolate cake', category: 'spectrum', sourceIds: ['spectrum'] }).quality, 'none');
});

test('source availability failures are typed, including an invalid preferred corpus', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nour-knowledge-test-'));
  try {
    await assert.rejects(loadKnowledgeIndex(directory), KnowledgeBaseError);
    await fs.writeFile(path.join(directory, 'embeddings.json'), JSON.stringify([chunk('source-1', 'Spectrum assignment')]));
    assert.equal((await loadKnowledgeIndex(directory)).documents.length, 1);
    await fs.writeFile(path.join(directory, 'knowledge-bank.json'), '{broken');
    await assert.rejects(loadKnowledgeIndex(directory), KnowledgeBaseError);
    await fs.writeFile(path.join(directory, 'knowledge-bank.json'), JSON.stringify({ schemaVersion: 1, chunks: [chunk('source-1', 'Tampered')], manifest: { contentSha256: 'incorrect' } }));
    await assert.rejects(loadKnowledgeIndex(directory), KnowledgeBaseError);
    await fs.rm(path.join(directory, 'knowledge-bank.json'));
    await fs.writeFile(path.join(directory, 'embeddings.json'), JSON.stringify([chunk('same', 'one'), chunk('same', 'two')]));
    await assert.rejects(loadKnowledgeIndex(directory), KnowledgeBaseError);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('nour-knowledge-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('independent weak topics are retrieved separately with unique sources and a total cap', () => {
  const index = createKnowledgeIndex([
    normalizeChunk(chunk('spectrum', 'Spectrum allocation assignment and radio interference.'), true),
    normalizeChunk(chunk('memo', 'Memo writing uses facts analysis implications recommendations.'), true),
    normalizeChunk(chunk('identity', 'TIRMS identity risk.'), true),
  ]);
  const result = searchKnowledgeTopics(index, { query: 'Quiz me on weak topics', maxChunks: 2 }, ['spectrum assignment', 'memo writing', 'TIRMS identity']);
  assert.deepEqual(result.sources.map(source => source.id), ['spectrum', 'memo']);
  assert.equal(searchKnowledgeTopics(index, { query: 'Quiz me' }, ['photosynthesis', 'chocolate']).quality, 'none');
});

const bankPromise = loadKnowledgeIndex();
const retrievalCases = [
  { query: 'What is the difference between spectrum allocation and assignment?', expected: /allocation[\s\S]*assignment/i, goldSource: 'chunk-159' },
  { query: 'How does mobile number portability work?', expected: /portability/i, goldSource: 'chunk-214' },
  { query: 'Explain QoS versus QoE', expected: /quality of (?:service|experience)/i, goldSource: 'chunk-4' },
  { query: 'What is DND 2442?', expected: /unsolicited|promotional/i, goldSource: 'chunk-38' },
  { query: 'Explain TIRMS identity risk', expected: /TIRMS[\s\S]*(?:identity|number)/i, goldSource: 'chunk-287' },
  { query: 'What are the objectives of NCA 2003?', expected: /objective/i, goldSource: 'chunk-0' },
  { query: 'How do I structure a memo using FAIR?', expected: /Fact[\s\S]*Analysis[\s\S]*Implication[\s\S]*Recommendation/i, goldSource: 'chunk-261' },
];

for (const evaluation of retrievalCases) {
  test(`bank retrieval: ${evaluation.query}`, async () => {
    const result = searchKnowledgeIndex(await bankPromise, { query: evaluation.query });
    assert.equal(result.quality, 'matched');
    assert.match(result.context, evaluation.expected);
    assert.ok(result.sources.every(source => source.id && source.excerpt && source.status === 'VERIFY'));
    assert.ok(result.sources.some(source => source.id === evaluation.goldSource), `Expected reviewed evidence ${evaluation.goldSource} among top six sources`);
  });
}

for (const query of ['How do I bake a chocolate cake?', 'Explain photosynthesis', 'Tell me more about photosynthesis', 'What is the dosage of amoxicillin?', 'Write a Python shopping cart']) {
  test(`bank abstention: ${query}`, async () => {
    assert.equal(searchKnowledgeIndex(await bankPromise, { query, category: 'NCA 2003' }).quality, 'none');
  });
}

test('new drills have evidence and short answers reuse the exact question sources', async () => {
  const index = await bankPromise;
  for (const category of ['NCA 2003', 'QoS vs QoE', 'TIRMS', 'General']) {
    const first = searchKnowledgeIndex(index, { query: 'Quiz me', category });
    assert.equal(first.quality, 'matched', category);
    const next = searchKnowledgeIndex(index, { query: 'A', category, sourceIds: first.sources.map(source => source.id) });
    assert.deepEqual(next.sources.map(source => source.id), first.sources.map(source => source.id));
  }
});

test('every study category can seed an exam and general exams include distinct syllabus topics', async () => {
  const index = await bankPromise;
  for (const category of ['NCA 2003', 'Spectrum', 'QoS/QoE', 'NIN-SIM & TIRMS', 'Emerging Tech', 'Institutional Governance', 'General']) {
    assert.equal(searchKnowledgeIndex(index, { query: category, category, maxChunks: 12 }).quality, 'matched', category);
  }
  const general = searchKnowledgeIndex(index, { query: 'General', category: 'General', maxChunks: 12 });
  assert.ok(general.sources.length >= 6);
  for (const pattern of [/spectrum/i, /TIRMS/i, /QoE/i, /governance/i]) assert.match(general.context, pattern);
});
