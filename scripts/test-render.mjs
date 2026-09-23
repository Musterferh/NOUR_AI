import fs from 'node:fs/promises';
import { createCanvas, Image, ImageData } from 'canvas';

// ---- pdfjs-dist v5 Node.js polyfills ----------------------------------------
// Node.js v22+ has a built-in createImageBitmap, but node-canvas ctx.drawImage()
// cannot accept the resulting ImageBitmap objects. We replace it with a version
// that returns a node-canvas Canvas, which drawImage() DOES accept.
global.Image = Image;
global.ImageData = ImageData;

global.createImageBitmap = async function (source, ...args) {
  const w = source.width ?? source.naturalWidth ?? 1;
  const h = source.height ?? source.naturalHeight ?? 1;
  console.log(`  [polyfill] createImageBitmap called: ${w}x${h}, type=${source?.constructor?.name}`);
  const offscreen = createCanvas(w, h);
  const ctx = offscreen.getContext('2d');
  if (source && source.data && source.width && source.height) {
    const id = ctx.createImageData(w, h);
    const src = source.data;
    // pdfjs may pass Uint8ClampedArray (RGBA) or other formats
    for (let i = 0; i < Math.min(src.length, id.data.length); i++) id.data[i] = src[i];
    ctx.putImageData(id, 0, 0);
  }
  return offscreen;
};
// ---- end polyfills -----------------------------------------------------------


const bytes = await fs.readFile('data/Employee Handbook.pdf');
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

class NodeCanvasFactory {
  create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }
  reset({ canvas }, w, h) { canvas.width = w; canvas.height = h; }
  destroy({ canvas }) { canvas.width = 0; canvas.height = 0; }
}

const canvasFactory = new NodeCanvasFactory();

// Pass CanvasFactory (the class) to getDocument so internal CachedCanvases use node-canvas
const pdf = await getDocument({ 
  data: new Uint8Array(bytes), 
  isEvalSupported: false, 
  useSystemFonts: true, 
  CanvasFactory: NodeCanvasFactory 
}).promise;
console.log('Pages:', pdf.numPages);

const page = await pdf.getPage(1);
const viewport = page.getViewport({ scale: 1 });
console.log('Viewport:', viewport.width, 'x', viewport.height);

const { canvas, context } = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
const buf = canvas.toBuffer('image/png');
console.log('Rendered OK, PNG size:', buf.length);
await fs.writeFile('data/test-page1.png', buf);
console.log('Saved data/test-page1.png - check this file to see if it looks correct');
