import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { findDeductions } from '../src/rules/deductions.ts';
import type { TaxFacts } from '../src/types.ts';
import { k1099, makeFacts, nec, w2 } from './helpers.ts';

const find = (f: TaxFacts) => findDeductions(f, computeReturn(f));

const freelancer = () =>
  makeFacts({
    nec1099s: [nec('nec_1', 8000000)],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
  });

test('deductions ranked by savings, nulls last', () => {
  const list = find(freelancer());
  assert.ok(list.length > 5);
  let seenNull = false;
  let last = Infinity;
  for (const d of list) {
    if (d.estimatedSavings === null) {
      seenNull = true;
      continue;
    }
    assert.ok(!seenNull, `${d.id} has a number after a null`);
    assert.ok(d.estimatedSavings <= last, `${d.id} out of order`);
    last = d.estimatedSavings;
  }
  const sep = list.find((d) => d.id === 'sep_ira');
  assert.ok(sep && sep.estimatedSavings !== null && sep.estimatedSavings > 0);
  assert.equal(sep.status, 'possible');
  const home = list.find((d) => d.id === 'home_office');
  assert.ok(home && home.estimatedSavings! > 0);
});

test('every opportunity states eligibility, a question, citations and fact paths', () => {
  const f = freelancer();
  f.w2s = [w2('w2_1', 3000000, 0, 'taxpayer', { ssTips: 200000 })];
  f.k1099s = [k1099('k_1', 100000)];
  f.hints = { mortgageInterest: 1500000, stateLocalTaxes: 800000 };
  for (const d of find(f)) {
    assert.ok(d.eligibility.length > 20, d.id);
    assert.ok(d.question.endsWith('?'), d.id);
    assert.ok(d.citations.length > 0, d.id);
    assert.ok(Array.isArray(d.factPaths), d.id);
    if (d.status !== 'flag_only' && d.id !== 'qbi')
      assert.ok(d.factPaths!.length > 0, d.id);
  }
});

test('schedule C rules carry their category, verified against i1040sc', () => {
  const list = find(freelancer());
  const cat = (id: string) => list.find((d) => d.id === id)?.scheduleCCategory;
  assert.equal(cat('phone_internet'), 'utilities'); // i1040sc line 25
  assert.equal(cat('mileage'), 'car_truck'); // line 9
  assert.equal(cat('software_subscriptions'), 'other'); // Part V: "Technology and software tools"
  assert.equal(cat('equipment_de_minimis'), 'other'); // Part V: de minimis safe harbor, "only ... as other expenses"
  const phone = list.find((d) => d.id === 'phone_internet');
  assert.deepEqual(phone?.factPaths, [
    'businesses[<owner>].expenses.utilities',
  ]);
});

test('claimed deduction not re-proposed', () => {
  const f = freelancer();
  f.businesses[0]!.homeOffice = { method: 'simplified', squareFeet: 150 };
  f.adjustments = { sepContributions: { taxpayer: 500000 } };
  const list = find(f);
  assert.equal(list.find((d) => d.id === 'home_office')?.status, 'claimed');
  assert.equal(list.find((d) => d.id === 'sep_ira')?.status, 'claimed');
  assert.equal(list.find((d) => d.id === 'qbi')?.status, 'claimed');
});

test('tips estimate uses W-2 box 7 and a recompute', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 4000000, 0, 'taxpayer', { ssTips: 800000 })],
  });
  const tips = find(f).find((d) => d.id === 'tips');
  assert.ok(tips);
  assert.equal(tips.status, 'possible');
  assert.ok(tips.estimatedSavings! > 0);
  assert.deepEqual(tips.factPaths, ['obbba.qualifiedTips.<owner>']);
});

test('itemize flag only when a hint fact exists', () => {
  const none = find(makeFacts({ w2s: [w2('w2_1', 9000000)] }));
  assert.ok(!none.some((d) => d.id === 'itemize_flag'));
  const small = find(
    makeFacts({
      w2s: [w2('w2_1', 9000000)],
      hints: { mortgageInterest: 500000 },
    })
  );
  assert.ok(!small.some((d) => d.id === 'itemize_flag'));
  const big = find(
    makeFacts({
      w2s: [w2('w2_1', 9000000)],
      hints: { mortgageInterest: 1200000, stateLocalTaxes: 900000 },
    })
  );
  const flag = big.find((d) => d.id === 'itemize_flag');
  assert.ok(flag);
  assert.equal(flag.status, 'flag_only');
  assert.equal(flag.estimatedSavings, null);
});

test('1099-K reconciliation proposed when the personal portion is unknown', () => {
  const f = freelancer();
  f.k1099s = [k1099('k_1', 300000)];
  const d = find(f).find((x) => x.id === '1099k_reconciliation');
  assert.ok(d);
  assert.deepEqual(d.factPaths, ['k1099s[<id>].personalPortion']);
});

test('senior deduction estimated when DOB is unknown', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 5000000)] });
  delete f.taxpayer.dateOfBirth;
  const d = find(f).find((x) => x.id === 'senior');
  assert.ok(d);
  assert.ok(d.estimatedSavings! > 0);
});

test('eitc opportunity replaces eitc_flag: claimed, with the fact paths it needs', () => {
  const f = makeFacts({
    filingStatus: 'hoh',
    w2s: [w2('w2_1', 2000000)],
    dependents: [
      {
        id: 'dependent_1',
        dateOfBirth: '2018-01-01',
        relationship: 'child',
        monthsLivedWithTaxpayer: 12,
        hasValidSsn: true,
      },
    ],
  });
  const list = find(f);
  assert.ok(!list.some((d) => d.id === 'eitc_flag'));
  const e = list.find((d) => d.id === 'eitc');
  assert.ok(e);
  assert.equal(e.status, 'claimed');
  assert.ok(e.factPaths!.includes('taxpayer.livedInUsOverHalfYear'));
  assert.ok(e.factPaths!.includes('eitc.priorDisallowance'));
  assert.ok(
    !find(makeFacts({ w2s: [w2('w2_1', 9000000)] })).some(
      (d) => d.id === 'eitc'
    )
  );
});

test('student loan interest: estimated by recompute when the loan answers block it', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 6000000)],
    e1098s: [{ id: 'e1098_1', owner: 'taxpayer', interest: 200000 }],
    studentLoan: { legallyObligated: false },
  });
  const d = find(f).find((x) => x.id === 'student_loan_interest');
  assert.ok(d);
  assert.equal(d.status, 'possible');
  assert.equal(d.estimatedSavings, 240); // 2,000 x 12% bracket
  f.studentLoan = { legallyObligated: true, qualifiedLoan: true };
  assert.equal(
    find(f).find((x) => x.id === 'student_loan_interest')?.status,
    'claimed'
  );
});

test('home_office_actual compares Form 8829 with the simplified method by recompute', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 8000000)],
    businesses: [
      {
        owner: 'taxpayer',
        expenses: {},
        homeOffice: {
          method: 'actual',
          officeSquareFeet: 100,
          homeSquareFeet: 2000,
          ownership: 'rent',
          indirect: { rent: 1200000 },
        },
      },
    ],
  });
  const d = find(f).find((x) => x.id === 'home_office_actual');
  assert.ok(d);
  assert.equal(d.status, 'claimed');
  // Actual: 5% x 12,000 = 600; simplified: 100 sq ft x $5 = 500 -> switching saves nothing.
  assert.equal(d.estimatedSavings, 0);
  assert.ok(
    d.factPaths!.every((p) => p.startsWith('businesses[<owner>].homeOffice'))
  );
});
