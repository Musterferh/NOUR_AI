import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKnowledgeBank, parseArguments, sha256 } from './knowledge-ingest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function extractPdfPages(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.filter(item => 'str' in item)
        .map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('');
      pages.push({ page: number, text });
      page.cleanup();
    }
    return pages;
  } finally {
    await document.destroy();
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const inputPath = path.resolve(options.input);
  const outputPath = path.resolve(options.output ?? path.join(ROOT, 'data', 'knowledge-bank.json'));
  if (inputPath.toLowerCase() === outputPath.toLowerCase()) throw new Error('Input and output must be different files.');
  const bytes = await fs.readFile(inputPath);
  const hash = sha256(bytes);
  if (options.sha256 && hash !== options.sha256.toLowerCase()) throw new Error('Source SHA-256 does not match the expected artifact. No output was written.');
  const pages = await extractPdfPages(bytes);
  const bank = buildKnowledgeBank(pages, {
    title: options.title ?? path.basename(inputPath, path.extname(inputPath)),
    fileName: path.basename(inputPath),
    version: options.version,
    sha256: hash,
    status: options.status ?? 'VERIFY',
    ...(options.baseline ? { baselineDate: options.baseline } : {}),
  });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(bank, null, 2), { flag: 'wx' });
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  console.log(`Indexed ${bank.chunks.length} chunks from ${pages.length} pages into ${outputPath}`);
  console.log(`Source SHA-256: ${hash}`);
  if (bank.manifest.emptyPages.length > 0) console.warn(`Pages without text: ${bank.manifest.emptyPages.join(', ')}. Check these pages for scanned content or diagrams.`);
  return bank.manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
