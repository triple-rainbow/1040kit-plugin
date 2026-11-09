import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { requiredFacts } from '../src/required.ts';
import { checkScope } from '../src/scope.ts';
import type { OutOfScopeFlags, TaxFacts } from '../src/types.ts';
import { div1099, int1099, makeFacts, nec, w2 } from './helpers.ts';

const codes = (f: TaxFacts) => checkScope(f).map((u) => u.code);

test('simple W-2 return is in scope', () => {
  assert.deepEqual(checkScope(makeFacts({ w2s: [w2('w2_1', 5000000)] })), []);
});

test('scope flags: every OutOfScopeFlags key maps to an UnsupportedItem', () => {
  const expected: Record<Exclude<keyof OutOfScopeFlags, 'other'>, string> = {
    retirementDistributions: 'retirement_distributions',
    socialSecurityBenefits: 'social_security_benefits',
    stockOrCryptoSales: 'stock_or_crypto_sales',
    k1Income: 'k1_income',
    foreignIncomeOrAccounts: 'foreign_income_or_accounts',
    unemploymentCompensation: 'unemployment_compensation',
    hsa: 'hsa',
    educationExpenses: 'education_expenses',
    wantsToItemize: 'itemized_deductions',
    marriedFilingSeparately: 'married_filing_separately',
  };
  for (const [key, code] of Object.entries(expected)) {
    const items = checkScope(makeFacts({ outOfScope: { [key]: true } }));
    assert.equal(items.length, 1, key);
    assert.equal(items[0]!.code, code);
    assert.ok(items[0]!.message.length > 0);
  }
  const r = checkScope(
    makeFacts({ outOfScope: { retirementDistributions: true } })
  );
  assert.equal(r[0]!.deferredTo, 'v1.1');
  // false flags are fine
  assert.deepEqual(codes(makeFacts({ outOfScope: { hsa: false } })), []);
  // free-text "other" items
  const other = checkScope(
    makeFacts({ outOfScope: { other: ['gambling winnings'] } })
  );
  assert.equal(other[0]!.code, 'other');
  assert.match(other[0]!.message, /gambling winnings/);
});

test('digital asset activity is flagged', () => {
  assert.ok(
    codes(makeFacts({ digitalAssetActivity: true })).includes('digital_assets')
  );
});

test('hoh with no qualifying person -> hoh_no_qualifying_person', () => {
  const none = makeFacts({ filingStatus: 'hoh', w2s: [w2('w2_1', 4000000)] });
  assert.ok(codes(none).includes('hoh_no_qualifying_person'));
  const short = makeFacts({
    filingStatus: 'hoh',
    dependents: [
      {
        id: 'dependent_1',
        dateOfBirth: '2015-01-01',
        relationship: 'child',
        monthsLivedWithTaxpayer: 5,
      },
    ],
  });
  assert.ok(codes(short).includes('hoh_no_qualifying_person'));
  const ok = makeFacts({
    filingStatus: 'hoh',
    dependents: [
      {
        id: 'dependent_1',
        dateOfBirth: '2015-01-01',
        relationship: 'child',
        monthsLivedWithTaxpayer: 7,
      },
    ],
  });
  assert.ok(!codes(ok).includes('hoh_no_qualifying_person'));
});

test('W-2 box 12 codes that need forms outside v1 are flagged', () => {
  const f = makeFacts({
    w2s: [
      w2('w2_1', 5000000, 0, 'taxpayer', {
        box12: [{ code: 'W', amount: 100000 }],
      }),
    ],
  });
  assert.ok(codes(f).includes('hsa'));
  const ok = makeFacts({
    w2s: [
      w2('w2_1', 5000000, 0, 'taxpayer', {
        box12: [{ code: 'D', amount: 100000 }],
      }),
    ],
  });
  assert.deepEqual(codes(ok), []);
});

test('excess social security withholding with two employers is flagged', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 12000000), w2('w2_2', 9000000)] });
  assert.ok(codes(f).includes('excess_social_security'));
});

test('computeReturn reports unsupported and is not complete', () => {
  const r = computeReturn(
    makeFacts({ w2s: [w2('w2_1', 5000000)], outOfScope: { hsa: true } })
  );
  assert.equal(r.complete, false);
  assert.equal(r.unsupported[0]!.code, 'hsa');
});

test('second business for one owner -> multiple_schedule_c', () => {
  const two = makeFacts({
    businesses: [
      { owner: 'taxpayer', expenses: {} },
      { owner: 'taxpayer', expenses: {} },
    ],
  });
  assert.ok(codes(two).includes('multiple_schedule_c'));
});

test('forms now computed in v1 are no longer flagged: Schedule E, 8829, 8959, 8960', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 26000000)],
    int1099s: [int1099('int_1', 2000000)],
    div1099s: [div1099('div_1', 100000, 100000)],
    nec1099s: [nec('nec_1', 3000000)],
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer',
        royalties: 50000,
        treatAsBusiness: false,
      },
    ],
    rentals: [
      {
        id: 'rental_1',
        owner: 'taxpayer',
        propertyType: 6,
        misc1099Ids: ['misc_1'],
        expenses: {},
      },
    ],
    businesses: [
      {
        owner: 'taxpayer',
        expenses: {},
        homeOffice: {
          method: 'actual',
          officeSquareFeet: 200,
          homeSquareFeet: 2000,
          ownership: 'rent',
          indirect: { rent: 2400000 },
        },
      },
    ],
  });
  const c = codes(f);
  for (const gone of [
    'schedule_e_income',
    'additional_medicare_tax',
    'niit',
    'form_8829',
  ])
    assert.ok(!c.includes(gone), gone);
});

test('Schedule E scope: depreciation, vacation home, over 3 properties, self-rental', () => {
  const rental = (id: string, extra: object = {}) => ({
    id,
    owner: 'taxpayer' as const,
    propertyType: 1 as const,
    fairRentalDays: 365,
    personalUseDays: 0,
    rentsOther: 1200000,
    ownsDepreciableProperty: false,
    priorYearUnallowedLoss: false,
    expenses: {},
    ...extra,
  });
  assert.ok(
    codes(
      makeFacts({
        rentals: [rental('rental_1', { ownsDepreciableProperty: true })],
      })
    ).includes('rental_depreciation')
  );
  // 20 personal days > max(14, 10% of 100) -> used as a home, rented 100 days -> vacation_home.
  assert.ok(
    codes(
      makeFacts({
        rentals: [
          rental('rental_1', { fairRentalDays: 100, personalUseDays: 20 }),
        ],
      })
    ).includes('vacation_home')
  );
  // 15 personal days, 200 rental days: 15 > 14 but not > 20 -> not used as a home.
  assert.ok(
    !codes(
      makeFacts({
        rentals: [
          rental('rental_1', { fairRentalDays: 200, personalUseDays: 15 }),
        ],
      })
    ).includes('vacation_home')
  );
  assert.ok(
    codes(
      makeFacts({
        rentals: ['rental_1', 'rental_2', 'rental_3', 'rental_4'].map((i) =>
          rental(i)
        ),
      })
    ).includes('rental_over_3')
  );
  assert.ok(
    codes(
      makeFacts({ rentals: [rental('rental_1', { propertyType: 7 })] })
    ).includes('self_rental')
  );
});

test('Schedule E scope: Form 8582 exception (i1040se) decides passive_loss_8582', () => {
  const loss = (extra: object, wages = 5000000) =>
    makeFacts({
      w2s: [w2('w2_1', wages)],
      rentals: [
        {
          id: 'rental_1',
          owner: 'taxpayer',
          propertyType: 2,
          fairRentalDays: 365,
          personalUseDays: 0,
          rentsOther: 1000000,
          ownsDepreciableProperty: false,
          priorYearUnallowedLoss: false,
          activeParticipation: true,
          expenses: { repairs: 1500000 },
          ...extra,
        },
      ],
    });
  // 5,000 loss, active participation, MAGI 50,000 -> allowed, no 8582.
  assert.ok(!codes(loss({})).includes('passive_loss_8582'));
  assert.equal(computeReturn(loss({})).nodes.rentalRoyaltyIncome?.value, -5000);
  assert.ok(
    codes(loss({ activeParticipation: false })).includes('passive_loss_8582')
  );
  assert.ok(
    codes(loss({ priorYearUnallowedLoss: true, rentsOther: 2000000 })).includes(
      'passive_loss_8582'
    )
  );
  assert.ok(
    codes(loss({ expenses: { repairs: 4000000 } })).includes(
      'passive_loss_8582'
    )
  ); // 30,000 loss
  assert.ok(codes(loss({}, 10100000)).includes('passive_loss_8582')); // MAGI 101,000
  assert.ok(!codes(loss({}, 10000000)).includes('passive_loss_8582')); // MAGI 100,000
});

test('Form 8829 scope: casualty losses and pre-1993 homes', () => {
  const f = (extra: object) =>
    makeFacts({
      nec1099s: [nec('nec_1', 5000000)],
      businesses: [
        {
          owner: 'taxpayer',
          expenses: {},
          homeOffice: {
            method: 'actual',
            officeSquareFeet: 200,
            homeSquareFeet: 2000,
            ownership: 'own',
            ...extra,
          },
        },
      ],
    });
  assert.ok(
    codes(f({ indirect: { casualty_losses: 100000 } })).includes(
      'home_office_casualty'
    )
  );
  assert.ok(
    codes(
      f({
        home: {
          basisOrValue: 20000000,
          landValue: 5000000,
          businessUseStart: '1990-03-01',
        },
      })
    ).includes('home_depreciation_old')
  );
});

test('EIC after a prior disallowance -> eitc_8862', () => {
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
    eitc: { priorDisallowance: true },
  });
  assert.ok(codes(f).includes('eitc_8862'));
  f.eitc = { priorDisallowance: false };
  assert.ok(!codes(f).includes('eitc_8862'));
});

test('a yes to "someone depends on you" asks who, even when single', () => {
  const facts = makeFacts({
    filingStatus: 'single',
    screening: { hasDependents: true },
  });
  const paths = requiredFacts(facts).map((m) => m.path);
  assert.ok(paths.includes('dependents'), JSON.stringify(paths));
  const none = requiredFacts({
    ...facts,
    screening: { hasDependents: false },
  }).map((m) => m.path);
  assert.ok(!none.includes('dependents'));
  assert.ok(!none.includes('screening.hasDependents'));
});

test('a Schedule C without material participation (line G "No") is out of scope', () => {
  const f = (materiallyParticipated?: boolean) =>
    makeFacts({
      nec1099s: [nec('nec_1', 3000000)],
      businesses: [{ owner: 'taxpayer', expenses: {}, materiallyParticipated }],
    });
  assert.ok(codes(f(false)).includes('schedule_c_passive'));
  assert.ok(!codes(f(true)).includes('schedule_c_passive'));
  assert.ok(!codes(f()).includes('schedule_c_passive'));
});
