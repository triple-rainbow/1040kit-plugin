import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { DocEntry, StoreData } from '../store/types.ts';
import { inboxPath } from '../store/workspace.ts';
import { classify } from './classify.ts';
import { fileKindByExt, pdfText } from './text.ts';

async function walk(dir: string, root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(abs, root)));
    else if (e.isFile()) out.push(relative(root, abs).split(sep).join('/'));
  }
  return out.sort();
}

function nextDocId(docs: DocEntry[]): string {
  let max = 0;
  for (const d of docs) {
    const n = Number(/^doc_(\d+)$/.exec(d.docId)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return `doc_${max + 1}`;
}

async function classifyFile(
  file: string,
  bytes: Buffer
): Promise<Pick<DocEntry, 'kind' | 'status' | 'note'>> {
  const k = fileKindByExt(file);
  if (k === 'csv') return { kind: 'bank_csv', status: 'new' };
  if (k === 'image') return { kind: 'unknown', status: 'needs_ocr' };
  if (k !== 'pdf') {
    return {
      kind: 'unknown',
      status: 'new',
      note: 'Not a PDF, image or CSV; 1040kit can’t read this file type.',
    };
  }
  const t = await pdfText(bytes);
  if (t.status === 'encrypted_pdf') {
    return {
      kind: 'unknown',
      status: 'encrypted_pdf',
      note: 'Password-protected PDF. Save an unlocked copy (print to PDF) into the inbox.',
    };
  }
  if (t.status === 'needs_ocr') return { kind: 'unknown', status: 'needs_ocr' };
  if (t.status !== 'ok') {
    return {
      kind: 'unknown',
      status: 'new',
      note: 'Could not read this PDF; it may be damaged.',
    };
  }
  const c = classify(t.text);
  if ('unsupported' in c)
    return { kind: 'unknown', status: 'unsupported_form', note: c.note };
  return { kind: c.kind, status: 'new' };
}

/**
 * Inventory the inbox into `data.docs`: stable ids, sha256 dedupe, classification.
 * Never throws for a bad file.
 */
export async function scanInbox(
  ws: string,
  data: StoreData
): Promise<DocEntry[]> {
  const inbox = inboxPath(ws);
  const files = await walk(inbox, inbox);
  const byFile = new Map(data.docs.map((d) => [d.file, d]));
  const next: DocEntry[] = [];
  const firstBySha = new Map<string, string>();
  const seen = new Set<string>();

  // Keep already-known primaries first so duplicates point at the older doc.
  for (const d of data.docs) {
    if (d.status !== 'duplicate' && !firstBySha.has(d.sha256))
      firstBySha.set(d.sha256, d.docId);
  }

  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(inbox, file));
    } catch {
      continue;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    seen.add(file);
    const prev = byFile.get(file);
    if (prev && prev.sha256 === sha256) {
      next.push(prev);
      continue;
    }
    const docId = prev?.docId ?? nextDocId([...data.docs, ...next]);
    const primary = firstBySha.get(sha256);
    if (primary && primary !== docId) {
      next.push({
        docId,
        file,
        sha256,
        kind: 'unknown',
        status: 'duplicate',
        duplicateOf: primary,
        note: 'Same file as another document.',
      });
      continue;
    }
    firstBySha.set(sha256, docId);
    const c = await classifyFile(file, bytes);
    const entry: DocEntry = { docId, file, sha256, ...c };
    // Content changed under the same name: keep the fact id so re-extract replaces it.
    if (prev?.factId) entry.factId = prev.factId;
    next.push(entry);
  }

  // Duplicates inherit the primary's kind for display.
  for (const d of next) {
    if (d.status === 'duplicate') {
      const p = next.find((x) => x.docId === d.duplicateOf);
      if (p) d.kind = p.kind;
    }
  }

  // Files removed from the inbox: keep extracted ones (their facts remain).
  for (const d of data.docs) {
    if (!seen.has(d.file) && d.status === 'extracted') {
      next.push({
        ...d,
        note: 'File is no longer in the inbox; its facts are kept.',
      });
    }
  }

  data.docs = next;
  return next;
}

/** The fields of a DocEntry the agent sees. */
export function publicDoc(d: DocEntry) {
  const { docId, file, sha256, kind, status, duplicateOf, note } = d;
  return {
    docId,
    file,
    sha256,
    kind,
    status,
    ...(duplicateOf ? { duplicateOf } : {}),
    ...(note ? { note } : {}),
    ...(d.supersededBy ? { supersededBy: d.supersededBy } : {}),
  };
}
