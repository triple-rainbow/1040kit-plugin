/**
 * Local OCR fallback for scans and photos. tesseract.js runs in a worker
 * thread with its WASM core from node_modules and the English model from the
 * bundled @tesseract.js-data/eng package: nothing is downloaded, and no image
 * leaves the machine. Images are passed as bytes, never URLs.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { extractImages, getDocumentProxy } from 'unpdf';

import { pdfText, readDocText, type TextResult } from './text.ts';

const require = createRequire(import.meta.url);

/** Folder holding eng.traineddata.gz (LSTM "best_int" model, the default engine). */
export function langPath(): string {
  return join(
    dirname(require.resolve('@tesseract.js-data/eng/package.json')),
    '4.0.0_best_int'
  );
}

const MIN_TEXT = 20;
const OCR_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
  '.webp',
  '.bmp',
]);

/** OCR one image (PNG/JPEG/TIFF/WebP bytes). */
export async function ocrImage(image: Uint8Array): Promise<string> {
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: langPath(),
    gzip: true,
    cacheMethod: 'none',
    logger: () => undefined,
    errorHandler: () => undefined,
  });
  try {
    const { data } = await worker.recognize(Buffer.from(image));
    return data.text;
  } finally {
    await worker.terminate();
  }
}

/** OCR every page of an image-only PDF via the images embedded in it. */
export async function ocrPdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const images = await extractImages(pdf, p, { format: 'png' });
    // A scanned page is one big image; skip logos and specks.
    const big = images.filter((i) => i.width * i.height >= 200 * 200);
    for (const img of big) pages.push(await ocrImage(img.data));
  }
  return pages.join('\n');
}

/**
 * readDocText, plus OCR when there is no text layer. Never throws: OCR
 * failures come back as needs_ocr.
 */
export async function readDocTextWithOcr(
  absPath: string
): Promise<TextResult & { ocr?: boolean }> {
  const first = await readDocText(absPath);
  if (first.status !== 'needs_ocr') return first;
  const ext = extname(absPath).toLowerCase();
  try {
    const bytes = await readFile(absPath);
    let text = '';
    if (ext === '.pdf') text = await ocrPdf(bytes);
    else if (OCR_EXTS.has(ext)) text = await ocrImage(bytes);
    else return first;
    if (text.replace(/\s+/g, '').length < MIN_TEXT) return first;
    return { status: 'ok', text, ocr: true };
  } catch {
    return first;
  }
}

export { pdfText };
