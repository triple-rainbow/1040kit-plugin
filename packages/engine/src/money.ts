/**
 * Money helpers. Facts are integer cents; lines are integer dollars.
 *
 * Rounding rule (i1040gi, "Rounding Off to Whole Dollars"): drop amounts under
 * 50 cents and increase amounts from 50 to 99 cents to the next dollar. When
 * several amounts are added for one line, include cents when adding and round
 * only the total.
 *
 * Rates are integers in parts per million (ppm) so multiplications stay exact:
 * 12.4% = 124_000 ppm.
 */

/** Integer division rounded half away from zero. `d` must be positive. */
export function roundDiv(n: number, d: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0) {
    throw new Error(`roundDiv needs integers and d > 0 (got ${n}/${d})`);
  }
  const sign = n < 0 ? -1 : 1;
  const a = Math.abs(n);
  const q = Math.floor(a / d);
  const r = a - q * d;
  const out = sign * (r * 2 >= d ? q + 1 : q);
  return out === 0 ? 0 : out; // never -0
}

/** Sum integer cents, treating undefined as 0. */
export function sumCents(
  values: readonly (number | undefined | null)[]
): number {
  let total = 0;
  for (const v of values) {
    if (v === undefined || v === null) continue;
    if (!Number.isInteger(v))
      throw new Error(`cents must be integers (got ${v})`);
    total += v;
  }
  return total;
}

/** Cents -> whole dollars, half up. */
export function toDollars(cents: number): number {
  return roundDiv(Math.round(cents), 100);
}

/** Percent -> ppm, e.g. pct(92.35) = 923_500. */
export function pct(percent: number): number {
  return Math.round(percent * 10_000);
}

/** amount x rate, rounded half up to an integer in the same unit as `amount`. */
export function mulRate(amount: number, ratePpm: number): number {
  return roundDiv(Math.round(amount) * ratePpm, 1_000_000);
}

/** cents x rate -> whole dollars, rounded once. */
export function centsTimesRateToDollars(
  cents: number,
  ratePpm: number
): number {
  return roundDiv(Math.round(cents) * ratePpm, 100_000_000);
}

export const max0 = (n: number): number => (n > 0 ? n : 0);
