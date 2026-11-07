import type { FilingStatus, PriorYearSummary } from '@1040kit/engine';

import { amountAfter } from './common.ts';

const dollars = (cents: number | undefined) =>
  cents === undefined ? undefined : Math.round(cents / 100);

/** Prior-year Form 1040: used only for year-over-year review flags. */
export function parsePrior1040(text: string): {
  summary: PriorYearSummary;
  fields: Record<string, number | string>;
} {
  const year =
    /Form\s*1040[^\n]{0,80}?\b(20\d\d)\b/i.exec(text)?.[1] ??
    /\b(20\d\d)\b/.exec(text)?.[1];
  const loose = { loose: true };
  const agi = amountAfter(
    text,
    /(?:This is your )?adjusted gross income/i,
    loose
  );
  const totalTax = amountAfter(
    text,
    /This is your total tax|\btotal tax\b/i,
    loose
  );
  const wages = amountAfter(
    text,
    /Total amount from Form\(s\) W-2|Wages, salaries, tips/i,
    loose
  );
  const refund = amountAfter(
    text,
    /Amount of line \d+ you want refunded to you|amount you overpaid/i,
    loose
  );
  const owed = amountAfter(text, /Amount you owe/i, loose);
  let filingStatus: FilingStatus | undefined;
  if (/(?:\[X\]|☒|X)\s*Married filing jointly/i.test(text))
    filingStatus = 'mfj';
  else if (/(?:\[X\]|☒|X)\s*Head of household/i.test(text))
    filingStatus = 'hoh';
  else if (/(?:\[X\]|☒|X)\s*Single/i.test(text)) filingStatus = 'single';

  const summary: PriorYearSummary = { taxYear: year ? Number(year) : 0 };
  if (agi !== undefined) summary.agi = dollars(agi);
  if (totalTax !== undefined) summary.totalTax = dollars(totalTax);
  if (wages !== undefined) summary.wages = dollars(wages);
  if (refund) summary.refundOrOwed = dollars(refund);
  else if (owed) summary.refundOrOwed = -dollars(owed)!;
  if (filingStatus) summary.filingStatus = filingStatus;

  const fields: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(summary))
    if (v !== undefined) fields[k] = v as number | string;
  return { summary, fields };
}
