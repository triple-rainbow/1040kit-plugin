import type { DocKind } from '../store/types.ts';

export type Classification =
  | { kind: Exclude<DocKind, 'bank_csv'> }
  | { kind: 'unknown'; unsupported: string; note: string };

/** Forms 1040kit v1 recognizes but does not compute (spec §5). */
const UNSUPPORTED: {
  re: RegExp;
  form: string;
  what: string;
  target: string;
}[] = [
  {
    re: /\b1099-R\b/i,
    form: '1099-R',
    what: 'retirement distributions',
    target: 'v1.1',
  },
  {
    re: /\bSSA-1099\b/i,
    form: 'SSA-1099',
    what: 'Social Security benefits',
    target: 'v1.1',
  },
  {
    re: /\b1099-B\b/i,
    form: '1099-B',
    what: 'stock or crypto sales',
    target: 'v2',
  },
  {
    re: /\b1099-DA\b/i,
    form: '1099-DA',
    what: 'digital asset sales',
    target: 'v2',
  },
  {
    re: /\b1098-T\b/i,
    form: '1098-T',
    what: 'education credits',
    target: 'v1.1',
  },
  {
    re: /\b1099-G\b/i,
    form: '1099-G',
    what: 'unemployment or state refunds',
    target: 'v1.1',
  },
  {
    re: /\bSchedule K-1\b/i,
    form: 'Schedule K-1',
    what: 'partnership/S-corp/trust income',
    target: 'v2',
  },
  {
    re: /\bForm 5498(?:-SA)?\b/i,
    form: '5498',
    what: 'IRA/HSA contributions',
    target: 'v1.1',
  },
  {
    re: /\b1099-SA\b/i,
    form: '1099-SA',
    what: 'HSA distributions',
    target: 'v1.1',
  },
  {
    re: /\bForm 1098\b(?!-)/i,
    form: '1098',
    what: 'mortgage interest (itemized deductions)',
    target: 'v1.1',
  },
];

const SUPPORTED: {
  kind: Exclude<DocKind, 'bank_csv' | 'unknown'>;
  re: RegExp;
}[] = [
  { kind: 'w2', re: /\bForm W-2c?\b|Wage and Tax Statement/gi },
  { kind: '1099nec', re: /\b1099-NEC\b|Nonemployee compensation/gi },
  { kind: '1099int', re: /\b1099-INT\b/gi },
  { kind: '1099div', re: /\b1099-DIV\b|Dividends and Distributions/gi },
  {
    kind: '1099misc',
    re: /\b1099-MISC\b|Miscellaneous (?:Information|Income)/gi,
  },
  { kind: '1099k', re: /\b1099-K\b|Payment Card and Third Party Network/gi },
  { kind: '1098e', re: /\b1098-E\b|Student Loan Interest Statement/gi },
  {
    kind: 'est_payment',
    re: /\b1040[- ]?ES\b|Estimated Tax Payment|\bDirect Pay\b|\bEFTPS\b/gi,
  },
];

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/** Kind of a tax document from its text layer. */
export function classify(text: string): Classification {
  // A filed 1040 mentions W-2s and 1099s everywhere; its title wins.
  if (
    /U\.?S\.? Individual Income Tax Return/i.test(text) &&
    /\bForm 1040\b|\b1040\b/.test(text)
  ) {
    return { kind: 'prior_1040' };
  }
  const head = text.slice(0, 400);
  for (const u of UNSUPPORTED) {
    // Title near the top of the document, or nothing supported matches at all.
    if (u.re.test(head)) {
      return {
        kind: 'unknown',
        unsupported: u.form,
        note: `Form ${u.form} (${u.what}) is not supported in 1040kit v1; planned for ${u.target}.`,
      };
    }
  }
  let best: { kind: (typeof SUPPORTED)[number]['kind']; n: number } | null =
    null;
  for (const s of SUPPORTED) {
    const n = count(text, s.re);
    if (n > 0 && (!best || n > best.n)) best = { kind: s.kind, n };
  }
  if (best) return { kind: best.kind };
  for (const u of UNSUPPORTED) {
    if (u.re.test(text)) {
      return {
        kind: 'unknown',
        unsupported: u.form,
        note: `Form ${u.form} (${u.what}) is not supported in 1040kit v1; planned for ${u.target}.`,
      };
    }
  }
  return { kind: 'unknown' };
}

/** CORRECTED form: a W-2c, or a 1099 with the CORRECTED marker on its own line. */
export function isCorrected(text: string): boolean {
  return (
    /\bForm W-2c\b|Corrected Wage and Tax Statement/i.test(text) ||
    /^\s*CORRECTED\s*$/m.test(text) ||
    /\bCORRECTED\s*\(X\)|\[X\]\s*CORRECTED/i.test(text)
  );
}
