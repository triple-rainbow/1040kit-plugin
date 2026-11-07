import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { getParams } from '../src/params/index.ts';
import { taxOnOrdinary } from '../src/tax/table.ts';
import type { OutOfScopeFlags, TaxFacts } from '../src/types.ts';
import { makeFacts, screeningNo, w2 } from './helpers.ts';

const p2026 = getParams(2026);
const screened: OutOfScopeFlags = {
  retirementDistributions: false,
  socialSecurityBenefits: false,
  stockOrCryptoSales: false,
  k1Income: false,
  foreignIncomeOrAccounts: false,
  unemploymentCompensation: false,
  hsa: false,
  educationExpenses: false,
  wantsToItemize: false,
  marriedFilingSeparately: false,
  other: [],
};
const f2026 = (patch: Partial<TaxFacts> = {}) =>
  makeFacts(
    {
      outOfScope: screened,
      screening: screeningNo,
      digitalAssetActivity: false,
      ...patch,
    },
    2026
  );

test('ty2026 standard deduction (Rev. Proc. 2025-32 §4.14)', () => {
  const sd = (f: TaxFacts) => computeReturn(f).nodes.standardDeduction?.value;
  assert.equal(sd(f2026({ w2s: [w2('w2_1', 5000000)] })), 16100);
  const mfj = f2026({
    filingStatus: 'mfj',
    spouse: { id: 'spouse', dateOfBirth: '1990-01-01' },
  });
  assert.equal(sd(mfj), 32200);
  assert.equal(sd(f2026({ filingStatus: 'hoh' })), 24150);
  // 65+ for 2026: born before January 2, 1962 (2026 draft Form 1040 line 12d); +2,050 unmarried
  const senior = f2026();
  senior.taxpayer.dateOfBirth = '1962-01-01';
  assert.equal(sd(senior), 18150);
  senior.taxpayer.dateOfBirth = '1962-01-02';
  assert.equal(sd(senior), 16100);
});

test('ty2026 brackets match Rev. Proc. 2025-32 Tables 1-3', () => {
  // Table 3 (single): over 105,700 -> 17,966 + 24% of the excess.
  assert.equal(
    taxOnOrdinary(150000, 'single', p2026),
    17966 + Math.round(0.24 * 44300)
  );
  // Table 1 (MFJ): over 403,550 -> 82,048 + 32% of the excess.
  assert.equal(taxOnOrdinary(500000, 'mfj', p2026), 82048 + 30864);
  // Table 2 (HoH): over 256,200 -> 56,631 + 35% of the excess.
  assert.equal(taxOnOrdinary(300000, 'hoh', p2026), 56631 + 15330);
  // top bracket base amounts
  assert.equal(
    taxOnOrdinary(800000, 'mfj', p2026),
    Math.round(206583.5 + 0.37 * 31300)
  );
});

test('ty2026 provisional params block completion', () => {
  assert.ok(p2026.provisional.length > 0);
  const r = computeReturn(f2026({ w2s: [w2('w2_1', 5000000, 500000)] }));
  assert.deepEqual(r.missing, []);
  const item = r.unsupported.find((u) => u.code === 'provisional_params');
  assert.ok(item);
  assert.equal(r.complete, false);
  // TY2025 has no provisional params
  assert.equal(getParams(2025).provisional.length, 0);
});

test('ty2026 line numbers: Schedule 1-A on 13a, QBI on 13b', () => {
  const r = computeReturn(
    f2026({
      w2s: [w2('w2_1', 5000000)],
      obbba: { qualifiedTips: { taxpayer: 100000 } },
    })
  );
  assert.equal(r.nodes.sch1aTotal?.line, '13a');
  assert.equal(r.nodes.qbiDeduction?.line, '13b');
  assert.equal(r.nodes.tipsDeduction?.line, '15');
});

test('ty2026 QBI minimum deduction ($400 with at least $1,000 of active QBI)', () => {
  // Tiny business, taxable income 0 -> the 20% limit is 0, the minimum gives 400.
  const f = f2026({
    nec1099s: [{ id: 'nec_1', owner: 'taxpayer', nonemployeeComp: 200000 }],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
  });
  const n = computeReturn(f).nodes;
  assert.equal(n.qbiIncomeLimit?.value, 0);
  assert.equal(n.qbiMinimum?.value, 400);
  assert.equal(n.qbiDeduction?.value, 400);
  assert.equal(n.taxableIncome?.value, 0);
});

test('ty2026 mileage uses 72.5 cents and the review warns about the July 1 change', async () => {
  const { reviewChecks } = await import('../src/rules/review.ts');
  const f = f2026({
    nec1099s: [{ id: 'nec_1', owner: 'taxpayer', nonemployeeComp: 3000000 }],
    businesses: [
      { owner: 'taxpayer', expenses: {}, vehicle: { businessMiles: 1000 } },
    ],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes['schC.expense.car_truck.taxpayer']?.value, 725);
  assert.ok(reviewChecks(f, r).some((x) => x.code === 'mileage_rate_midyear'));
});
