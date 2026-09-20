import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function extractPdfText(pdfPath) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() =>
    import('pdfjs-dist')
  );
  
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  let fullText = '';
  
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    fullText += pageText + '\n\n';
    if (i % 10 === 0) process.stdout.write('\r  Read ' + i + '/' + doc.numPages + ' pages...');
  }
  console.log('\r  Read all ' + doc.numPages + ' pages.          ');
  return fullText;
}

async function main() {
  console.log('Loading embedding model (downloads ~30MB first time)...');
  const { pipeline } = await import('@xenova/transformers');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Model ready.');

  async function embed(text) {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  const pdfPath = path.join(ROOT, 'data', 'Arfats_NCC_Promotion_Exam_MASTER_CONTROLLED_v6_0_Checkpoint_28_REMAINING_CURRENCY_CONTROL.pdf');
  console.log('Reading PDF: ' + path.basename(pdfPath));
  const text = await extractPdfText(pdfPath);
  console.log('PDF text extracted. Length: ' + text.length + ' chars');

  console.log('Chunking text...');
  const paragraphs = text.split(/\n\s*\n/);
  let currentChapter = 'Intro';
  let currentTopic = 'General';
  const chunks = [];
  let currentContent = '';
  let chunkIndex = 0;

  function pushChunk() {
    if (currentContent.trim().length === 0) return;
    chunks.push({
      id: 'chunk-' + chunkIndex++,
      metadata: { id: 'doc-' + chunkIndex, chapter: currentChapter, topic: currentTopic, statusTag: 'Active' },
      content: currentContent.trim()
    });
    currentContent = '';
  }

  for (const para of paragraphs) {
    const chapterMatch = para.match(/chapter\s+(\d+)|checkpoint\s+(\d+)/i);
    if (chapterMatch) {
      if (chapterMatch[1]) currentChapter = 'Chapter ' + chapterMatch[1];
      if (chapterMatch[2]) currentTopic = 'Checkpoint ' + chapterMatch[2];
    }
    const lower = para.toLowerCase();
    if (lower.includes('spectrum')) currentTopic = 'Spectrum Lifecycle';
    if (lower.includes('qos') || lower.includes('qoe')) currentTopic = 'QoS vs QoE';
    if (lower.includes('nin-sim')) currentTopic = 'NIN-SIM 2025';
    if (lower.includes('tirms')) currentTopic = 'TIRMS Architecture';
    if (lower.includes('nca 2003')) currentTopic = 'NCA 2003';
    currentContent += para + '\n\n';
    if (currentContent.length > 3500) pushChunk();
  }
  pushChunk();

  console.log('Created ' + chunks.length + ' chunks. Generating embeddings (few minutes)...');

  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write('\r  Embedding ' + (i + 1) + ' / ' + chunks.length + '...');
    chunks[i].embedding = await embed(chunks[i].content);
  }

  const outPath = path.join(ROOT, 'data', 'embeddings.json');
  fs.writeFileSync(outPath, JSON.stringify(chunks));
  const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
  console.log('\nDone! Saved ' + chunks.length + ' chunks (' + sizeKB + ' KB) to data/embeddings.json');
  console.log('You can now deploy to Vercel!');
}

main().catch(err => { console.error('\nError:', err); process.exit(1); });
