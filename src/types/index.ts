export interface DocumentMetadata {
  id: string;
  chapter: string;
  topic: string;
  statusTag: string;
}

export interface Chunk {
  id: string;
  metadata: DocumentMetadata;
  content: string;
  embedding?: number[];
}
