import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

export type TextResult =
  | { status: 'ok'; text: string }
  | { status: 'needs_ocr' }
  | { status: 'encrypted_pdf' }
  | { status: 'unreadable'; message: string }
  | { status: 'not_pdf' };

export const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.webp',
]);

/** Fewer meaningful characters than this means "a scan with no text layer". */
const MIN_TEXT = 20;

export function fileKindByExt(file: string): 'pdf' | 'csv' | 'image' | 'other' {
  const ext = extname(file).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.csv') return 'csv';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'other';
}

export async function pdfText(bytes: Uint8Array): Promise<TextResult> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const { text } = await extractText(pdf, { mergePages: true });
      if (text.replace(/\s+/g, '').length < MIN_TEXT)
        return { status: 'needs_ocr' };
      return { status: 'ok', text };
    } finally {
      await pdf.cleanup?.().catch(() => undefined);
    }
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') return { status: 'encrypted_pdf' };
    return {
      status: 'unreadable',
      message: (e as Error)?.message ?? String(e),
    };
  }
}

/** Text layer of a document in the inbox. Never throws. */
export async function readDocText(absPath: string): Promise<TextResult> {
  const k = fileKindByExt(absPath);
  if (k === 'image') return { status: 'needs_ocr' };
  if (k !== 'pdf') return { status: 'not_pdf' };
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch (e) {
    return { status: 'unreadable', message: (e as Error).message };
  }
  return pdfText(bytes);
}
