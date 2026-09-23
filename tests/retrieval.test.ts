import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildRetrievalQuery, createKnowledgeIndex, normalizeChunk, searchKnowledgeIndex, searchKnowledgeTopics } from '../src/lib/knowledge-retrieval';
import { KnowledgeBaseError, loadKnowledgeIndex } from '../src/lib/pdf-pipeline';
import type { Chunk } from '../src/types';

const chunk = (id: string, content: string): Chunk => ({
  id, content, metadata: { id, chapter: 'Chapter 22', topic: 'Wrong topic', statusTag: 'Active' },
});

const envelope = (chunks: Chunk[]) => JSON.stringify({ schemaVersion: 1, chunks, manifest: {
  contentSha256: createHash('sha256').update(JSON.stringify(chunks)).digest('hex'),
} });

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

test('merged legacy and supplied PDFs retain distinct provenance without certifying regulatory currency', async () => {
  const index = await bankPromise;
  const legacy = index.byId.get('chunk-159')!.chunk;
  assert.equal(legacy.metadata.provenance, 'unverified');
  assert.equal(legacy.metadata.version, 'unknown');
  assert.equal(legacy.metadata.statusTag, 'VERIFY');
  assert.notEqual(legacy.metadata.chapter, 'Chapter 1');
  const handbook = index.byId.get('source-29055b51b186a7b1-p1-0')!.chunk;
  assert.equal(handbook.metadata.provenance, 'provided-document');
  assert.equal(handbook.metadata.sourceHash, '29055b51b186a7b1b6f341d37487c66603ee095c96f97e04aaef646e9b4b4075');
  assert.equal(handbook.metadata.page, 1);
  assert.equal(handbook.metadata.statusTag, 'VERIFY');
  assert.equal(handbook.metadata.verifiedAt, undefined);
  const workingHours = index.byId.get('source-29055b51b186a7b1-p13-120')!.chunk;
  assert.match(workingHours.metadata.section!, /^Multiple or continued sections;/);
  assert.match(workingHours.metadata.section!, /1\.4 Working Hours/);
  assert.doesNotMatch(workingHours.metadata.section!, /1\.2\.4|1\.3|Core Values/);
  assert.equal(workingHours.metadata.page, 13);
  const confirmation = index.byId.get('source-29055b51b186a7b1-p19-136')!.chunk;
  assert.match(confirmation.metadata.section!, /2\.8 Confirmation of Employment/);
  assert.match(confirmation.metadata.section!, /2\.10 Employee Job Grades/);
  assert.doesNotMatch(confirmation.metadata.section!, /2\.7/);
  assert.equal(confirmation.metadata.chapter, 'Chapter not established by this chunk');
});

test('full named-handbook evaluation scenarios retrieve reviewed facts across follow-ups and false premises', async () => {
  const { CONVERSATION_CASES } = await import('../scripts/evaluate-conversation');
  const index = await bankPromise;
  for (const scenario of CONVERSATION_CASES.filter(item => ['handbook-reference', 'confirmation-reasoning', 'short-followups', 'adversarial-handbook-premise'].includes(item.id))) {
    const history: Array<{ role: string; content: string }> = [];
    let sourceIds: string[] = [];
    for (const turn of scenario.turns) {
      const result = searchKnowledgeIndex(index, { query: turn.prompt, category: scenario.category, history, sourceIds });
      assert.equal(result.quality, 'matched', turn.id);
      for (const id of turn.expectedSourceIds ?? []) assert.ok(result.sources.some(source => source.id === id), `${turn.id}: ${id}`);
      sourceIds = result.sources.map(source => source.id);
      history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: turn.planningReply ?? '' });
    }
  }
  for (const query of [
    'Using the supplied Employee Handbook, explain photosynthesis and describe why green plants use sunlight to create sugar. Keep the answer under 180 words.',
    'Using the Employee Handbook, what is the dosage of amoxicillin for an adult? Cite the supplied evidence. Under 200 words.',
  ]) assert.equal(searchKnowledgeIndex(index, { query }).quality, 'none', query);
});

test('checked supplement exposes exact small excerpts, publisher links, dates and bounded review claims', async () => {
  const index = await bankPromise;
  const checked = index.documents.filter(document => document.chunk.metadata.provenance === 'primary-source-checked');
  assert.equal(checked.length, 4);
  for (const { chunk } of checked) {
    const result = searchKnowledgeIndex(index, { query: 'Explain that', sourceIds: [chunk.id] });
    const source = result.sources[0];
    assert.equal(source.id, chunk.id);
    assert.equal(source.excerpt, chunk.metadata.exactExcerpt);
    assert.ok(chunk.content.includes(source.excerpt));
    assert.ok(source.excerpt.split(/\s+/).length <= 25);
    assert.equal(source.excerptHash, createHash('sha256').update(source.excerpt).digest('hex'));
    assert.match(source.url!, /^https:\/\/www\.(?:itu\.int|ncc\.gov\.ng)\//);
    assert.equal(source.verifiedAt, '2026-09-24');
    assert.equal(source.status, 'VERIFY');
    assert.ok(source.page && source.section && source.publisher && source.currencyNote);
    assert.match(result.context, /Provenance: primary-source-checked/);
    assert.match(result.context, /Currency limitation:/);
  }
  assert.equal(index.byId.get('primary-ncc-consumer-redress-faq')!.chunk.metadata.publishedDate, undefined,
    'An upload URL must not become an invented publication date');
});

test('a base-bank author cannot self-certify primary provenance or CURRENT through metadata', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nour-knowledge-test-'));
  try {
    const forged = chunk('provided-1', 'Spectrum assignment is discussed in this supplied document.');
    Object.assign(forged.metadata, { sourceHash: 'a'.repeat(64), version: 'v1', page: 2,
      statusTag: 'CURRENT', provenance: 'primary-source-checked', verifiedAt: '2026-09-24',
      exactExcerpt: 'Fabricated quotation', excerptHash: 'a'.repeat(64) });
    const legacy = chunk('legacy-1', 'NCC Study Bank  Page 171  DEEP CHAPTER 27 - LICENSING');
    legacy.metadata.page = 99;
    await fs.writeFile(path.join(directory, 'knowledge-bank.json'), envelope([forged, legacy]));
    const index = await loadKnowledgeIndex(directory);
    assert.equal(index.byId.get('provided-1')!.chunk.metadata.provenance, 'provided-document');
    assert.equal(index.byId.get('provided-1')!.chunk.metadata.statusTag, 'VERIFY');
    assert.equal(index.byId.get('provided-1')!.chunk.metadata.verifiedAt, undefined);
    assert.equal(index.byId.get('provided-1')!.chunk.metadata.exactExcerpt, undefined);
    assert.equal(index.byId.get('provided-1')!.chunk.metadata.page, 2);
    assert.equal(index.byId.get('legacy-1')!.chunk.metadata.page, 171);
    assert.equal(index.byId.get('legacy-1')!.chunk.metadata.provenance, 'unverified');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('nour-knowledge-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('a corrupt checked supplement fails closed even when its outer checksum was recomputed', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nour-knowledge-test-'));
  try {
    await fs.writeFile(path.join(directory, 'embeddings.json'), JSON.stringify([chunk('base-1', 'Spectrum assignment')]));
    const original = (await bankPromise).byId.get('primary-itu-spectrum-2015')!.chunk;
    await fs.writeFile(path.join(directory, 'verified-materials.json'), envelope([original]));
    assert.equal((await loadKnowledgeIndex(directory)).documents.length, 2);
    for (const changed of [
      { ...original, metadata: { ...original.metadata, excerptHash: '0'.repeat(64) } },
      { ...original, metadata: { ...original.metadata, sourceUrl: 'https://www.itu.int.attacker.example/source' } },
      { ...original, metadata: { ...original.metadata, verifiedAt: '2026-02-30' } },
      { ...original, metadata: { ...original.metadata, statusTag: 'CURRENT' } },
      { ...original, id: 'base-1' },
    ]) {
      await fs.writeFile(path.join(directory, 'verified-materials.json'), envelope([changed]));
      await assert.rejects(loadKnowledgeIndex(directory), KnowledgeBaseError);
    }
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('nour-knowledge-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('referential follow-ups keep their evidence while topic-bearing follow-ups must match the new topic', async () => {
  const index = await bankPromise;
  const request = { history: [{ role: 'user', content: 'Explain spectrum allocation and assignment' }], sourceIds: ['primary-itu-spectrum-2015'] };
  for (const query of ['What about that?', 'Compare those', 'Compare the two', 'How do they differ?', 'Why is this important?', 'Why? Please explain briefly, without a quiz.']) {
    assert.deepEqual(searchKnowledgeIndex(index, { ...request, query }).sources.map(source => source.id), request.sourceIds, query);
  }
  const assignment = searchKnowledgeIndex(index, { ...request, query: 'What about assignment?' });
  assert.equal(assignment.sources[0].id, 'primary-itu-spectrum-2015');
  for (const query of ['What about photosynthesis?', 'Compare those with photosynthesis', 'Compare spectrum allocation with photosynthesis', 'What is the difference between spectrum allocation and photosynthesis?', 'How does this compare with chemotherapy?', 'Compare spectrum allocation with photosynthesis. Keep the answer under 120 words and cite supplied evidence.', 'Explain photosynthesis and why it matters. Do not invent NCC facts. Under 200 words.']) {
    assert.equal(searchKnowledgeIndex(index, { ...request, query, category: 'Spectrum' }).quality, 'none', query);
  }
});

for (const evaluation of [
  { query: 'What is the difference between spectrum allocation and assignment?', source: 'primary-itu-spectrum-2015', first: true },
  { query: 'An operator says a frequency band is allocated to mobile services, so it can start transmitting immediately. Is that reasoning correct? Explain allocation versus assignment and why the distinction matters.', source: 'primary-itu-spectrum-2015' },
  { query: 'QoS is exclusively technical while QoE has nothing to do with the network. Is that correct? Explain the distinction using the source.', source: 'primary-itu-qos-qoe-2019', first: true },
  { query: 'How should a consumer escalate an unresolved data usage complaint and why should they keep a trouble ticket?', source: 'primary-ncc-consumer-redress-faq', first: true },
  { query: 'What are the objectives of NCA 2003?', source: 'primary-ncc-nca-objectives-2003', first: true },
  { query: 'Compare spectrum allocation and assignment. Explain why an allocation alone does not authorise a radio station to transmit. Keep the answer under 120 words and cite the supplied evidence.', source: 'primary-itu-spectrum-2015', first: true },
  { query: 'Reason carefully about this spectrum case. A company sees that a frequency band is allocated to a radio service and argues that this alone gives its individual station permission to transmit. Using the supplied ITU guidance, distinguish spectrum allocation from assignment and explain whether that conclusion follows. Cite the source and do not invent a current Nigerian licence or band decision. Under 200 words.', source: 'primary-itu-spectrum-2015', first: true },
  { query: 'Critically assess this claim: "QoS is exclusively technical, so user satisfaction belongs only to QoE and can never be part of QoS." Use the supplied ITU-T G.1033 Appendix II.1 material to distinguish the practical measurement emphasis from the actual definitions. State whether the claim is too narrow, explain why, and cite the evidence. Do not invent Nigerian regulatory thresholds. Under 200 words.', source: 'primary-itu-qos-qoe-2019', first: true },
  { query: 'According to Employee Handbook section 1.4, what are the standard working hours, working days, and lunch break? Answer from the supplied document, cite the supporting passage, and distinguish its wording from independently verified current policy. Keep the answer under 180 words.', source: 'source-29055b51b186a7b1-p13-120' },
]) {
  test(`primary-source retrieval for a natural question: ${evaluation.query}`, async () => {
    const result = searchKnowledgeIndex(await bankPromise, { query: evaluation.query });
    assert.equal(result.quality, 'matched');
    assert.ok(result.sources.some(source => source.id === evaluation.source), evaluation.source);
    if (evaluation.first) assert.equal(result.sources[0].id, evaluation.source);
  });
}
