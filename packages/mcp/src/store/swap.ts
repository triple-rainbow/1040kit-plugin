/**
 * Make the spouse the main filer on a joint return: everything that belongs
 * to "spouse" becomes the taxpayer's and the other way round (person facts,
 * document owners, businesses, per-person amounts, names, provenance). The
 * first name read from a document becomes the taxpayer's, so this is how a
 * couple puts the right person first.
 */
import type { StoreData } from './types.ts';

const OTHER: Record<string, string> = {
  taxpayer: 'spouse',
  spouse: 'taxpayer',
};

function swapValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(swapValue);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const key = OTHER[k] ?? k;
    out[key] =
      (k === 'owner' || k === 'id') && typeof x === 'string' && OTHER[x]
        ? OTHER[x]
        : swapValue(x);
  }
  return out;
}

/** "businesses[taxpayer].name" → "businesses[spouse].name"; "taxpayer.blind" → "spouse.blind". */
export function swapPath(path: string): string {
  return path
    .split('.')
    .map((seg) => {
      if (OTHER[seg]) return OTHER[seg];
      const m = /^(\w+)\[(taxpayer|spouse)\]$/.exec(seg);
      return m ? `${m[1]}[${OTHER[m[2]!]}]` : seg;
    })
    .join('.');
}

export function swapFilers(data: StoreData): void {
  const facts = data.facts as unknown as Record<string, unknown>;
  facts.spouse ??= { id: 'spouse' };
  data.facts = swapValue(facts) as StoreData['facts'];
  data.identity = swapValue(data.identity) as StoreData['identity'];
  data.provenance = Object.fromEntries(
    Object.entries(data.provenance).map(([k, e]) => [swapPath(k), e])
  );
  data.answers = Object.fromEntries(
    Object.entries(data.answers).map(([k, v]) => [swapPath(k), v])
  );
  data.expenseImports = Object.fromEntries(
    Object.entries(data.expenseImports).map(([k, imp]) => {
      const owner = OTHER[imp.owner] as typeof imp.owner;
      return [`${owner}:${k.slice(k.indexOf(':') + 1)}`, { ...imp, owner }];
    })
  );
}
