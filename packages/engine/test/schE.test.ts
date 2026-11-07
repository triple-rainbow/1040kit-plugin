/** Schedule E, Part I (i1040se 2025; Pub. 527). Synthetic properties only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { requiredFacts } from '../src/required.ts';
import type { RentalProperty, TaxFacts } from '../src/types.ts';
import { makeFacts, w2 } from './helpers.ts';

const rental = (
  id: string,
  extra: Partial<RentalProperty> = {}
): RentalProperty => ({
  id,
  owner: 'taxpayer',
  propertyType: 1,
  fairRentalDays: 365,
  personalUseDays: 0,
  ownsDepreciableProperty: false,
  priorYearUnallowedLoss: false,
  activeParticipation: true,
  expenses: {},
  ...extra,
});

const nodes = (f: TaxFacts) => computeReturn(f).nodes;

test('rental profit: 1099-MISC box 1 + other rents, expenses, line 26 to Schedule 1 line 5', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 5000000)],
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer',
        rents: 1440000,
        treatAsBusiness: false,
      },
    ],
    rentals: [
      rental('rental_1', {
        misc1099Ids: ['misc_1'],
        rentsOther: 60050,
        expenses: {
          insurance: 120040,
          repairs: 80000,
          utilities: 150000,
          management_fees: 144000,
        },
      }),
    ],
  });
  const r = computeReturn(f);
  const n = r.nodes;
  assert.equal(n['schE.rents.rental_1']?.value, 15001); // 14,400 + 600.50 -> 15,000.50 -> 15,001
  assert.equal(n['schE.rents.rental_1']?.line, '3:A');
  assert.equal(n['schE.expense.insurance.rental_1']?.line, '9:A');
  assert.equal(n['schE.expense.management_fees.rental_1']?.line, '11:A');
  assert.equal(
    n['schE.totalExpenses.rental_1']?.value,
    1200 + 800 + 1500 + 1440
  );
  assert.equal(n['schE.net.rental_1']?.value, 15001 - 4940);
  assert.equal(n['schE.net.rental_1']?.line, '21:A');
  assert.equal(n['schE.deductibleLoss.rental_1']?.value, 0);
  assert.equal(n['schE.total']?.value, 10061);
  assert.equal(n['schE.total']?.line, '26');
  assert.equal(n.rentalRoyaltyIncome?.value, 10061);
  assert.equal(n.rentalRoyaltyIncome?.line, '5');
  assert.equal(n.totalIncome?.value, 50000 + 10061);
  assert.ok(r.forms.includes('schE') && r.forms.includes('sch1'));
  assert.equal(r.unsupported.length, 0);
});

test('personal use days: expenses divided by rental days / total days, rental-only expenses are not', () => {
  // 200 fair rental days, 10 personal days (not used as a home: 10 <= max(14, 20)).
  const f = makeFacts({
    rentals: [
      rental('rental_1', {
        fairRentalDays: 200,
        personalUseDays: 10,
        rentsOther: 2000000,
        expenses: { utilities: 210000, advertising: 50000 },
      }),
    ],
  });
  const n = nodes(f);
  assert.equal(n['schE.expense.utilities.rental_1']?.value, 2000); // 2,100 x 200/210
  assert.equal(n['schE.expense.advertising.rental_1']?.value, 500);
  assert.equal(n['schE.fairRentalDays.rental_1']?.line, '2.fair:A');
  assert.equal(n['schE.personalUseDays.rental_1']?.value, 10);
});

test('used as a home and rented fewer than 15 days: not reported (Pub. 527)', () => {
  const f = makeFacts({
    rentals: [
      rental('rental_1', {
        fairRentalDays: 10,
        personalUseDays: 300,
        rentsOther: 500000,
      }),
    ],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes['schE.rents.rental_1'], undefined);
  assert.equal(r.nodes.rentalRoyaltyIncome?.value, 0);
  assert.ok(!r.forms.includes('schE'));
  assert.ok(!r.unsupported.some((u) => u.code === 'vacation_home'));
});

test('royalties: code 6, loss allowed in line 25 without Form 8582, no days', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 4000000)],
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer',
        royalties: 30000,
        treatAsBusiness: false,
      },
    ],
    rentals: [
      rental('rental_1', {
        propertyType: 6,
        misc1099Ids: ['misc_1'],
        expenses: { legal_professional: 50000 },
      }),
    ],
  });
  const r = computeReturn(f);
  const n = r.nodes;
  assert.equal(n['schE.royalties.rental_1']?.value, 300);
  assert.equal(n['schE.net.rental_1']?.value, -200);
  assert.equal(n['schE.deductibleLoss.rental_1'], undefined);
  assert.equal(n['schE.fairRentalDays.rental_1'], undefined);
  assert.equal(n['schE.losses']?.value, -200);
  assert.equal(n['schE.total']?.value, -200);
  assert.equal(n['schE.totalRoyalties']?.line, '23b');
  assert.ok(!r.unsupported.some((u) => u.code === 'passive_loss_8582'));
});

test('columns follow rentals id order; a spouse property is left off a single return', () => {
  const f = makeFacts({
    rentals: [
      rental('rental_10', { rentsOther: 100000 }),
      rental('rental_2', { rentsOther: 100000 }),
      rental('rental_3', { owner: 'spouse', rentsOther: 100000 }),
    ],
  });
  const n = nodes(f);
  assert.equal(n['schE.rents.rental_2']?.line, '3:A');
  assert.equal(n['schE.rents.rental_10']?.line, '3:B');
  assert.equal(n['schE.rents.rental_3'], undefined);
});

test('a non-business 1099-MISC with rents that no property claims is a blocking question', () => {
  const f = makeFacts({
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer',
        rents: 100000,
        treatAsBusiness: false,
      },
    ],
  });
  const m = requiredFacts(f).find(
    (x) => x.path === 'rentals[<id>].misc1099Ids'
  );
  assert.ok(m);
  assert.equal(m.blocking, true);
  // Linking it removes the question.
  f.rentals = [rental('rental_1', { misc1099Ids: ['misc_1'] })];
  assert.ok(
    !requiredFacts(f).some((x) => x.path === 'rentals[<id>].misc1099Ids')
  );
});

test('rental questions: type, days, ownership, prior-year losses; active participation only with a loss', () => {
  const bare: RentalProperty = {
    id: 'rental_1',
    owner: 'taxpayer',
    rentsOther: 1000000,
    expenses: {},
  };
  const paths = requiredFacts(makeFacts({ rentals: [bare] })).map(
    (m) => m.path
  );
  for (const p of [
    'propertyType',
    'fairRentalDays',
    'personalUseDays',
    'ownsDepreciableProperty',
    'priorYearUnallowedLoss',
  ])
    assert.ok(paths.includes(`rentals[rental_1].${p}`), p);
  assert.ok(!paths.includes('rentals[rental_1].activeParticipation'));
  const loss = { ...bare, expenses: { repairs: 2000000 } };
  assert.ok(
    requiredFacts(makeFacts({ rentals: [loss] })).some(
      (m) => m.path === 'rentals[rental_1].activeParticipation'
    )
  );
  assert.ok(
    requiredFacts(
      makeFacts({ screening: { hasRentalOrRoyaltyIncome: true } })
    ).some((m) => m.path === 'rentals' && m.blocking)
  );
});

test('2026: other interest prints on line 13b (2026 Schedule E draft)', () => {
  const f = makeFacts(
    {
      rentals: [
        rental('rental_1', {
          rentsOther: 1000000,
          expenses: { other_interest: 10000 },
        }),
      ],
    },
    2026
  );
  assert.equal(nodes(f)['schE.expense.other_interest.rental_1']?.line, '13b:A');
});

test('net rental income counts as EIC investment income (Pub. 596 Worksheet 1)', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 1500000)],
    rentals: [rental('rental_1', { rentsOther: 1300000 })],
  });
  const n = nodes(f);
  assert.equal(n['eic.investmentIncome']?.value, 13000);
  assert.equal(n.eic?.value, 0); // over $11,950
});
