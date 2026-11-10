/**
 * Questions the interview used to skip: estimated tax payments (with
 * receipts), blindness, the expense checklists, and a 1099-MISC linked to its
 * rental from the 1099-MISC side.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { requiredFacts } from '../src/required.ts';
import type { TaxFacts } from '../src/types.ts';
import { makeFacts, nec, screeningNo, w2 } from './helpers.ts';

const ready = (patch: Partial<TaxFacts> = {}) =>
  makeFacts({
    w2s: [w2('w2_1', 5000000, 400000)],
    screening: screeningNo,
    outOfScope: {
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
    },
    digitalAssetActivity: false,
    ...patch,
  });
const paths = (f: TaxFacts) => requiredFacts(f).map((m) => m.path);

test('estimated tax: asked once, then the amounts; blocking', () => {
  const f = ready({
    screening: { ...screeningNo, paidEstimatedTax: undefined },
  });
  const m = requiredFacts(f).find(
    (x) => x.path === 'screening.paidEstimatedTax'
  );
  assert.ok(m);
  assert.equal(m.blocking, true);
  f.screening!.paidEstimatedTax = true;
  assert.deepEqual(
    paths(f).filter((p) => p.startsWith('payments.')),
    ['payments.estimatedTaxPayments', 'payments.priorYearOverpaymentApplied']
  );
  f.payments = { estimatedTaxPayments: 300000, priorYearOverpaymentApplied: 0 };
  assert.ok(
    !paths(f).some(
      (p) => p.startsWith('payments.') || p === 'screening.paidEstimatedTax'
    )
  );
  assert.equal(computeReturn(f).nodes.estimatedPayments?.value, 3000);
});

test('estimated tax receipts: listed in the question, added to line 26 with the others', () => {
  const f = ready({
    screening: { ...screeningNo, paidEstimatedTax: undefined },
    estimatedPayments: [
      { id: 'estpay_1', amount: 150000, date: '2025-04-15' },
      { id: 'estpay_2', amount: 150025, date: '2025-06-16' },
    ],
  });
  const missing = requiredFacts(f);
  // Receipts answer the yes/no question; the "any others?" question names them.
  assert.ok(!missing.some((m) => m.path === 'screening.paidEstimatedTax'));
  const others = missing.find(
    (m) => m.path === 'payments.estimatedTaxPayments'
  );
  assert.ok(others);
  assert.match(
    others.why,
    /\$1,500\.00 on 2025-04-15, \$1,500\.25 on 2025-06-16/
  );
  f.payments = {
    estimatedTaxPayments: 50000,
    priorYearOverpaymentApplied: 20000,
  };
  const r = computeReturn(f);
  // 1,500.00 + 1,500.25 + 500 + 200 = 3,700.25 → 3,700
  assert.equal(r.nodes.estimatedPayments?.value, 3700);
  assert.equal(r.nodes.estimatedPayments?.line, '26');
  assert.ok(
    r.nodes.estimatedPayments!.trace.inputs.some(
      (i) => i.ref === 'estimatedPayments[estpay_2].amount'
    )
  );
});

test('blindness: one non-blocking question per filer', () => {
  const f = ready({ taxpayer: { ...makeFacts().taxpayer, blind: undefined } });
  const m = requiredFacts(f).find((x) => x.path === 'taxpayer.blind');
  assert.ok(m);
  assert.equal(m.blocking, false);
  assert.ok(!paths(f).includes('spouse.blind'));
  f.filingStatus = 'mfj';
  f.spouse = {
    id: 'spouse',
    dateOfBirth: '1990-01-01',
    hasValidSsn: true,
    canBeClaimedAsDependent: false,
  };
  assert.ok(paths(f).includes('spouse.blind'));
  f.spouse.blind = true;
  assert.ok(!paths(f).includes('spouse.blind'));
});

test('expense checklists: one step per business and per rental', () => {
  const f = ready({
    nec1099s: [nec('nec_1', 3000000)],
    businesses: [{ owner: 'taxpayer', name: 'Design', expenses: {} }],
    rentals: [
      { id: 'rental_1', owner: 'taxpayer', propertyType: 1, expenses: {} },
    ],
  });
  const p = paths(f);
  assert.ok(p.includes('businesses[taxpayer].expensesReviewed'));
  assert.ok(p.includes('rentals[rental_1].expensesReviewed'));
  f.businesses[0]!.expensesReviewed = true;
  f.rentals[0]!.expensesReviewed = true;
  assert.ok(!paths(f).some((x) => x.endsWith('.expensesReviewed')));
});

test('a 1099-MISC linked by rentalId counts on that rental like misc1099Ids', () => {
  const base = {
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer' as const,
        rents: 1200000,
        treatAsBusiness: false,
      },
    ],
  };
  const a = computeReturn(
    ready({
      ...base,
      rentals: [
        {
          id: 'rental_1',
          owner: 'taxpayer',
          propertyType: 2,
          fairRentalDays: 365,
          personalUseDays: 0,
          misc1099Ids: ['misc_1'],
          expenses: {},
          expensesReviewed: true,
        },
      ],
    })
  );
  const b = computeReturn(
    ready({
      misc1099s: [{ ...base.misc1099s[0]!, rentalId: 'rental_1' }],
      rentals: [
        {
          id: 'rental_1',
          owner: 'taxpayer',
          propertyType: 2,
          fairRentalDays: 365,
          personalUseDays: 0,
          expenses: {},
          expensesReviewed: true,
        },
      ],
    })
  );
  assert.equal(
    b.nodes['schE.totalRents']?.value,
    a.nodes['schE.totalRents']?.value
  );
  assert.equal(b.nodes['schE.totalRents']?.value, 12000);
});
