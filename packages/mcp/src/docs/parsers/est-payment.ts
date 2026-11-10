/**
 * Estimated tax payment receipts: IRS Direct Pay and IRS Online Account
 * confirmations, EFTPS acknowledgments, and Form 1040-ES payment vouchers.
 * Reads the amount, the payment date and the tax year it was paid for.
 * Confirmation, EFT and account numbers are never read.
 */
import { amountAfter } from './common.ts';

export interface EstPaymentReceipt {
  /** Cents; undefined when not found. */
  amount?: number;
  /** YYYY-MM-DD. */
  date?: string;
  /** The tax year (period) the payment is for. */
  taxYear?: number;
  /** What it pays: 1040-ES estimated tax, or something else (balance due, extension). */
  purpose: 'estimated' | 'balance_due' | 'extension' | 'unknown';
}

const AMOUNT_LABEL =
  /Payment Amount|Amount Paid|Amount of estimated tax you are paying[^$\d]*|Tax Amount|Amount/i;

function isoDate(raw: string): string | undefined {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return undefined;
}

export function parseEstPayment(text: string): EstPaymentReceipt {
  const flat = text.replace(/\s+/g, ' ');
  const purpose: EstPaymentReceipt['purpose'] = /\b4868\b|Extension/i.test(flat)
    ? 'extension'
    : /Balance Due|Amount Owed|Notice/i.test(flat) &&
        !/Estimated Tax|1040[- ]?ES/i.test(flat)
      ? 'balance_due'
      : /Estimated Tax|1040[- ]?ES/i.test(flat)
        ? 'estimated'
        : 'unknown';
  const amount = amountAfter(text, AMOUNT_LABEL);
  const dateRaw =
    /(?:Payment Date|Settlement Date|Date Paid|Payment Initiated|Date)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(
      flat
    )?.[1];
  const year =
    /(?:Tax Period(?: for Payment)?|Tax Year|Calendar year|Tax Period Ending)\s*:?\s*(?:\d{1,2}\/\d{1,2}\/|12\/)?(\d{4})/i.exec(
      flat
    )?.[1] ??
    /\b(\d{4})\s+Form 1040-ES\b|\bForm 1040-ES\s*\(?(\d{4})/i
      .exec(flat)
      ?.slice(1)
      .find(Boolean);
  return {
    ...(amount !== undefined ? { amount } : {}),
    ...(dateRaw && isoDate(dateRaw) ? { date: isoDate(dateRaw)! } : {}),
    ...(year ? { taxYear: Number(year) } : {}),
    purpose,
  };
}
