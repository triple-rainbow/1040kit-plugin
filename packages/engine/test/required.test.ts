import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { requiredFacts } from '../src/required.ts';
import {
  emptyFacts,
  type OutOfScopeFlags,
  type TaxFacts,
} from '../src/types.ts';
import { makeFacts, nec, screeningNo, w2 } from './helpers.ts';

/** All screening answers given as "no". */
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

const ready = (patch: Partial<TaxFacts> = {}) =>
  makeFacts({
    outOfScope: screened,
    screening: screeningNo,
    digitalAssetActivity: false,
    ...patch,
  });

const paths = (f: TaxFacts) => requiredFacts(f).map((m) => m.path);

test('required facts: empty facts ask filing status first, blocking', () => {
  const missing = requiredFacts(emptyFacts(2025));
  assert.equal(missing[0]!.path, 'filingStatus');
  assert.equal(missing[0]!.blocking, true);
});

test('required facts are sorted blocking first, then by priority', () => {
  const missing = requiredFacts(emptyFacts(2025));
  let seenNonBlocking = false;
  let lastPriority = -Infinity;
  for (const m of missing) {
    if (!m.blocking) seenNonBlocking = true;
    else
      assert.ok(
        !seenNonBlocking,
        `${m.path} blocking after a non-blocking item`
      );
    if (m.blocking === missing[0]!.blocking) {
      assert.ok(m.priority >= lastPriority);
      lastPriority = m.priority;
    }
  }
});

test('every question is plain English and at most 140 characters', () => {
  const f = emptyFacts(2025);
  f.filingStatus = 'mfj';
  f.spouse = { id: 'spouse' };
  f.dependents = [{ id: 'dependent_1' }];
  f.nec1099s = [nec('nec_1', 100000)];
  f.misc1099s = [{ id: 'misc_1', owner: 'taxpayer', rents: 1000 }];
  const missing = requiredFacts(f);
  assert.ok(missing.length > 15);
  for (const m of missing) {
    assert.ok(m.question.length <= 140, `${m.path}: ${m.question.length}`);
    assert.ok(m.question.endsWith('?'), m.path);
    assert.ok(m.why.length > 0, m.path);
    assert.doesNotMatch(m.question, /\{\{|\[|_/, m.path);
  }
});

test('MFJ with no spouse DOB asks for it, not blocking, mentions the senior deduction', () => {
  const f = ready({
    filingStatus: 'mfj',
    spouse: { id: 'spouse', hasValidSsn: true, canBeClaimedAsDependent: false },
    w2s: [w2('w2_1', 5000000)],
  });
  const m = requiredFacts(f).find((x) => x.path === 'spouse.dateOfBirth');
  assert.ok(m);
  assert.equal(m.blocking, false);
  assert.match(m.why, /senior/i);
});

test('a dependent missing dateOfBirth is blocking', () => {
  const f = ready({
    dependents: [
      {
        id: 'dependent_1',
        relationship: 'child',
        monthsLivedWithTaxpayer: 12,
        hasValidSsn: true,
      },
    ],
  });
  const m = requiredFacts(f).find(
    (x) => x.path === 'dependents[dependent_1].dateOfBirth'
  );
  assert.ok(m);
  assert.equal(m.blocking, true);
});

test('a 1099-NEC with no business asks for businesses[taxpayer], blocking', () => {
  const f = ready({ nec1099s: [nec('nec_1', 100000)] });
  const m = requiredFacts(f).find((x) => x.path === 'businesses[taxpayer]');
  assert.ok(m);
  assert.equal(m.blocking, true);
  const withBiz = ready({
    nec1099s: [nec('nec_1', 100000)],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
  });
  assert.ok(!paths(withBiz).includes('businesses[taxpayer]'));
});

test('screening questions for every OutOfScopeFlags key and digital assets while undefined', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 5000000)] });
  const missing = requiredFacts(f);
  const keys = [...Object.keys(screened), 'digitalAssetActivity'];
  for (const key of keys) {
    const path = key === 'digitalAssetActivity' ? key : `outOfScope.${key}`;
    const m = missing.find((x) => x.path === path);
    assert.ok(m, path);
    assert.equal(m.blocking, true, path);
    assert.ok(m.priority >= 100, `${path} asked after the core facts`);
  }
  const retirement = missing.find(
    (x) => x.path === 'outOfScope.retirementDistributions'
  );
  assert.match(retirement!.question, /1099-R/);
  // answered (false) -> no question
  assert.deepEqual(requiredFacts(ready({ w2s: [w2('w2_1', 5000000)] })), []);
});

test('screening questions come after core facts', () => {
  const missing = requiredFacts(emptyFacts(2025));
  const fs = missing.findIndex((m) => m.path === 'filingStatus');
  const screen = missing.findIndex((m) => m.path.startsWith('outOfScope.'));
  assert.ok(fs < screen);
});

test('a complete simple return has no missing facts and is complete', () => {
  const r = computeReturn(ready({ w2s: [w2('w2_1', 5000000, 500000)] }));
  assert.deepEqual(r.missing, []);
  assert.equal(r.complete, true);
});

test('missing blocking fact makes the return incomplete', () => {
  const r = computeReturn(makeFacts({ w2s: [w2('w2_1', 5000000)] }));
  assert.equal(r.complete, false);
  assert.ok(r.missing.length > 0);
});

test('HoH with no dependents asks about dependents', () => {
  const f = ready({ filingStatus: 'hoh' });
  assert.ok(paths(f).includes('dependents'));
});

test('dependent under 17 needs SSN answer; taxpayer SSN validity asked when it matters', () => {
  const f = ready({
    dependents: [
      {
        id: 'dependent_1',
        dateOfBirth: '2015-01-01',
        relationship: 'child',
        monthsLivedWithTaxpayer: 12,
      },
    ],
  });
  assert.ok(paths(f).includes('dependents[dependent_1].hasValidSsn'));
  const g = ready({
    dependents: [
      {
        id: 'dependent_1',
        dateOfBirth: '2015-01-01',
        relationship: 'child',
        monthsLivedWithTaxpayer: 12,
        hasValidSsn: true,
      },
    ],
  });
  delete g.taxpayer.hasValidSsn;
  assert.ok(paths(g).includes('taxpayer.hasValidSsn'));
});

test('rental/royalty and student loan screening questions replace the old out-of-scope flags', () => {
  const missing = requiredFacts(makeFacts());
  const byPath = new Map(missing.map((m) => [m.path, m]));
  for (const p of [
    'screening.hasRentalOrRoyaltyIncome',
    'screening.paidStudentLoanInterest',
  ]) {
    const m = byPath.get(p);
    assert.ok(m, p);
    assert.equal(m.blocking, true);
    assert.ok(m.priority >= 100, `${p} is in the screening band`);
  }
  assert.ok(!byPath.has('outOfScope.rentalIncome'));
  assert.ok(!byPath.has('outOfScope.studentLoanInterest'));
  assert.ok(!paths(ready()).some((p) => p.startsWith('screening.')));
});

test('Schedule C header items and line 30(a) are asked for each business', () => {
  const facts = (biz: Partial<TaxFacts['businesses'][number]> = {}) =>
    makeFacts({
      filingStatus: 'single',
      nec1099s: [nec('nec_1', 3000000)],
      businesses: [{ owner: 'taxpayer', name: 'Design', expenses: {}, ...biz }],
    });
  const paths = (f: TaxFacts) =>
    requiredFacts(f)
      .filter((m) => m.path.startsWith('businesses[taxpayer].'))
      .map((m) => [m.path.slice('businesses[taxpayer].'.length), m.blocking]);
  assert.deepEqual(paths(facts()), [
    ['materiallyParticipated', true],
    ['principalBusinessCode', true],
    ['accountingMethod', true],
    ['startedOrAcquiredThisYear', true],
    ['operatedFromHome', true],
    ['madePaymentsRequiring1099', true],
  ]);
  const answered = {
    materiallyParticipated: true,
    principalBusinessCode: '541430',
    accountingMethod: 'cash' as const,
    startedOrAcquiredThisYear: false,
    operatedFromHome: true,
    madePaymentsRequiring1099: false,
  };
  assert.deepEqual(paths(facts(answered)), []);
  // Follow-ups: line J after an "I: Yes", the method after "Other", 30(a).
  assert.deepEqual(
    paths(
      facts({
        ...answered,
        accountingMethod: 'other',
        madePaymentsRequiring1099: true,
        homeOffice: { method: 'simplified', squareFeet: 150 },
      })
    ),
    [
      ['accountingMethodOther', true],
      ['filedRequired1099s', true],
      ['homeOffice.homeSquareFeet', true],
    ]
  );
});

test('Schedule C Part IV is asked when car expenses are claimed; line 32 with a loss', () => {
  const answered = {
    materiallyParticipated: true,
    principalBusinessCode: '541430',
    accountingMethod: 'cash' as const,
    startedOrAcquiredThisYear: false,
    operatedFromHome: true,
    madePaymentsRequiring1099: false,
  };
  const facts = (
    biz: Partial<TaxFacts['businesses'][number]>,
    income = 3000000
  ) =>
    makeFacts({
      filingStatus: 'single',
      nec1099s: [nec('nec_1', income)],
      businesses: [
        {
          owner: 'taxpayer',
          name: 'Design',
          expenses: {},
          ...answered,
          ...biz,
        },
      ],
    });
  const paths = (f: TaxFacts) =>
    requiredFacts(f)
      .filter((m) => m.path.startsWith('businesses[taxpayer].'))
      .map((m) => m.path.slice('businesses[taxpayer].'.length));
  // Standard mileage: business miles come from vehicle.businessMiles.
  assert.deepEqual(paths(facts({ vehicle: { businessMiles: 3000 } })), [
    'vehicleUse.placedInService',
    'vehicleUse.commutingMiles',
    'vehicleUse.otherMiles',
    'vehicleUse.availableOffDuty',
    'vehicleUse.anotherVehicle',
    'vehicleUse.hasEvidence',
  ]);
  // Actual expenses also ask the business miles; 47b only after a 47a yes.
  const actual = paths(
    facts({
      expenses: { car_truck: 120000 },
      vehicleUse: { hasEvidence: true },
    })
  );
  assert.ok(actual.includes('vehicleUse.businessMiles'));
  assert.ok(actual.includes('vehicleUse.evidenceWritten'));
  assert.deepEqual(paths(facts({})), []);
  // A loss asks line 32; "No" is out of scope (Form 6198).
  const loss = facts({ expenses: { supplies: 5000000 } });
  assert.deepEqual(paths(loss), ['allInvestmentAtRisk']);
  const notAtRisk = computeReturn(
    facts({ expenses: { supplies: 5000000 }, allInvestmentAtRisk: false })
  );
  assert.ok(notAtRisk.unsupported.some((u) => u.code === 'schedule_c_at_risk'));
});

test('on a joint return with two businesses, each question names its business', () => {
  const facts = makeFacts({
    filingStatus: 'mfj',
    spouse: { id: 'spouse' },
    nec1099s: [nec('nec_1', 3000000), nec('nec_2', 2000000, 'spouse')],
    businesses: [
      { owner: 'taxpayer', name: 'Design Studio', expenses: {} },
      { owner: 'spouse', expenses: {} },
    ],
  });
  const asked = requiredFacts(facts).filter((m) =>
    m.path.startsWith('businesses[')
  );
  const byField = new Map<string, string[]>();
  for (const m of asked) {
    const field = m.path.slice(m.path.indexOf('].') + 2);
    byField.set(field, [...(byField.get(field) ?? []), m.question]);
  }
  for (const [field, qs] of byField) {
    assert.equal(qs.length, 2, field);
    assert.notEqual(qs[0], qs[1], `${field} reads the same for both`);
  }
  assert.ok(
    byField.get('principalBusinessCode')![0]!.includes('Design Studio')
  );
  assert.match(
    byField.get('materiallyParticipated')![0]!,
    /with your spouse’s work/
  );
});
