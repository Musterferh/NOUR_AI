export const KNOWLEDGE_STATUSES = [
  'CURRENT', 'IMPLEMENTED', 'ACHIEVEMENT', 'INITIATIVE', 'CONSULTATION',
  'DRAFT', 'HISTORICAL', 'OBSERVED', 'VERIFY',
] as const;

export type KnowledgeStatus = typeof KNOWLEDGE_STATUSES[number];
export type SourceProvenance = 'primary-source-checked' | 'provided-document' | 'unverified';

export interface DocumentMetadata {
  id: string;
  chapter: string;
  topic: string;
  statusTag: string;
  title?: string;
  section?: string;
  page?: number;
  sourceFile?: string;
  sourceHash?: string;
  version?: string;
  baselineDate?: string;
  sourceUrl?: string;
  publisher?: string;
  publishedDate?: string;
  verifiedAt?: string;
  provenance?: SourceProvenance;
  currencyNote?: string;
  exactExcerpt?: string;
  excerptHash?: string;
}

export interface Chunk {
  id: string;
  metadata: DocumentMetadata;
  content: string;
  embedding?: number[];
}

export interface SourceReference {
  id: string;
  title: string;
  section?: string;
  page?: number;
  status: string;
  excerpt: string;
  url?: string;
  publisher?: string;
  publishedDate?: string;
  verifiedAt?: string;
  provenance?: SourceProvenance;
  currencyNote?: string;
  excerptHash?: string;
}

export interface RetrievalRequest {
  query: string;
  category?: string;
  history?: Array<{ role: string; content: string }>;
  sourceIds?: string[];
  maxChunks?: number;
}

export interface RetrievalResult {
  context: string;
  sources: SourceReference[];
  quality: 'matched' | 'none';
}
