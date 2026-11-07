import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { checkScope } from '../src/scope.ts';
import type { Business, TaxFacts } from '../src/types.ts';
import { k1099, makeFacts, nec, w2 } from './helpers.ts';

const biz = (extra: Partial<Business> = {}): Business => ({
  owner: 'taxpayer',
  expenses: {},
  ...extra,
});
const v = (f: TaxFacts, id: string) => {
  const n = computeReturn(f).nodes[id];
  assert.ok(n, `node ${id}`);
  return n.value;
};

test('se tax basic: NEC 50,000 -> SE tax 7,065, deduction 3,533', () => {
  // Schedule SE 2025: 4a 50,000 x 92.35% = 46,175; 10: 46,175 x 12.4% = 5,725.70 -> 5,726;
  // 11: 46,175 x 2.9% = 1,339.08 -> 1,339; 12 = 7,065; 13 = 7,065 x 50% = 3,532.50 -> 3,533.
  const f = makeFacts({
    nec1099s: [nec('nec_1', 5000000)],
    businesses: [biz()],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes['schC.netProfit.taxpayer']?.value, 50000);
  assert.equal(r.nodes['schC.netProfit.taxpayer']?.form, 'schC.taxpayer');
  assert.equal(r.nodes['schC.netProfit.taxpayer']?.line, '31');
  assert.equal(r.nodes['se.netEarnings.taxpayer']?.value, 46175);
  assert.equal(r.nodes['seTax.taxpayer']?.value, 7065);
  assert.equal(r.nodes['seDeduction.taxpayer']?.value, 3533);
  assert.equal(r.nodes.seDeduction?.value, 3533);
  assert.equal(r.nodes.seDeduction?.line, '15');
  assert.equal(r.nodes.businessIncome?.value, 50000);
  assert.equal(r.nodes.otherTaxes?.value, 7065);
  assert.equal(r.nodes.agi?.value, 50000 - 3533);
  for (const form of [
    'sch1',
    'sch2',
    'schC.taxpayer',
    'schSE.taxpayer',
    'f8995',
  ] as const) {
    assert.ok(r.forms.includes(form), form);
  }
});

test('se tax respects wage base: W-2 SS wages 170,000 + NEC 20,000', () => {
  // 4a: 20,000 x 92.35% = 18,470; line 9: 176,100 - 170,000 = 6,100;
  // 10: min(18,470, 6,100) x 12.4% = 756.40 -> 756; 11: 18,470 x 2.9% = 535.63 -> 536.
  const f = makeFacts({
    w2s: [w2('w2_1', 17000000, 3000000)],
    nec1099s: [nec('nec_1', 2000000)],
    businesses: [biz()],
  });
  assert.equal(v(f, 'se.ssWagesAndTips.taxpayer'), 170000);
  assert.equal(v(f, 'se.ssPortion.taxpayer'), 756);
  assert.equal(v(f, 'se.medicarePortion.taxpayer'), 536);
  assert.equal(v(f, 'seTax.taxpayer'), 1292);
});

test('no SE tax under 400: NEC 400 -> earnings 369 -> 0', () => {
  const f = makeFacts({ nec1099s: [nec('nec_1', 40000)], businesses: [biz()] });
  const r = computeReturn(f);
  assert.equal(r.nodes['se.netEarnings.taxpayer']?.value, 369);
  assert.equal(r.nodes['seTax.taxpayer']?.value, 0);
  assert.ok(!r.forms.includes('schSE.taxpayer'));
});

test('1099-K personal portion excluded: K 10,000, personal 2,000 -> receipts 8,000', () => {
  const f = makeFacts({
    k1099s: [k1099('k_1', 1000000, { personalPortion: 200000 })],
    businesses: [biz()],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes['schC.grossReceipts.taxpayer']?.value, 8000);
  // 2025: the personal amount goes in the entry space at the top of Schedule 1, not in income
  assert.equal(r.nodes.form1099KPersonalPortion?.value, 2000);
  assert.equal(r.nodes.totalIncome?.value, 8000);
});

test('simplified home office capped at 300 sq ft: 400 sq ft -> 1,500', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 3000000)],
    businesses: [
      biz({ homeOffice: { method: 'simplified', squareFeet: 400 } }),
    ],
  });
  assert.equal(v(f, 'schC.homeOffice.taxpayer'), 1500);
});

test('simplified home office limited to tentative profit', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 100000)],
    businesses: [
      biz({
        expenses: { supplies: 50000 },
        homeOffice: { method: 'simplified', squareFeet: 300 },
      }),
    ],
  });
  assert.equal(v(f, 'schC.tentativeProfit.taxpayer'), 500);
  assert.equal(v(f, 'schC.homeOffice.taxpayer'), 500);
  assert.equal(v(f, 'schC.netProfit.taxpayer'), 0);
});

test('meals at 50%, standard mileage replaces car expenses', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 3000000)],
    businesses: [
      biz({
        expenses: { meals: 40001, car_truck: 999900 },
        vehicle: { businessMiles: 1000 },
      }),
    ],
  });
  assert.equal(v(f, 'schC.expense.meals.taxpayer'), 200); // 200.005 -> 200
  assert.equal(v(f, 'schC.expense.car_truck.taxpayer'), 700); // 1,000 mi x 70 cents (2025)
});

test('qbi limited by taxable income', () => {
  // Single, NEC 30,000. SE tax 4,239, deduction 2,120. AGI 27,880.
  // 8995 line 11: 27,880 - 15,750 = 12,130 -> limit 20% = 2,426.
  // QBI 30,000 - 2,120 = 27,880 x 20% = 5,576 > 2,426 -> deduction = 2,426.
  const f = makeFacts({
    nec1099s: [nec('nec_1', 3000000)],
    businesses: [biz()],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes.qbiComponent?.value, 5576);
  assert.equal(r.nodes.qbiIncomeLimit?.value, 2426);
  assert.equal(r.nodes.qbiDeduction?.value, 2426);
  assert.equal(r.nodes.qbiDeduction?.line, '13a');
});

test('SEP limited to 20% of net earnings less the SE deduction; SEHI limited by profit', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 1000000)],
    businesses: [biz()],
    adjustments: {
      sepContributions: { taxpayer: 1000000 },
      selfEmployedHealthInsurance: { taxpayer: 1000000 },
    },
  });
  // net 10,000; SE: 9,235 -> 1,145 + 268 = 1,413; ded 707 (706.5 half up)
  // SEP max = 20% x (10,000 - 707) = 1,858.6 -> 1,859
  // SEHI max = 10,000 - 707 - 1,859 = 7,434
  assert.equal(v(f, 'seDeduction'), 707);
  assert.equal(v(f, 'sepDeduction'), 1859);
  assert.equal(v(f, 'sehiDeduction'), 7434);
});

test('1099-MISC box 3 not business is other income on Schedule 1 line 8z', () => {
  const f = makeFacts({
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer',
        otherIncome: 75050,
        treatAsBusiness: false,
      },
    ],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes.otherIncome?.value, 751);
  assert.equal(r.nodes.otherIncome?.line, '8z');
  assert.equal(r.nodes.additionalIncome?.value, 751);
  assert.equal(r.nodes['seTax.taxpayer'], undefined);
});

test('1099-MISC treated as business goes to Schedule C', () => {
  const f = makeFacts({
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer',
        otherIncome: 500000,
        rents: 100000,
        treatAsBusiness: true,
      },
    ],
    businesses: [biz()],
  });
  assert.equal(v(f, 'schC.grossReceipts.taxpayer'), 6000);
  assert.equal(v(f, 'otherIncome'), 0);
});

test('early withdrawal penalty is a Schedule 1 adjustment', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 5000000)],
    int1099s: [
      {
        id: 'int_1',
        owner: 'taxpayer',
        interest: 20000,
        earlyWithdrawalPenalty: 5000,
      },
    ],
  });
  assert.equal(v(f, 'earlyWithdrawalPenalty'), 50);
  assert.equal(v(f, 'agi'), 50000 + 200 - 50);
});

test('scope: taxable income above the 8995 threshold with QBI -> form_8995a', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 30000000)],
    businesses: [biz()],
  });
  assert.ok(checkScope(f).some((u) => u.code === 'form_8995a'));
});

test('spouse business is ignored on a single return', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 1000000, 'spouse')],
    businesses: [{ owner: 'spouse', expenses: {} }],
  });
  assert.equal(v(f, 'businessIncome'), 0);
});
