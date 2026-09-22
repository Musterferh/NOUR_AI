import { createHash } from 'node:crypto';

export const STATUSES = ['CURRENT', 'IMPLEMENTED', 'ACHIEVEMENT', 'INITIATIVE', 'CONSULTATION', 'DRAFT', 'HISTORICAL', 'OBSERVED', 'VERIFY'];
export const GENERATOR_VERSION = 'nour-lexical-v1';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseArguments(args) {
  const allowed = new Set(['input', 'output', 'title', 'version', 'baseline', 'sha256', 'status']);
  /** @type {Record<string, string>} */
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!args[i]?.startsWith('--') || !allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Invalid argument: ${args[i]}. Use --input file.pdf --version source-version [--baseline YYYY-MM-DD] [--sha256 expected-hash] [--output file.json] [--title title] [--status VERIFY].`);
    }
    if (key in options) throw new Error(`Duplicate option --${key}`);
    options[key] = args[i + 1];
  }
  if (!options.input || !options.version) throw new Error('--input and --version are required. The original PDF must be supplied explicitly.');
  if (options.baseline && (!/^\d{4}-\d{2}-\d{2}$/.test(options.baseline) || Number.isNaN(Date.parse(options.baseline)) || new Date(options.baseline).toISOString().slice(0, 10) !== options.baseline)) {
    throw new Error('--baseline must be a valid YYYY-MM-DD date recorded by the source.');
  }
  if (options.sha256 && !/^[a-f0-9]{64}$/i.test(options.sha256)) throw new Error('--sha256 must contain exactly 64 hexadecimal characters.');
  if (options.status && !STATUSES.includes(options.status)) throw new Error(`--status must be one of: ${STATUSES.join(', ')}`);
  return options;
}

function isHeading(line) {
  return /^(?:DEEP\s+)?CHAPTER\s+\d+\b/i.test(line)
    || /^CHECKPOINT\s+\d+\s*[-–—:]/i.test(line)
    || /^\d+(?:\.\d+)+[.)]?\s+\S/.test(line)
    || /^\d+\.\s+[A-Z][A-Z\s/&()–—:-]{4,}$/.test(line);
}

function splitSection(text, maxWords = 320, overlapWords = 35) {
  const words = [...text.matchAll(/\S+/g)];
  const pieces = [];
  for (let offset = 0; offset < words.length;) {
    const end = Math.min(words.length, offset + maxWords);
    const lastWord = words[end - 1];
    pieces.push(text.slice(words[offset].index, lastWord.index + lastWord[0].length));
    if (end === words.length) break;
    offset = end - overlapWords;
  }
  return pieces;
}

/** Page boundaries are supplied by the PDF parser; chunks never cross them or a detected heading. */
export function buildKnowledgeBank(pages, source, generatedAt = new Date().toISOString()) {
  if (!source.title || !source.fileName || !source.version || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('Source provenance is incomplete.');
  if (!STATUSES.includes(source.status ?? 'VERIFY')) throw new Error('Invalid source status.');
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('The PDF has no pages.');
  const chunks = [];
  let section;
  let chapter;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    if (page.page !== pageIndex + 1 || typeof page.text !== 'string') throw new Error('Page numbers must match the PDF page order.');
    let buffered = [];
    const flush = () => {
      for (const content of splitSection(buffered.join('\n').trim())) {
        const id = `source-${source.sha256.slice(0, 16)}-p${page.page}-${chunks.length}`;
        chunks.push({
          id,
          content,
          metadata: {
            id,
            title: source.title,
            chapter: chapter ?? 'Section not recorded',
            topic: section ?? source.title,
            ...(section ? { section } : {}),
            page: page.page,
            sourceFile: source.fileName,
            sourceHash: source.sha256,
            version: source.version,
            ...(source.baselineDate ? { baselineDate: source.baselineDate } : {}),
            statusTag: source.status ?? 'VERIFY',
          },
        });
      }
      buffered = [];
    };
    for (const rawLine of page.text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (isHeading(line)) {
        flush();
        section = line.slice(0, 250);
        if (/^(?:DEEP\s+)?CHAPTER\s+\d+\b/i.test(line)) chapter = section;
      }
      buffered.push(line);
    }
    flush();
  }
  if (chunks.length === 0) throw new Error('No extractable text was found. Supply a text PDF or perform OCR before ingestion.');
  return {
    schemaVersion: 1,
    manifest: {
      generatorVersion: GENERATOR_VERSION,
      retrievalAlgorithm: 'BM25',
      generatedAt,
      source,
      pageCount: pages.length,
      emptyPages: pages.filter(page => !page.text.trim()).map(page => page.page),
      chunkCount: chunks.length,
      contentSha256: sha256(JSON.stringify(chunks)),
    },
    chunks,
  };
}
