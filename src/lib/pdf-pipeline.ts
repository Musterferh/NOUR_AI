import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createKnowledgeIndex, normalizeChunk, searchKnowledgeIndex, searchKnowledgeTopics, type KnowledgeIndex } from './knowledge-retrieval';
import type { Chunk, RetrievalRequest, RetrievalResult } from '../types';

export type { RetrievalRequest, RetrievalResult, SourceReference } from '../types';

export class KnowledgeBaseError extends Error {
  readonly code = 'KNOWLEDGE_BASE_UNAVAILABLE';
  constructor(message = 'The study knowledge bank is unavailable. Please try again after it has been restored.') {
    super(message);
    this.name = 'KnowledgeBaseError';
  }
}

let indexPromise: Promise<KnowledgeIndex> | undefined;

function validChunk(value: unknown): value is Chunk {
  if (!value || typeof value !== 'object') return false;
  const chunk = value as Partial<Chunk>;
  return typeof chunk.id === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(chunk.id)
    && typeof chunk.content === 'string' && chunk.content.trim().length > 0
    && typeof chunk.metadata === 'object' && chunk.metadata !== null
    && ['id', 'chapter', 'topic', 'statusTag'].every(key => typeof chunk.metadata?.[key as keyof Chunk['metadata']] === 'string')
    && ['title', 'section', 'sourceFile', 'sourceHash', 'version', 'baselineDate', 'sourceUrl', 'publisher', 'publishedDate', 'verifiedAt', 'provenance', 'currencyNote', 'exactExcerpt', 'excerptHash'].every(key => chunk.metadata?.[key as keyof Chunk['metadata']] === undefined || typeof chunk.metadata?.[key as keyof Chunk['metadata']] === 'string')
    && (chunk.metadata.page === undefined || (Number.isInteger(chunk.metadata.page) && chunk.metadata.page > 0));
}

function parseBank(raw: string): { chunks: Chunk[]; legacy: boolean } {
  const parsed: unknown = JSON.parse(raw);
  const legacy = Array.isArray(parsed);
  const chunks: unknown = legacy ? parsed : (parsed as { chunks?: unknown })?.chunks;
  if (!legacy && (parsed as { schemaVersion?: number })?.schemaVersion !== 1) throw new Error('Unsupported knowledge bank version');
  if (!Array.isArray(chunks) || chunks.length === 0 || !chunks.every(validChunk)) throw new Error('Invalid or empty knowledge bank');
  if (new Set(chunks.map(chunk => chunk.id)).size !== chunks.length) throw new Error('Duplicate source IDs');
  if (!legacy) {
    const manifest = (parsed as { manifest?: { contentSha256?: string } }).manifest;
    const actualHash = createHash('sha256').update(JSON.stringify(chunks)).digest('hex');
    if (manifest?.contentSha256 !== actualHash) throw new Error('Knowledge bank checksum mismatch');
  }
  return { chunks, legacy };
}

/** Only the separately reviewed supplement may declare that a primary source was checked. */
function checkedPrimaryChunk(chunk: Chunk): Chunk {
  const metadata = chunk.metadata;
  const url = new URL(metadata.sourceUrl ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !['www.itu.int', 'itu.int', 'www.ncc.gov.ng', 'ncc.gov.ng'].includes(url.hostname)
    || metadata.provenance !== 'primary-source-checked' || metadata.statusTag !== 'VERIFY'
    || !metadata.title || !metadata.publisher || !metadata.section || !metadata.page || !metadata.currencyNote
    || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.verifiedAt ?? '')
    || !Number.isFinite(Date.parse(metadata.verifiedAt!))
    || new Date(metadata.verifiedAt!).toISOString().slice(0, 10) !== metadata.verifiedAt
    || !metadata.exactExcerpt || metadata.exactExcerpt.split(/\s+/).length > 25
    || !chunk.content.includes(metadata.exactExcerpt)
    || createHash('sha256').update(metadata.exactExcerpt).digest('hex') !== metadata.excerptHash) {
    throw new Error('Invalid primary-source review metadata');
  }
  return { id: chunk.id, content: chunk.content, metadata: { ...metadata } };
}

/** Exported for ingestion checks and deterministic tests; production caches only successful loads. */
export async function loadKnowledgeIndex(dataDirectory = path.join(process.cwd(), 'data')): Promise<KnowledgeIndex> {
  try {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dataDirectory, 'knowledge-bank.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      raw = await fs.readFile(path.join(dataDirectory, 'embeddings.json'), 'utf8');
    }
    const { chunks, legacy } = parseBank(raw);
    // A merged envelope can still contain legacy chunks; an envelope checksum is not source provenance.
    const normalized = chunks.map(chunk => normalizeChunk(chunk, legacy || !/^[a-f0-9]{64}$/i.test(chunk.metadata.sourceHash ?? '') || !chunk.metadata.version));
    let supplement: string | undefined;
    try {
      supplement = await fs.readFile(path.join(dataDirectory, 'verified-materials.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (supplement !== undefined) {
      const primary = parseBank(supplement);
      if (primary.legacy) throw new Error('Primary-source supplement must have a checksum manifest');
      normalized.push(...primary.chunks.map(checkedPrimaryChunk));
    }
    if (new Set(normalized.map(chunk => chunk.id)).size !== normalized.length) throw new Error('Duplicate source IDs across banks');
    return createKnowledgeIndex(normalized);
  } catch {
    throw new KnowledgeBaseError();
  }
}

function cachedIndex(): Promise<KnowledgeIndex> {
  indexPromise ??= loadKnowledgeIndex().catch(error => {
    indexPromise = undefined;
    throw error;
  });
  return indexPromise;
}

export async function retrieveContext(request: RetrievalRequest): Promise<RetrievalResult> {
  return searchKnowledgeIndex(await cachedIndex(), request);
}

export async function retrieveContextForTopics(request: RetrievalRequest, topics: string[]): Promise<RetrievalResult> {
  return searchKnowledgeTopics(await cachedIndex(), request, topics);
}

/** Compatibility helper; callers needing citations and explicit abstention should use retrieveContext. */
export async function getRelevantContext(query: string, maxChunks = 6): Promise<string> {
  return (await retrieveContext({ query, maxChunks })).context;
}
