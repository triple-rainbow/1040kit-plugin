/**
 * Test-only: render a synthetic PDF page to PNG (via @napi-rs/canvas, a dev
 * dependency) and wrap a PNG in an image-only PDF, to simulate scans.
 */
import { PDFDocument } from 'pdf-lib';
import { renderPageAsImage } from 'unpdf';

export async function renderPng(
  pdf: Uint8Array,
  scale = 3
): Promise<Uint8Array> {
  const out = await renderPageAsImage(new Uint8Array(pdf), 1, {
    canvasImport: () => import('@napi-rs/canvas'),
    scale,
  });
  return new Uint8Array(out as Uint8Array);
}

export async function scanPdf(png: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  return doc.save();
}
