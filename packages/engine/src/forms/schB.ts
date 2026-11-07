/**
 * Schedule B (Interest and Ordinary Dividends). The totals flow to Form 1040
 * lines 2b and 3b (nodes taxableInterest, ordinaryDividends); this module only
 * decides whether the schedule is required.
 *
 * i1040sb, "Who Must File": taxable interest or ordinary dividends over $1,500.
 * Compared in cents so $1,500.01 requires it and $1,500.00 does not.
 */
import { ownedOnReturn } from '../facts.ts';
import { sumCents } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { TaxFacts } from '../types.ts';

export function needsScheduleB(facts: TaxFacts, params: YearParams): boolean {
  const interest = sumCents(
    ownedOnReturn(facts, facts.int1099s).flatMap((i) => [
      i.interest,
      i.usSavingsBondInterest,
    ])
  );
  const dividends = sumCents(
    ownedOnReturn(facts, facts.div1099s).map((d) => d.ordinaryDividends)
  );
  return (
    interest > params.schBThresholdCents ||
    dividends > params.schBThresholdCents
  );
}
