/**
 * ocr-pdf.mjs
 * Extracts text from scanned (image-based) PDFs using pdfjs-dist + canvas
 * rendering + Tesseract.js OCR, then builds a knowledge-bank JSON.
 *
 * Usage:
 *   node scripts/ocr-pdf.mjs --input "data/Employee Handbook.pdf" --version "handbook-v1"
 *   [--output data/bank-handbook.json] [--scale 2] [--lang eng] [--title "My Doc"] [--status VERIFY]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Image } from 'canvas';
import { createWorker } from 'tesseract.js';
import { buildKnowledgeBank, sha256 } from './knowledge-ingest.mjs';

// pdfjs-dist uses `new Image()` when painting scanned pages.
// In Node.js there is no global Image — supply canvas’s implementation.
global.Image = Image;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const allowed = new Set(['input', 'output', 'version', 'scale', 'lang', 'title', 'status']);
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    if (!argv[i]?.startsWith('--') || !allowed.has(key) || !argv[i + 1]) {
      throw new Error(`Unknown argument: ${argv[i]}. Allowed: ${[...allowed].map(k => '--' + k).join(' ')}`);
    }
    opts[key] = argv[i + 1];
  }
  if (!opts.input || !opts.version) throw new Error('--input and --version are required.');
  return opts;
}

// ---------------------------------------------------------------------------
// NodeCanvasFactory — required by pdfjs-dist for Node.js rendering
// ---------------------------------------------------------------------------
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset({ canvas }, width, height) {
    canvas.width = width;
    canvas.height = height;
  }
  destroy({ canvas }) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

// ---------------------------------------------------------------------------
// Render one PDF page → PNG Buffer
// ---------------------------------------------------------------------------
async function renderPageToPng(page, scale) {
  const canvasFactory = new NodeCanvasFactory();
  const viewport = page.getViewport({ scale });
  const { canvas, context } = canvasFactory.create(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );

  await page.render({ canvasContext: context, viewport, canvasFactory }).promise;

  const buffer = canvas.toBuffer('image/png');
  // Release canvas memory
  canvasFactory.destroy({ canvas });
  return buffer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(ROOT, opts.input);
  const scale = Number(opts.scale ?? 2);
  const lang = opts.lang ?? 'eng';
  const title = opts.title ?? path.basename(inputPath, path.extname(inputPath));
  const slug = path.basename(inputPath, path.extname(inputPath)).replace(/\s+/g, '-').toLowerCase();
  const outputPath = path.resolve(ROOT, opts.output ?? path.join(ROOT, 'data', `bank-${slug}.json`));

  console.log(`📄  Input:  ${inputPath}`);
  console.log(`📦  Output: ${outputPath}`);
  console.log(`🔍  Scale:  ${scale}x  |  Language: ${lang}\n`);

  const bytes = await fs.readFile(inputPath);
  const hash = sha256(bytes);
  console.log(`Source SHA-256: ${hash}`);

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    CanvasFactory: NodeCanvasFactory,
  }).promise;
  console.log(`Pages: ${pdf.numPages}\n`);

  // Tesseract worker — logger writes progress in-place
  const worker = await createWorker(lang, 1, {
    logger: m => {
      if (m.status === 'recognizing text') {
        process.stdout.write(`\r    OCR: ${Math.round(m.progress * 100)}%   `);
      }
    },
  });

  const pages = [];
  try {
    for (let num = 1; num <= pdf.numPages; num++) {
      process.stdout.write(`\nPage ${num}/${pdf.numPages}  rendering...`);
      const page = await pdf.getPage(num);
      const pngBuffer = await renderPageToPng(page, scale);
      page.cleanup();

      process.stdout.write(' OCR...');
      // Pass raw Buffer — works reliably in Node.js across Tesseract.js versions
      const { data: { text } } = await worker.recognize(pngBuffer);
      process.stdout.write(' ✓');

      pages.push({ page: num, text: text.trim() });
    }
  } finally {
    await worker.terminate();
    await pdf.destroy();
  }

  console.log('\n\nBuilding knowledge bank...');
  const bank = buildKnowledgeBank(pages, {
    title,
    fileName: path.basename(inputPath),
    version: opts.version,
    sha256: hash,
    status: opts.status ?? 'VERIFY',
  });

  const tmp = `${outputPath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(bank, null, 2), { flag: 'wx' });
  await fs.rename(tmp, outputPath);

  console.log(`\n✅  Indexed ${bank.chunks.length} chunks from ${pages.length} pages → ${outputPath}`);
  const empty = bank.manifest.emptyPages ?? [];
  if (empty.length > 0) console.warn(`⚠️   Empty/unreadable pages: ${empty.join(', ')}`);
}

main().catch(err => { console.error('\n❌', err.message); process.exitCode = 1; });
