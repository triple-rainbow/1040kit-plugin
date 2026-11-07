import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { reviewChecks } from '../src/rules/review.ts';
import type { PriorYearSummary, TaxFacts } from '../src/types.ts';
import { k1099, makeFacts, w2 } from './helpers.ts';

const codes = (f: TaxFacts, prior?: PriorYearSummary) =>
  reviewChecks(f, computeReturn(f), prior).map((x) => x.code);

test('clean W-2 return has no findings', () => {
  assert.deepEqual(
    codes(makeFacts({ w2s: [w2('w2_1', 5000000, 500000)] })),
    []
  );
});

test('review flags SS tax mismatch', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 5000000, 500000, 'taxpayer', { ssTax: 250000 })],
  });
  const findings = reviewChecks(f, computeReturn(f));
  const m = findings.find((x) => x.code === 'ss_tax_mismatch');
  assert.ok(m);
  assert.equal(m.severity, 'warning');
  // within $1 is fine
  const ok = makeFacts({
    w2s: [w2('w2_1', 5000000, 500000, 'taxpayer', { ssTax: 310050 })],
  });
  assert.ok(!codes(ok).includes('ss_tax_mismatch'));
});

test('review flags big swing vs prior year', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 5000000, 500000)] });
  const r = computeReturn(f);
  const prior: PriorYearSummary = {
    taxYear: 2024,
    refundOrOwed: r.summary.refundOrOwed * 3,
  };
  assert.ok(codes(f, prior).includes('refund_swing_vs_prior_year'));
  const close: PriorYearSummary = {
    taxYear: 2024,
    refundOrOwed: r.summary.refundOrOwed + 50,
  };
  assert.ok(!codes(f, close).includes('refund_swing_vs_prior_year'));
});

test('withholding greater than wages is an error', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 100000, 200000)] });
  const x = reviewChecks(f, computeReturn(f)).find(
    (y) => y.code === 'withholding_exceeds_wages'
  );
  assert.equal(x?.severity, 'error');
});

test('box 3 and box 5 mismatch is noted', () => {
  const f = makeFacts({
    w2s: [
      w2('w2_1', 5000000, 0, 'taxpayer', { ssWages: 4000000, ssTax: 248000 }),
    ],
  });
  assert.ok(codes(f).includes('ss_wages_vs_medicare_wages'));
});

test('1099-K without a Schedule C business is an error', () => {
  const f = makeFacts({
    k1099s: [k1099('k_1', 500000, { personalPortion: 0 })],
  });
  assert.ok(codes(f).includes('1099_income_without_schedule_c'));
});

test('corrected W-2 next to the original from the same employer', () => {
  const f = makeFacts({
    w2s: [
      w2('w2_1', 5000000, 0, 'taxpayer', { employerEinToken: '{{EIN:acme}}' }),
      w2('w2_2', 5100000, 0, 'taxpayer', {
        employerEinToken: '{{EIN:acme}}',
        corrected: true,
      }),
    ],
  });
  assert.ok(codes(f).includes('corrected_w2_with_original'));
});

test('dependent older than 24 claimed as a child is flagged', () => {
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [
      {
        id: 'dependent_1',
        dateOfBirth: '1998-01-01',
        relationship: 'child',
        monthsLivedWithTaxpayer: 12,
        hasValidSsn: true,
        grossIncome: 0,
      },
    ],
    w2s: [w2('w2_1', 5000000)],
  });
  assert.ok(codes(f).includes('dependent_over_24'));
});

test('car loan on a non-US-assembled vehicle is noted, not an error', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 5000000)],
    obbba: {
      carLoanInterest: 200000,
      carLoanVehicle: {
        newVehicle: true,
        finalAssemblyInUS: false,
        personalUse: true,
      },
    },
  });
  const x = reviewChecks(f, computeReturn(f)).find(
    (y) => y.code === 'car_loan_not_eligible'
  );
  assert.equal(x?.severity, 'info');
});

test('review: home office larger than the home, land over basis, months out of range', () => {
  const f = makeFacts({
    businesses: [
      {
        owner: 'taxpayer',
        expenses: {},
        homeOffice: {
          method: 'actual',
          officeSquareFeet: 3000,
          homeSquareFeet: 2000,
          ownership: 'own',
          monthsUsed: 14,
          home: {
            basisOrValue: 100000,
            landValue: 200000,
            businessUseStart: '2027-01-01',
          },
        },
      },
    ],
  });
  const c = codes(f);
  for (const k of [
    'office_larger_than_home',
    'land_over_basis',
    'home_office_months',
    'business_use_after_year',
  ])
    assert.ok(c.includes(k), k);
});

test('review: rental with no rent, misc linked twice or also business, misc rents not on the return', () => {
  const f = makeFacts({
    misc1099s: [
      { id: 'misc_1', owner: 'taxpayer', rents: 100000, treatAsBusiness: true },
      {
        id: 'misc_2',
        owner: 'taxpayer',
        rents: 100000,
        treatAsBusiness: false,
      },
      {
        id: 'misc_3',
        owner: 'taxpayer',
        royalties: 100000,
        treatAsBusiness: false,
      },
    ],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
    rentals: [
      {
        id: 'rental_1',
        owner: 'taxpayer',
        propertyType: 1,
        fairRentalDays: 365,
        misc1099Ids: ['misc_1', 'misc_2'],
        expenses: {},
      },
      {
        id: 'rental_2',
        owner: 'taxpayer',
        propertyType: 1,
        fairRentalDays: 365,
        misc1099Ids: ['misc_2'],
        expenses: { repairs: 10000 },
      },
    ],
  });
  const c = codes(f);
  for (const k of [
    'misc_business_and_rental',
    'misc_linked_twice',
    'misc_rents_not_on_return',
    'rental_not_qbi',
  ])
    assert.ok(c.includes(k), k);
  const empty = makeFacts({
    rentals: [
      {
        id: 'rental_1',
        owner: 'taxpayer',
        propertyType: 1,
        fairRentalDays: 365,
        expenses: { repairs: 10000 },
      },
    ],
  });
  assert.ok(codes(empty).includes('rental_without_income'));
});

test('review: 1098-E box 2 and interest over the $2,500 cap', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 5000000)],
    e1098s: [
      { id: 'e1098_1', owner: 'taxpayer', interest: 300000, box2Checked: true },
    ],
    studentLoan: { legallyObligated: true, qualifiedLoan: true },
  });
  const c = codes(f);
  assert.ok(c.includes('1098e_box2'));
  assert.ok(c.includes('student_loan_interest_cap'));
});
