import { type Chunk, type RetrievalRequest, type RetrievalResult, type SourceReference } from '../types';

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

// Discourse instructions should not count against evidence coverage in a natural, multipart question.
// Domain terms (including unfamiliar topics) remain mandatory retrieval inputs.
const QUERY_INSTRUCTIONS = new Set('actual also alone argue assess based belong brief briefly carefully case cite claim clearly conclusion consider critically detail detailed distinguish distinction emphasis evidence follow give guidance immediately individual material matter narrow never only part practical reasoning reason say says scenario section see sees should so source state step steps supplied too use using whether'.split(' '));

function cleanQuery(text: string): string {
  return text
    // Output constraints do not ask for facts about these numbers, subjects, or formats.
    .replace(/\b(?:keep (?:the|your) (?:answer|response) )?(?:under|within|in|at most|no more than)\s+\d+\s+words?\b/gi, ' ')
    .replace(/\b(?:do not|don't|never)\s+(?:invent|fabricate|make up)\b[^.!?]*(?:[.!?]|$)/gi, ' ')
    .replace(/\b(?:cite|reference)\s+(?:(?:the|your|a|all|any|supplied|provided)\s+)*(?:sources?|evidence|passages?|references?)\b/gi, ' ')
    .replace(/\bwithout\s+(?:a\s+)?(?:quiz|test|drill)\b/gi, ' ');
}

function queryTerms(text: string): string[] {
  return tokenize(cleanQuery(text)).filter(term => !QUERY_INSTRUCTIONS.has(term));
}

function comparisonSides(query: string): string[] {
  const comparison = query.match(/\b(?:compare|comparison (?:of|between)|difference between|distinguish between)\s+(.+?)\s+(?:with|and|versus|vs\.?|to)\s+(.+?)(?:[.!?]|$)/i)
    ?? query.match(/\b(.+?)\s+(?:versus|vs\.?)\s+(.+?)(?:[.!?]|$)/i);
  return comparison ? comparison.slice(1).filter(side => queryTerms(side).length > 0) : [];
}

function canonicalTerm(term: string): string {
  if (term === 'tech') return 'technology';
  if (/^licen[cs](?:e|es|ed|ing)$/.test(term)) return 'licence';
  if (/^authori[sz](?:e|es|ed|ing|ation|ations)$/.test(term)) return 'authorisation';
  if (/^allocat(?:e|es|ed|ing|ion|ions)$/.test(term)) return 'allocation';
  if (/^assign(?:s|ed|ing|ment|ments)?$/.test(term)) return 'assignment';
  if (/^transmi(?:t|ts|tting|tted|ssion|ssions)$/.test(term)) return 'transmit';
  if (/^probat(?:ion|ionary|ory)$/.test(term)) return 'probation';
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
  const normalized = cleanQuery(query).trim().toLowerCase().replace(/[.!?]+$/, '');
  return /^(?:[a-d]|(?:option|answer|i choose|my answer is)\s+[a-d]|yes|no|continue|go on|again|quiz me|test me|next(?: question)?|why(?: is (?:it|that|[a-d]) (?:right|wrong|correct|incorrect))?)$/.test(normalized)
    || queryTerms(query).length === 0
    || /^(?:explain|tell me|show me) (?:that|it|more|again|further)(?: (?:please|in (?:more )?detail|another way))?$/.test(normalized)
    || /^(?:compare (?:those|these|the two)|how (?:do|are) (?:they|those|these) (?:differ|different)|what about (?:that|this|it|those|these)|(?:what are|explain) (?:its|their|the) (?:advantages|disadvantages|limitations|benefits)|why is (?:that|this|it) important)$/.test(normalized)
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

function normalizeSuppliedHeadings(chunk: Chunk): Partial<Chunk['metadata']> {
  const headings: Array<{ heading: string; offset: number }> = [];
  let offset = 0;
  for (const line of chunk.content.split('\n')) {
    // Ignore short OCR gutter markers, but only recover a decimal section number actually in the text.
    const cleaned = line.replace(/^[\s=|>*#~:-]*(?:[A-Z]{1,2}\s+)?/, '').trim();
    if (/^\d{1,2}(?:\.\d{1,2}){1,4}\s+[A-Z][^\r\n]{2,110}$/.test(cleaned) && cleaned.split(/\s+/).length <= 16) {
      headings.push({ heading: cleaned, offset });
    }
    offset += line.length + 1;
  }
  if (headings.length === 0) return {};
  const visible = [...new Set(headings.map(item => item.heading))];
  const mixed = visible.length > 1 || tokenize(chunk.content.slice(0, headings[0].offset)).length > 12;
  const section = mixed ? `Multiple or continued sections; visible headings: ${visible.join('; ')}` : visible[0];
  const suppliedChapter = chunk.metadata.chapter.match(/\bCHAPTER\s+(\d+)\b/i)?.[1];
  const contradictsChapter = suppliedChapter && visible.some(heading => heading.split('.')[0] !== suppliedChapter);
  return { section, topic: section, ...(contradictsChapter ? { chapter: 'Chapter not established by this chunk' } : {}) };
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
  } else {
    Object.assign(metadata, normalizeSuppliedHeadings(chunk));
  }
  // Imported labels and self-declared review fields never establish independent primary-source checks.
  metadata.statusTag = 'VERIFY';
  metadata.provenance = legacy ? 'unverified' : 'provided-document';
  metadata.currencyNote = legacy
    ? 'Original source PDF and version are unavailable; claims and regulatory currency require verification.'
    : 'Document extraction records supplied source bytes and version; publisher authority and current applicability were not independently verified.';
  delete metadata.verifiedAt;
  delete metadata.exactExcerpt;
  delete metadata.excerptHash;
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
    excerpt: chunk.metadata.exactExcerpt ?? excerptFor(chunk.content, terms),
    provenance: chunk.metadata.provenance ?? 'unverified',
    ...(chunk.metadata.sourceUrl ? { url: chunk.metadata.sourceUrl } : {}),
    ...(chunk.metadata.publisher ? { publisher: chunk.metadata.publisher } : {}),
    ...(chunk.metadata.publishedDate ? { publishedDate: chunk.metadata.publishedDate } : {}),
    ...(chunk.metadata.verifiedAt ? { verifiedAt: chunk.metadata.verifiedAt } : {}),
    ...(chunk.metadata.currencyNote ? { currencyNote: chunk.metadata.currencyNote } : {}),
    ...(chunk.metadata.excerptHash ? { excerptHash: chunk.metadata.excerptHash } : {}),
  }));
  const context = documents.map(({ chunk }, index) => {
    const source = sources[index];
    return `[SOURCE ${source.id}]\nTitle: ${source.title}\nSection: ${source.section ?? 'not recorded'}\nPage: ${source.page ?? 'not recorded or multiple pages'}\nSource status: ${source.status}\nSource version: ${chunk.metadata.version ?? 'unknown'}\nBaseline: ${chunk.metadata.baselineDate ?? 'not independently recorded'}\nProvenance: ${source.provenance}\nPublisher URL: ${source.url ?? 'not recorded'}\nSource publication date: ${source.publishedDate ?? 'not established'}\nProvenance checked: ${source.verifiedAt ?? 'not independently checked'}\nCurrency limitation: ${source.currencyNote ?? 'Current applicability requires verification'}\n${chunk.content}\n[END SOURCE ${source.id}]`;
  }).join('\n\n');
  return { context, sources, quality: 'matched' };
}

function normalizedTitle(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** An explicitly named document supplies a useful scope for long scenarios and false premises.
 * Its literal section headings can establish the requested subject despite irrelevant instructions. */
function namedDocumentQuery(index: KnowledgeIndex, query: string): { titles: Set<string>; titleTerms: Set<string> } | undefined {
  const normalizedQuery = ` ${normalizedTitle(query)} `;
  const titles = new Set(index.documents.map(document => document.chunk.metadata.title)
    .filter((title): title is string => Boolean(title && title.length >= 8 && normalizedQuery.includes(` ${normalizedTitle(title)} `))));
  if (titles.size === 0) return undefined;
  const titleTerms = new Set([...titles].flatMap(title => queryTerms(title)));
  return { titles, titleTerms };
}

export function searchKnowledgeIndex(index: KnowledgeIndex, request: RetrievalRequest): RetrievalResult {
  const maxChunks = Math.max(1, Math.min(12, Math.floor(request.maxChunks ?? 6) || 6));
  const query = buildRetrievalQuery(request);
  const coreTerms = [...new Set(queryTerms(query))];
  const expandedTerms = expandTerms(cleanQuery(query)).filter(term => !QUERY_INSTRUCTIONS.has(term));
  const followUp = isFollowUp(request.query);
  const pinned = followUp && !isNewDrill(request.query) ? [...new Set(request.sourceIds ?? [])]
    .map(id => index.byId.get(id)).filter((document): document is IndexedChunk => Boolean(document)).slice(0, maxChunks) : [];
  if (pinned.length > 0) return toResult(pinned, coreTerms);
  if (coreTerms.length === 0) return toResult([], []);
  // An in-scope half of a comparison must not disguise a wholly unsupported second subject.
  if (comparisonSides(request.query).some(side => !expandTerms(side)
    .filter(term => !QUERY_INSTRUCTIONS.has(term)).some(term => index.documentFrequency.has(term)))) return toResult([], []);

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
  const namedDocument = namedDocumentQuery(index, query);
  // A topic-bearing follow-up must match its new terms; history only disambiguates existing matches.
  const contextualFollowUp = /^(?:what about|how about|and |compare (?:that|those|this|these)|how (?:does|do) (?:this|that|it|those|these))/i.test(request.query.trim());
  const previousTopic = contextualFollowUp ? [...(request.history ?? [])].reverse()
    .find(message => message.role === 'user' && !isFollowUp(message.content))?.content : undefined;
  const contextTerms = previousTopic ? expandTerms(previousTopic) : [];
  const scored = index.documents.flatMap(document => {
    if (namedDocument && !namedDocument.titles.has(document.chunk.metadata.title ?? '')) return [];
    const hits = coreTerms.filter(term => document.counts.has(term));
    // Common instruction words and unrelated category selection cannot turn missing evidence into a match.
    const requiredHits = Math.max(1, Math.ceil(coreTerms.length * 0.55));
    const aliasMatch = coreTerms.length <= 2 && hits.length === 0
      && SYNONYM_GROUPS.some(group => group.some(phrase => tokenize(phrase).every(term => coreTerms.includes(term)))
        && group.some(phrase => tokenize(phrase).length > 1 && tokenize(phrase).every(term => document.counts.has(term))));
    const focusedMatch = coreTerms.length >= 8 && namedDocument && queryTerms(document.chunk.metadata.section ?? '')
      .some(term => coreTerms.includes(term) && document.counts.has(term) && !namedDocument.titleTerms.has(term)
        && !/^\d+$/.test(term) && !['multiple', 'continued', 'visible', 'heading'].includes(term)
        && (index.documentFrequency.get(term) ?? Infinity) < index.documents.length * 0.1);
    if ((hits.length < requiredHits && !aliasMatch && !focusedMatch) || (hits.length > 0 && hits.every(term => /^\d+$/.test(term)))) return [];
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
    score *= 1 + Math.min(0.4, contextTerms.filter(term => document.counts.has(term)).length * 0.1);
    if (document.chunk.metadata.provenance === 'primary-source-checked') score *= 1.25;
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
