/**
 * Bank / card CSV statements → expense rows. Recognizes Date/Description/Amount
 * (sign detected), Debit/Credit or Withdrawal/Deposit columns, and the Chase,
 * Amex and Bank of America exports. Money out is a positive `amount` in cents;
 * credits, refunds and payments go to `ignored`.
 */
import { parse } from 'csv-parse/sync';

import { REDACTED } from '../pii/redact.ts';

export interface StatementRow {
  rowId: string;
  /** YYYY-MM-DD when recognizable, else as written. */
  date: string;
  description: string;
  /** Cents, money out. */
  amount: number;
  bankCategory?: string;
}

export interface IgnoredRow {
  rowId: string;
  date: string;
  description: string;
  amount: number;
  reason: string;
}

export interface Statement {
  layout: string;
  rows: StatementRow[];
  ignored: IgnoredRow[];
}

const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z#]+/g, ' ')
    .trim();

const DATE_H = [
  'transaction date',
  'date',
  'posting date',
  'post date',
  'trans date',
  'posted date',
];
const DESC_H = [
  'description',
  'payee',
  'merchant',
  'name',
  'details',
  'transaction description',
  'memo',
];
const AMOUNT_H = ['amount', 'transaction amount'];
const DEBIT_H = [
  'debit',
  'debits',
  'withdrawal',
  'withdrawals',
  'withdrawal amount',
  'debit amount',
  'money out',
];
const CREDIT_H = [
  'credit',
  'credits',
  'deposit',
  'deposits',
  'deposit amount',
  'credit amount',
  'money in',
];

function findCol(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** "1,024.50" / "(12.00)" / "$-3" → cents (signed). NaN when not a number. */
function cents(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const s = raw.trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || /^-|^\$-|-\$/.test(s);
  const n = Number(s.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || !/\d/.test(s)) return NaN;
  const c = Math.round(n * 100);
  return neg ? -c : c;
}

function isoDate(raw: string): string {
  const s = raw.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}

/** Card numbers (spaced or not) and other long digit runs never leave this module. */
export function cleanDescription(s: string): string {
  return s
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, REDACTED)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function parseStatement(text: string): Statement {
  const records = parse(text, {
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
  }) as string[][];

  // Header: the first of the first 15 rows with a date and an amount-ish column.
  let hi = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(records.length, 15); i++) {
    const h = records[i]!.map(norm);
    if (
      findCol(h, DATE_H) >= 0 &&
      (findCol(h, AMOUNT_H) >= 0 || findCol(h, DEBIT_H) >= 0)
    ) {
      hi = i;
      headers = h;
      break;
    }
  }
  if (hi < 0)
    throw new Error(
      'Could not find a header row with a date and an amount column.'
    );

  const dateC = findCol(headers, DATE_H);
  const descC = findCol(
    headers,
    DESC_H.filter((n) => n !== 'details' || !headers.includes('description'))
  );
  const amtC = findCol(headers, AMOUNT_H);
  const debitC = findCol(headers, DEBIT_H);
  const creditC = findCol(headers, CREDIT_H);
  const typeC = headers.indexOf('type');
  const catC = headers.indexOf('category');
  const detailsC = headers.indexOf('details');

  let layout = 'generic_signed';
  if (debitC >= 0) layout = 'debit_credit';
  else if (headers.includes('post date') && typeC >= 0 && catC >= 0)
    layout = 'chase_card';
  else if (detailsC >= 0 && headers.includes('posting date'))
    layout = 'chase_checking';
  else if (
    headers.some(
      (h) =>
        h === 'card member' ||
        h === 'account #' ||
        h === 'extended details' ||
        h === 'appears on your statement as'
    )
  )
    layout = 'amex';
  else if (headers.includes('running bal')) layout = 'bofa';

  const body = records.slice(hi + 1).filter((r) => r.length > 1);

  // Sign convention for a single signed Amount column.
  let outIsNegative = true;
  if (layout === 'amex') outIsNegative = false;
  else if (layout === 'generic_signed') {
    let neg = 0;
    let pos = 0;
    for (const r of body) {
      const v = cents(r[amtC]);
      if (v < 0) neg++;
      else if (v > 0) pos++;
    }
    outIsNegative = neg >= pos;
  }

  const out: Statement = { layout, rows: [], ignored: [] };
  body.forEach((r, i) => {
    const rowId = `r${i + 1}`;
    const date = isoDate(r[dateC] ?? '');
    const description = cleanDescription(r[descC] ?? '');
    let amount: number;
    let isCredit = false;
    if (layout === 'debit_credit') {
      const d = cents(r[debitC]);
      const c = cents(r[creditC]);
      if (Number.isFinite(d) && d !== 0) amount = Math.abs(d);
      else if (Number.isFinite(c) && c !== 0) {
        amount = Math.abs(c);
        isCredit = true;
      } else return;
    } else {
      const v = cents(r[amtC]);
      if (!Number.isFinite(v) || v === 0) return;
      isCredit = outIsNegative ? v > 0 : v < 0;
      amount = Math.abs(v);
    }
    const type = typeC >= 0 ? (r[typeC] ?? '').toLowerCase() : '';
    if (/payment|return|refund|credit|deposit/.test(type)) isCredit = true;
    if (detailsC >= 0 && /credit|dslip/i.test(r[detailsC] ?? ''))
      isCredit = true;
    if (isCredit) {
      out.ignored.push({
        rowId,
        date,
        description,
        amount,
        reason: 'Money in (credit, refund or payment), not an expense.',
      });
      return;
    }
    const row: StatementRow = { rowId, date, description, amount };
    if (catC >= 0 && r[catC]) row.bankCategory = r[catC];
    out.rows.push(row);
  });
  return out;
}
