import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mulRate, pct, roundDiv, sumCents, toDollars } from '../src/money.ts';

test('toDollars rounds half up (i1040gi "Rounding Off to Whole Dollars")', () => {
  assert.equal(toDollars(100049), 1000);
  assert.equal(toDollars(100050), 1001);
  assert.equal(toDollars(0), 0);
  // losses round symmetrically: -$1.50 -> -$2
  assert.equal(toDollars(-150), -2);
  assert.equal(toDollars(-149), -1);
});

test('sumCents ignores undefined', () => {
  assert.equal(sumCents([100, undefined, 250]), 350);
  assert.equal(sumCents([]), 0);
});

test('adds cents before rounding: two $1,000.40 amounts make $2,001', () => {
  assert.equal(toDollars(sumCents([100040, 100040])), 2001);
  // rounding each first would give 2,000
  assert.equal(toDollars(100040) + toDollars(100040), 2000);
});

test('mulRate is exact integer math', () => {
  // 46,175 x 2.9% = 1,339.075 -> 1,339
  assert.equal(mulRate(46175, pct(2.9)), 1339);
  // 46,175 x 12.4% = 5,725.70 -> 5,726
  assert.equal(mulRate(46175, pct(12.4)), 5726);
  // 50,000 x 92.35% = 46,175
  assert.equal(mulRate(50000, pct(92.35)), 46175);
  // half up at exactly .5
  assert.equal(mulRate(7065, pct(50)), 3533);
});

test('roundDiv', () => {
  assert.equal(roundDiv(5, 2), 3);
  assert.equal(roundDiv(-5, 2), -3);
  assert.equal(roundDiv(4, 2), 2);
});
