/**
 * Regular tax on ordinary taxable income (Form 1040 line 16).
 *
 * i1040gi, Line 16: taxable income under $100,000 uses the Tax Table; $100,000
 * or more uses the Tax Computation Worksheet. The Tax Table is the bracket tax
 * on the midpoint of each row, rounded to whole dollars. Rows are $0-5, $5-15,
 * $15-25, then $25 wide below $3,000, then $50 wide. This reproduces every row
 * of the published 2025 Tax Table (test/tax-table.test.ts checks all of them).
 * The worksheet is the exact bracket formula (multiplication amount minus a
 * subtraction amount), rounded to whole dollars.
 */
import { roundDiv } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { Dollars, FilingStatus } from '../types.ts';

/** Exact bracket tax in micro-cents (1e-6 cent) for an amount in cents. */
export function bracketTaxMicroCents(
  amountCents: number,
  status: FilingStatus,
  params: YearParams
): number {
  const brackets = params.brackets[status];
  let total = 0;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i]!;
    const next = brackets[i + 1];
    const lo = b.over * 100;
    if (amountCents <= lo) break;
    const hi = next ? Math.min(amountCents, next.over * 100) : amountCents;
    total += (hi - lo) * b.ratePpm;
  }
  return total;
}

const MICRO_CENTS_PER_DOLLAR = 100 * 1_000_000;

/** The Tax Table row [atLeast, lessThan) that contains `ti`. */
export function taxTableRow(ti: Dollars): [number, number] {
  if (ti < 5) return [0, 5];
  if (ti < 15) return [5, 15];
  if (ti < 25) return [15, 25];
  if (ti < 3000) {
    const lo = Math.floor(ti / 25) * 25;
    return [lo, lo + 25];
  }
  const lo = Math.floor(ti / 50) * 50;
  return [lo, lo + 50];
}

/** Tax on ordinary income, in whole dollars, as the IRS tables print it. */
export function taxOnOrdinary(
  taxableIncome: Dollars,
  status: FilingStatus,
  params: YearParams
): Dollars {
  const ti = Math.max(0, Math.round(taxableIncome));
  if (ti === 0) return 0;
  if (ti < params.taxTableMax) {
    const [lo, hi] = taxTableRow(ti);
    const midCents = (lo + hi) * 50; // ((lo + hi) / 2) dollars in cents
    return roundDiv(
      bracketTaxMicroCents(midCents, status, params),
      MICRO_CENTS_PER_DOLLAR
    );
  }
  return roundDiv(
    bracketTaxMicroCents(ti * 100, status, params),
    MICRO_CENTS_PER_DOLLAR
  );
}
