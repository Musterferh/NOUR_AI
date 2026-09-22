import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildKnowledgeBank, parseArguments, sha256 } from '../scripts/knowledge-ingest.mjs';
import { loadKnowledgeIndex } from '../src/lib/pdf-pipeline';

const source = { title: 'Controlled study bank', fileName: 'bank.pdf', version: 'v1', sha256: sha256('example bytes'), baselineDate: '2026-08-17' };

test('ingestion preserves page and section boundaries and records provenance without embeddings', () => {
  const bank = buildKnowledgeBank([
    { page: 1, text: 'DEEP CHAPTER 1 - SPECTRUM\nAllocation designates a band for a service.\n1.1 Assignment\nAssignment authorises a specific user.' },
    { page: 2, text: 'DEEP CHAPTER 2 - CONSUMERS\nConsumers can seek redress.' },
  ], source, '2026-09-21T00:00:00.000Z');
  assert.equal(bank.chunks.length, 3);
  assert.deepEqual(bank.chunks.map(chunk => chunk.metadata.page), [1, 1, 2]);
  assert.deepEqual(bank.chunks.map(chunk => chunk.metadata.section), ['DEEP CHAPTER 1 - SPECTRUM', '1.1 Assignment', 'DEEP CHAPTER 2 - CONSUMERS']);
  assert.ok(bank.chunks.every(chunk => chunk.metadata.statusTag === 'VERIFY' && chunk.metadata.sourceHash === source.sha256 && !('embedding' in chunk)));
  assert.equal(bank.manifest.contentSha256, sha256(JSON.stringify(bank.chunks)));
  assert.equal(bank.manifest.source.version, 'v1');
});

test('long sections overlap within their actual page and empty scans fail explicitly', () => {
  const words = Array.from({ length: 700 }, (_, i) => `word${i}`);
  const bank = buildKnowledgeBank([{ page: 1, text: words.join(' ') }], source);
  assert.equal(bank.chunks.length, 3);
  assert.ok(bank.chunks[0].content.includes('word319'));
  assert.ok(bank.chunks[1].content.startsWith('word285'));
  assert.ok(bank.chunks.every(chunk => chunk.metadata.page === 1));
  assert.throws(() => buildKnowledgeBank([{ page: 1, text: '' }], source), /OCR/);
  assert.throws(() => buildKnowledgeBank([{ page: 9, text: 'Misnumbered page' }], source), /page order/);
});

test('CLI requires source identity and rejects invalid dates, hashes and status values', () => {
  assert.throws(() => parseArguments([]), /--input and --version/);
  assert.throws(() => parseArguments(['--input', 'bank.pdf', '--version', 'v1', '--baseline', '2026-02-30']), /valid YYYY-MM-DD/);
  assert.throws(() => parseArguments(['--input', 'bank.pdf', '--version', 'v1', '--sha256', 'fake']), /64 hexadecimal/);
  assert.throws(() => parseArguments(['--input', 'bank.pdf', '--version', 'v1', '--status', 'Active']), /--status/);
  assert.equal(parseArguments(['--input', 'bank.pdf', '--version', 'v1']).version, 'v1');
});

function textPdf(): Buffer {
  const stream = 'BT /F1 12 Tf 72 720 Td (DEEP CHAPTER 1 - SPECTRUM) Tj 0 -24 Td (Spectrum assignment authorises a specific user.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

test('real PDF CLI writes a loadable verified corpus and checksum failure preserves existing output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nour-ingest-test-'));
  try {
    const bytes = textPdf();
    const input = path.join(directory, 'fixture.pdf');
    const output = path.join(directory, 'knowledge-bank.json');
    await fs.writeFile(input, bytes);
    const args = ['scripts/generate-embeddings.mjs', '--input', input, '--version', 'test-v1', '--sha256', sha256(bytes), '--output', output];
    await promisify(execFile)(process.execPath, args, { timeout: 30_000 });
    const index = await loadKnowledgeIndex(directory);
    assert.equal(index.documents.length, 1);
    assert.equal(index.documents[0].chunk.metadata.page, 1);
    assert.equal(index.documents[0].chunk.metadata.section, 'DEEP CHAPTER 1 - SPECTRUM');
    assert.match(index.documents[0].chunk.content, /Spectrum assignment/);
    const before = await fs.readFile(output, 'utf8');
    await assert.rejects(promisify(execFile)(process.execPath, args.map(value => value === sha256(bytes) ? '0'.repeat(64) : value), { timeout: 30_000 }), /does not match/);
    assert.equal(await fs.readFile(output, 'utf8'), before);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('nour-ingest-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
