/**
 * Earned Income Credit Table lookup (i1040gi / Pub. 1040 "Earned Income Credit
 * (EIC) Table"), reproduced from the Rev. Proc. amounts by the table's own
 * band rules. Every row of the 2025 table is checked in
 * test/eic-table.test.ts against test/fixtures/eic-table-2025.json.
 *
 * Band rules (derived from the published 2025 table):
 *  - Rows are $50 wide ([0, 50) is printed as "1-50"); the credit is figured
 *    at the row midpoint and rounded to whole dollars, half up.
 *  - Phase-in: credit rate x midpoint; the row that contains the earned
 *    income amount (and every row above it) gets the maximum credit.
 *  - Phase-out: only rows starting at or above the threshold phaseout amount
 *    are reduced: max credit - phaseout rate x (midpoint - threshold).
 *  - The row containing the completed phaseout amount is split there (the
 *    table footnotes): below it the credit uses the midpoint of
 *    [row start, completed amount); at or above it the credit is 0.
 */
import { max0, roundDiv } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { FilingStatus } from '../types.ts';

export function eicTableCredit(
  amount: number,
  status: FilingStatus,
  children: number,
  params: YearParams
): number {
  const col = params.eitc.byChildren[Math.max(0, Math.min(3, children))]!;
  const mfj = status === 'mfj';
  const threshold = mfj ? col.threshold.mfj : col.threshold.other;
  const completed = mfj ? col.completed.mfj : col.completed.other;
  const a = Math.floor(amount);
  if (a < 1 || a >= completed) return 0;
  const lo = Math.floor(a / 50) * 50;
  const hi = Math.min(lo + 50, completed);
  const mid2 = lo + hi; // twice the midpoint, so .5 midpoints stay exact
  const scale = 2_000_000; // ppm x 2
  let num =
    hi > col.earnedIncomeAmount ? col.maxCredit * scale : col.creditPpm * mid2;
  if (lo >= threshold) num -= col.phaseoutPpm * (mid2 - 2 * threshold);
  return max0(roundDiv(num, scale));
}

/** The worksheet's "is line 3 less than $X" test: below this AGI the AGI lookup is skipped. */
export function eicThreshold(
  status: FilingStatus,
  children: number,
  params: YearParams
): number {
  const col = params.eitc.byChildren[Math.max(0, Math.min(3, children))]!;
  return status === 'mfj' ? col.threshold.mfj : col.threshold.other;
}

export function eicCompleted(
  status: FilingStatus,
  children: number,
  params: YearParams
): number {
  const col = params.eitc.byChildren[Math.max(0, Math.min(3, children))]!;
  return status === 'mfj' ? col.completed.mfj : col.completed.other;
}
