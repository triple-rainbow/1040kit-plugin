/**
 * Shared helpers for text-layer parsers. Parsers are pure: text in, a
 * `ParsedDoc` out. Parsers never read the recipient's SSN or account
 * numbers at all; the payer's ID goes in `pii.payerTin`, and extract.ts keeps
 * it (as a token) only when it is an EIN.
 */

export interface LowConfidence {
  field: string;
  reason: string;
}

export interface ParsedDoc {
  /** Amounts in cents, keyed by the TaxFacts field name. */
  amounts: Record<string, number>;
  flags: Record<string, boolean>;
  pii: {
    /** Payer / employer / lender ID: an EIN, or an SSN for an individual payer (discarded). */
    payerTin?: string;
  };
  names: { payer?: string; recipient?: string };
  corrected: boolean;
  lowConfidence: LowConfidence[];
}

export const emptyParsed = (corrected: boolean): ParsedDoc => ({
  amounts: {},
  flags: {},
  pii: {},
  names: {},
  corrected,
  lowConfidence: [],
});

const AMOUNT = String.raw`\(?-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?|\(?-?\$?\s*\d+\.\d{2}\)?`;
const AMOUNT_LOOSE = String.raw`\(?-?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?`;

/** "52,345.67" → 5234567; "(12.00)" → -1200. */
export function toCents(raw: string): number {
  const neg = /^\s*\(.*\)\s*$/.test(raw) || raw.includes('-');
  const digits = raw.replace(/[^\d.]/g, '');
  const [whole, frac = ''] = digits.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

/**
 * First amount following a label. Looks on the label's own line, then on the
 * next two lines when they hold nothing but an amount. Tries every occurrence
 * of the label (a form title may repeat a box name without a value).
 */
export function amountAfter(
  text: string,
  label: RegExp,
  opts: { loose?: boolean } = {}
): number | undefined {
  const amt = opts.loose ? AMOUNT_LOOSE : AMOUNT;
  const flags = label.flags.includes('g') ? label.flags : label.flags + 'g';
  const re = new RegExp(label.source, flags);
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const [line = '', ...next] = rest.split('\n');
    const same = new RegExp(`(?:^|[\\s$])(${amt})(?=\\s|$)`).exec(line);
    if (same) return toCents(same[1]!);
    for (const l of next.slice(0, 2)) {
      const only = new RegExp(`^\\s*(${amt})\\s*$`).exec(l);
      if (only) return toCents(only[1]!);
    }
  }
  return undefined;
}

/** Text after a label on its line, or the next non-empty line. */
export function valueAfter(text: string, label: RegExp): string | undefined {
  const m = label.exec(text);
  if (!m) return undefined;
  const rest = text.slice(m.index + m[0].length);
  const [line = '', ...next] = rest.split('\n');
  const clean = (s: string) => s.replace(/^[\s:,.-]+/, '').trim();
  if (clean(line)) return clean(line);
  const n = next.find((l) => l.trim());
  return n ? clean(n) : undefined;
}

export const SSN_RE =
  /(?<![\d-])((?:\d{3}|[X*]{3})-(?:\d{2}|[X*]{2})-\d{4})(?![\d-])/i;
export const EIN_RE = /(?<![\d-])(\d{2}-\d{7})(?![\d-])/;

/** First SSN-shaped value after a label (or anywhere, if no label matches). */
export function tinAfter(
  text: string,
  label: RegExp,
  shape: RegExp
): string | undefined {
  const m = label.exec(text);
  if (m) {
    const window = text.slice(
      m.index + m[0].length,
      m.index + m[0].length + 160
    );
    const hit = shape.exec(window);
    if (hit) return hit[1];
  }
  return undefined;
}

export const isMasked = (tin: string) => /[X*]/i.test(tin);

export function readAmounts(
  text: string,
  out: ParsedDoc,
  spec: Record<string, { label: RegExp; required?: boolean }>
): void {
  for (const [field, { label, required }] of Object.entries(spec)) {
    const v = amountAfter(text, label);
    if (v !== undefined) out.amounts[field] = v;
    else if (required) {
      out.amounts[field] = 0;
      out.lowConfidence.push({
        field,
        reason: 'Not found on the document; confirm the amount with the user.',
      });
    }
  }
}

/**
 * Payer TIN and names common to the 1099 family. The recipient's TIN and the
 * account number are never read. `who` is the payer's label ("PAYER", or
 * "LENDER" on a 1098-E).
 */
export function read1099Header(
  text: string,
  out: ParsedDoc,
  who: 'PAYER' | 'LENDER' = 'PAYER'
): void {
  // On a 1098-E the lender is the "RECIPIENT" (of the interest).
  const party = who === 'LENDER' ? '(?:RECIPIENT|LENDER)' : 'PAYER';
  const tinLabel = new RegExp(
    `${party}['’]?S (?:TIN|federal identification number|taxpayer identification number)`,
    'i'
  );
  const payer =
    tinAfter(text, tinLabel, EIN_RE) ?? tinAfter(text, tinLabel, SSN_RE);
  if (payer) out.pii.payerTin = payer;
  const payerName = valueAfter(
    text,
    new RegExp(
      `${who === 'LENDER' ? "(?:RECIPIENT['’]?S/)?LENDER" : 'PAYER'}['’]?S name(?:, street address[^\\n]*)?`,
      'i'
    )
  );
  if (payerName && !/TIN|identification/i.test(payerName))
    out.names.payer = payerName.slice(0, 80);
  const recName = valueAfter(
    text,
    who === 'LENDER' ? /BORROWER['’]?S name/i : /RECIPIENT['’]?S name/i
  );
  if (recName && !/TIN|identification/i.test(recName))
    out.names.recipient = recName.slice(0, 80);
}

export const WITHHELD = { label: /Federal income tax withheld/i };
