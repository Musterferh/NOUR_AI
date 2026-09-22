import { KNOWLEDGE_STATUSES, type Chunk, type RetrievalRequest, type RetrievalResult, type SourceReference } from '../types';

const STOP_WORDS = new Set(`a an and are as at be been being by can could did do does for from had has have how i if in into is it its me my of on or our please that the their them then there these they this those to us was we were what when where which who why will with would you your explain tell describe discuss define definition give example examples difference differences compare between versus vs about more further understand question questions quiz test drill next start begin now answer answers correct wrong option options letter chosen reply choose following ncc promotion exam examination master offline knowledge bank general`.split(' '));

const SYNONYM_GROUPS = [
  ['qos', 'quality of service'], ['qoe', 'quality of experience'],
  ['nca', 'nigerian communications act'], ['nin', 'national identification number'],
  ['sim', 'subscriber identity module'], ['mnp', 'mobile number portability'],
  ['dnd', 'do not disturb', 'unsolicited communications'],
  ['uspf', 'universal service provision fund'], ['row', 'rights of way', 'right of way'],
  ['tirms', 'telecom identity risk management system'],
  ['dms', 'device management system'], ['fair', 'fact analysis implication recommendation'],
];

function canonicalTerm(term: string): string {
  if (term === 'tech') return 'technology';
  if (/^licen[cs](?:e|es|ed|ing)$/.test(term)) return 'licence';
  if (term.length > 5 && term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (term.length > 4 && term.endsWith('s') && !/(ss|us|is)$/.test(term)) return term.slice(0, -1);
  return term;
}

export function tokenize(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(term => !STOP_WORDS.has(term) && term.length > 1).map(canonicalTerm);
}

function expandTerms(text: string): string[] {
  const terms = new Set(tokenize(text));
  for (const group of SYNONYM_GROUPS) {
    if (group.some(phrase => tokenize(phrase).every(term => terms.has(term)))) {
      for (const phrase of group) for (const term of tokenize(phrase)) terms.add(term);
    }
  }
  return [...terms];
}

export function isFollowUp(query: string): boolean {
  const normalized = query.trim().toLowerCase().replace(/[.!?]+$/, '');
  return /^(?:[a-d]|(?:option|answer|i choose|my answer is)\s+[a-d]|yes|no|continue|go on|again|quiz me|test me|next(?: question)?|why(?: is (?:it|that|[a-d]) (?:right|wrong|correct|incorrect))?)$/.test(normalized)
    || tokenize(query).length === 0
    || /^(?:explain|tell me|show me) (?:that|it|more|again|further)(?: (?:please|in (?:more )?detail|another way))?$/.test(normalized)
    || /^[a-d]\b\s*[,.:;-]?\s+(?:because|as|since)\b/.test(normalized);
}

/** Follow-ups retain the last substantive learner topic; the active category seeds new drills. */
export function buildRetrievalQuery(request: RetrievalRequest): string {
  if (!isFollowUp(request.query)) return request.query;
  if (isNewDrill(request.query) && request.category && tokenize(request.category).length > 0) return request.category;
  const previousQuestion = [...(request.history ?? [])].reverse()
    .find(message => message.role === 'user' && !isFollowUp(message.content));
  if (previousQuestion) return previousQuestion.content.slice(0, 1500);
  if (request.category && tokenize(request.category).length > 0) return request.category;
  const lastCoachQuestion = [...(request.history ?? [])].reverse()
    .find(message => message.role === 'assistant');
  if (lastCoachQuestion) return lastCoachQuestion.content.slice(-1500);
  // A first general drill intentionally samples the syllabus rather than using arbitrary vector noise.
  if (/quiz|test|drill|start|begin/i.test(request.query) || request.category?.toLowerCase() === 'general') {
    return 'spectrum licensing consumer qos nca';
  }
  return '';
}

function isNewDrill(query: string): boolean {
  return /^(?:(?:quiz|test|drill) me|start|begin)[.!?]*$/i.test(query.trim());
}

function literalSections(content: string): string | undefined {
  const chapters = [...content.matchAll(/\bDEEP CHAPTER\s+\d+\b/gi)].map(match => match[0]);
  if (chapters.length > 0) return [...new Set(chapters)].join('; ');
  return content.match(/\bCheckpoint\s+\d+\b/i)?.[0];
}

/** Legacy labels are not trusted: only headings and page markers present in text are recovered. */
export function normalizeChunk(chunk: Chunk, legacy: boolean): Chunk {
  const metadata = { ...chunk.metadata };
  const literalSection = literalSections(chunk.content);
  const explicitPages = [...new Set([...chunk.content.matchAll(/\bPage\s+(\d+)\b/g)].map(match => Number(match[1])))];
  if (legacy) {
    metadata.section = literalSection;
    metadata.chapter = literalSection ?? 'Section not recorded';
    metadata.topic = literalSection ?? 'Knowledge bank';
    metadata.page = explicitPages.length === 1 ? explicitPages[0] : undefined;
    metadata.version = 'unknown';
    metadata.title = chunk.content.match(/^(.{1,180}?)\s{2,}(?:Page|Addendum p\.)\s*\d+/)?.[1]
      ?? 'NCC Promotion Exam — legacy knowledge bank';
    metadata.statusTag = 'VERIFY';
  } else if (!KNOWLEDGE_STATUSES.some(status => status === metadata.statusTag)) {
    metadata.statusTag = 'VERIFY';
  }
  return { id: chunk.id, content: chunk.content, metadata };
}

interface IndexedChunk {
  chunk: Chunk;
  counts: Map<string, number>;
  length: number;
}

export interface KnowledgeIndex {
  documents: IndexedChunk[];
  byId: Map<string, IndexedChunk>;
  documentFrequency: Map<string, number>;
  averageLength: number;
}

export function createKnowledgeIndex(chunks: Chunk[]): KnowledgeIndex {
  const documentFrequency = new Map<string, number>();
  const documents = chunks.map(chunk => {
    const terms = tokenize(chunk.content);
    const counts = new Map<string, number>();
    for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    return { chunk, counts, length: terms.length };
  });
  return {
    documents,
    byId: new Map(documents.map(document => [document.chunk.id, document])),
    documentFrequency,
    averageLength: documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, documents.length),
  };
}

function excerptFor(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(position => position >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 90);
  return content.slice(start, start + 500);
}

function toResult(documents: IndexedChunk[], terms: string[]): RetrievalResult {
  if (documents.length === 0) return { context: '', sources: [], quality: 'none' };
  const sources: SourceReference[] = documents.map(({ chunk }) => ({
    id: chunk.id,
    title: chunk.metadata.title ?? 'NCC Promotion Exam knowledge bank',
    ...(chunk.metadata.section ? { section: chunk.metadata.section } : {}),
    ...(chunk.metadata.page ? { page: chunk.metadata.page } : {}),
    status: chunk.metadata.statusTag,
    excerpt: excerptFor(chunk.content, terms),
  }));
  const context = documents.map(({ chunk }, index) => {
    const source = sources[index];
    return `[SOURCE ${source.id}]\nTitle: ${source.title}\nSection: ${source.section ?? 'not recorded'}\nPage: ${source.page ?? 'not recorded or multiple pages'}\nSource status: ${source.status}\nSource version: ${chunk.metadata.version ?? 'unknown'}\nBaseline: ${chunk.metadata.baselineDate ?? 'not independently recorded'}\n${chunk.content}\n[END SOURCE ${source.id}]`;
  }).join('\n\n');
  return { context, sources, quality: 'matched' };
}

export function searchKnowledgeIndex(index: KnowledgeIndex, request: RetrievalRequest): RetrievalResult {
  const maxChunks = Math.max(1, Math.min(12, Math.floor(request.maxChunks ?? 6) || 6));
  const query = buildRetrievalQuery(request);
  const coreTerms = [...new Set(tokenize(query))];
  const expandedTerms = expandTerms(query);
  const followUp = isFollowUp(request.query);
  const pinned = followUp && !isNewDrill(request.query) ? [...new Set(request.sourceIds ?? [])]
    .map(id => index.byId.get(id)).filter((document): document is IndexedChunk => Boolean(document)).slice(0, maxChunks) : [];
  if (pinned.length > 0) return toResult(pinned, coreTerms);
  if (coreTerms.length === 0) return toResult([], []);

  const broadDrill = query === 'spectrum licensing consumer qos nca';
  if (broadDrill) {
    const topics = ['NCA 2003 objectives', 'spectrum allocation assignment', 'QoS QoE', 'NIN-SIM TIRMS', 'emerging technology', 'institutional governance'];
    const pools = topics.map(topic => searchKnowledgeIndex(index, { query: topic, maxChunks: 2 }).sources);
    const selected: IndexedChunk[] = [];
    const used = new Set<string>();
    for (let rank = 0; rank < 2; rank++) {
      for (const pool of pools) {
        const source = pool[rank];
        if (source && !used.has(source.id)) {
          selected.push(index.byId.get(source.id)!);
          used.add(source.id);
        }
      }
    }
    return toResult(selected.slice(0, maxChunks), coreTerms);
  }
  const categoryTerms = new Set(tokenize(request.category ?? ''));
  const scored = index.documents.flatMap(document => {
    const hits = coreTerms.filter(term => document.counts.has(term));
    // Common instruction words and unrelated category selection cannot turn missing evidence into a match.
    const requiredHits = Math.max(1, Math.ceil(coreTerms.length * 0.55));
    const aliasMatch = coreTerms.length <= 2 && hits.length === 0
      && SYNONYM_GROUPS.some(group => group.some(phrase => tokenize(phrase).every(term => coreTerms.includes(term)))
        && group.some(phrase => tokenize(phrase).length > 1 && tokenize(phrase).every(term => document.counts.has(term))));
    if ((hits.length < requiredHits && !aliasMatch) || (hits.length > 0 && hits.every(term => /^\d+$/.test(term)))) return [];
    let score = 0;
    for (const term of expandedTerms) {
      const frequency = document.counts.get(term) ?? 0;
      if (frequency === 0) continue;
      const idf = Math.log(1 + (index.documents.length - (index.documentFrequency.get(term) ?? 0) + 0.5) / ((index.documentFrequency.get(term) ?? 0) + 0.5));
      const normalizer = frequency + 1.2 * (0.25 + 0.75 * document.length / (index.averageLength || 1));
      score += idf * (frequency * 2.2 / normalizer) * (coreTerms.includes(term) ? 1 : 0.35);
    }
    score *= 1 + hits.length / coreTerms.length;
    score *= 1 + Math.min(0.15, [...categoryTerms].filter(term => document.counts.has(term)).length * 0.025);
    // Correction appendices carry source limitations; modestly prefer them when they match the actual question.
    if (/Checkpoint (?:27|28)\b/.test(document.chunk.content.slice(0, 180))) score *= 1.12;
    return [{ document, score }];
  }).sort((left, right) => right.score - left.score || left.document.chunk.id.localeCompare(right.document.chunk.id));
  return toResult(scored.slice(0, maxChunks).map(result => result.document), coreTerms);
}

/** Independent weak topics need separate queries, otherwise a combined query penalizes each topic's evidence. */
export function searchKnowledgeTopics(index: KnowledgeIndex, request: RetrievalRequest, topics: string[]): RetrievalResult {
  const cleanTopics = [...new Set(topics.map(topic => topic.trim().slice(0, 120)).filter(Boolean))].slice(0, 5);
  if (cleanTopics.length === 0) return searchKnowledgeIndex(index, request);
  const maxChunks = Math.max(1, Math.min(12, Math.floor(request.maxChunks ?? 6) || 6));
  const pools = cleanTopics.map(topic => searchKnowledgeIndex(index, { query: topic, category: request.category, maxChunks }).sources);
  const selected: IndexedChunk[] = [];
  const used = new Set<string>();
  for (let rank = 0; rank < maxChunks && selected.length < maxChunks; rank++) {
    for (const pool of pools) {
      const source = pool[rank];
      if (source && !used.has(source.id)) {
        selected.push(index.byId.get(source.id)!);
        used.add(source.id);
        if (selected.length === maxChunks) break;
      }
    }
  }
  return toResult(selected, tokenize(cleanTopics.join(' ')));
}
