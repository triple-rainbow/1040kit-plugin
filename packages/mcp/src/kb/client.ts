/**
 * Client for the hosted knowledge base (api.1040kit.com/kb/search). This is
 * the only network call 1040kit makes. The query is stripped of anything
 * PII-shaped, tokens and exact dollar amounts before it leaves the machine.
 */
import type { TaxYear } from '@1040kit/engine';
import { z } from 'zod';

import { kbUrl } from '../env.ts';
import { ToolError } from '../envelope.ts';
import { REDACTED, redactString } from '../pii/redact.ts';

export const MAX_QUERY = 500;
const TIMEOUT_MS = 12000;

const passage = z.object({
  docId: z.string(),
  section: z.string().nullish(),
  text: z.string(),
  sourceUrl: z.string(),
  revisionDate: z.string().nullish(),
});
const responseSchema = z.object({ passages: z.array(passage) });
export type Passage = z.infer<typeof passage>;

/** Remove PII, {{tokens}} and amounts with cents. */
export function sanitizeQuery(q: string): string {
  return redactString(q)
    .split(REDACTED)
    .join(' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\$?\s?\d[\d,]*\.\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const cache = new Map<string, Passage[]>();

export function clearKbCache(): void {
  cache.clear();
}

export async function kbSearch(
  fetchFn: typeof fetch,
  query: string,
  taxYear: TaxYear,
  k: number
): Promise<{ passages: Passage[]; cached: boolean; sentQuery: string }> {
  if (query.length > MAX_QUERY) {
    throw new ToolError(
      'QUERY_TOO_LONG',
      `Keep kb_search queries under ${MAX_QUERY} characters.`
    );
  }
  const clean = sanitizeQuery(query);
  if (!/[a-z]{2,}/i.test(clean)) {
    throw new ToolError(
      'QUERY_EMPTY',
      'Nothing left to search after removing personal numbers. Ask a question in words.'
    );
  }
  const key = `${taxYear}|${k}|${clean.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return { passages: hit, cached: true, sentQuery: clean };

  const url = new URL(kbUrl());
  url.searchParams.set('ty', String(taxYear));
  url.searchParams.set('q', clean);
  url.searchParams.set('k', String(k));

  let body: unknown;
  try {
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new ToolError(
      'KB_UNAVAILABLE',
      `The 1040kit knowledge base is unavailable (${(e as Error).message}). Rely on the engine's citations from explain_line.`
    );
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ToolError(
      'KB_UNAVAILABLE',
      'The knowledge base sent an unexpected response. Rely on the engine’s citations.'
    );
  }
  const passages = parsed.data.passages.slice(0, k);
  cache.set(key, passages);
  return { passages, cached: false, sentQuery: clean };
}
