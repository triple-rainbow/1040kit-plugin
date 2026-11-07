/**
 * Qualified Dividends and Capital Gain Tax Worksheet — Line 16 (i1040gi).
 * Used when Form 1040 line 3a (qualified dividends) or line 7a (capital gain
 * distributions, no Schedule D) is more than zero.
 */
import { max0, roundDiv } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { Dollars, FilingStatus } from '../types.ts';
import { taxOnOrdinary } from './table.ts';

export interface QdcgResult {
  tax: Dollars;
  lines: Record<string, number>;
}

export function taxWithQdcg(
  taxableIncome: Dollars,
  qualifiedDividends: Dollars,
  capitalGainDistributions: Dollars,
  status: FilingStatus,
  params: YearParams
): QdcgResult {
  const t = params.qdcgThresholds[status];
  const l1 = max0(taxableIncome);
  const l2 = max0(qualifiedDividends);
  const l3 = max0(capitalGainDistributions); // "No" to Schedule D: line 7a
  const l4 = l2 + l3;
  const l5 = max0(l1 - l4);
  const l6 = t.zeroMax;
  const l7 = Math.min(l1, l6);
  const l8 = Math.min(l5, l7);
  const l9 = l7 - l8; // taxed at 0%
  const l10 = Math.min(l1, l4);
  const l11 = l9;
  const l12 = l10 - l11;
  const l13 = t.fifteenMax;
  const l14 = Math.min(l1, l13);
  const l15 = l5 + l9;
  const l16 = max0(l14 - l15);
  const l17 = Math.min(l12, l16);
  const l18Cents = l17 * 15; // 15% of whole dollars, in cents
  const l19 = l9 + l17;
  const l20 = l10 - l19;
  const l21Cents = l20 * 20; // 20%, in cents
  const l22 = taxOnOrdinary(l5, status, params);
  // Round only the total of lines 18, 21 and 22 (i1040gi rounding rule).
  const l23 = roundDiv(l18Cents + l21Cents + l22 * 100, 100);
  const l24 = taxOnOrdinary(l1, status, params);
  const l25 = Math.min(l23, l24);
  return {
    tax: l25,
    lines: {
      l1,
      l2,
      l3,
      l4,
      l5,
      l6,
      l7,
      l8,
      l9,
      l10,
      l11,
      l12,
      l13,
      l14,
      l15,
      l16,
      l17,
      l18: l18Cents / 100,
      l19,
      l20,
      l21: l21Cents / 100,
      l22,
      l23,
      l24,
      l25,
    },
  };
}
