import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import type { TaxFacts } from '../src/types.ts';
import { makeFacts, w2 } from './helpers.ts';

const v = (f: TaxFacts, id: string) => {
  const n = computeReturn(f).nodes[id];
  assert.ok(n, `node ${id}`);
  return n.value;
};

const mfj = (patch: Partial<TaxFacts>): TaxFacts =>
  makeFacts({
    filingStatus: 'mfj',
    spouse: {
      id: 'spouse',
      dateOfBirth: '1990-02-02',
      hasValidSsn: true,
      canBeClaimedAsDependent: false,
    },
    ...patch,
  });

test('tips capped at 25000 (Schedule 1-A line 7)', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 6000000)],
    obbba: { qualifiedTips: { taxpayer: 3000000 } },
  });
  assert.equal(v(f, 'tipsDeduction'), 25000);
  assert.equal(v(f, 'sch1aTotal'), 25000);
  const r = computeReturn(f);
  assert.ok(r.forms.includes('sch1a'));
  assert.equal(r.nodes.sch1aTotal?.line, '13b');
  // deducted after the standard deduction: 60,000 - 15,750 - 25,000
  assert.equal(r.nodes.taxableIncome?.value, 19250);
  assert.equal(r.nodes.agi?.value, 60000);
});

test('tips phase out: single MAGI 160,000, tips 10,000 -> 9,000', () => {
  // Lines 10-12: (160,000 - 150,000) / 1,000 = 10 (rounded down) x $100 = 1,000.
  const f = makeFacts({
    w2s: [w2('w2_1', 16000000)],
    obbba: { qualifiedTips: { taxpayer: 1000000 } },
  });
  assert.equal(v(f, 'tipsDeduction'), 9000);
  // a partial $1,000 does not count: MAGI 160,999 -> still 1,000 reduction
  const g = makeFacts({
    w2s: [w2('w2_1', 16099900)],
    obbba: { qualifiedTips: { taxpayer: 1000000 } },
  });
  assert.equal(v(g, 'tipsDeduction'), 9000);
});

test('tips need a valid SSN for the person who received them', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 4000000)],
    obbba: { qualifiedTips: { taxpayer: 500000 } },
  });
  f.taxpayer.hasValidSsn = false;
  assert.equal(v(f, 'tipsDeduction'), 0);
});

test('overtime mfj cap 25000', () => {
  const f = mfj({
    w2s: [w2('w2_1', 6000000), w2('w2_2', 5000000, 0, 'spouse')],
    obbba: { qualifiedOvertime: { taxpayer: 1800000, spouse: 1200000 } },
  });
  assert.equal(v(f, 'overtimeDeduction'), 25000);
  const single = makeFacts({
    w2s: [w2('w2_1', 6000000)],
    obbba: { qualifiedOvertime: { taxpayer: 1800000 } },
  });
  assert.equal(v(single, 'overtimeDeduction'), 12500);
});

test('car loan requires US assembly (false -> 0, no error)', () => {
  const vehicle = {
    newVehicle: true,
    finalAssemblyInUS: false,
    personalUse: true,
    purchaseDate: '2025-03-01',
  };
  const f = makeFacts({
    w2s: [w2('w2_1', 6000000)],
    obbba: { carLoanInterest: 300000, carLoanVehicle: vehicle },
  });
  assert.equal(v(f, 'carLoanInterestDeduction'), 0);
  const ok = makeFacts({
    w2s: [w2('w2_1', 6000000)],
    obbba: {
      carLoanInterest: 300000,
      carLoanVehicle: { ...vehicle, finalAssemblyInUS: true },
    },
  });
  assert.equal(v(ok, 'carLoanInterestDeduction'), 3000);
  const old = makeFacts({
    w2s: [w2('w2_1', 6000000)],
    obbba: {
      carLoanInterest: 300000,
      carLoanVehicle: {
        ...vehicle,
        finalAssemblyInUS: true,
        purchaseDate: '2024-06-01',
      },
    },
  });
  assert.equal(v(old, 'carLoanInterestDeduction'), 0);
});

test('car loan phase-out rounds up to the next $1,000', () => {
  // MAGI 100,500 single: (500 / 1,000) -> 1 x $200 = 200 (Schedule 1-A line 28 rounds up)
  const vehicle = {
    newVehicle: true,
    finalAssemblyInUS: true,
    personalUse: true,
  };
  const f = makeFacts({
    w2s: [w2('w2_1', 10050000)],
    obbba: { carLoanInterest: 300000, carLoanVehicle: vehicle },
  });
  assert.equal(v(f, 'carLoanInterestDeduction'), 2800);
  const capped = makeFacts({
    w2s: [w2('w2_1', 5000000)],
    obbba: { carLoanInterest: 1500000, carLoanVehicle: vehicle },
  });
  assert.equal(v(capped, 'carLoanInterestDeduction'), 10000);
});

test('senior deduction both spouses: MFJ both 65+, MAGI 100,000 -> 12,000', () => {
  const f = mfj({ w2s: [w2('w2_1', 10000000)] });
  f.taxpayer.dateOfBirth = '1955-05-05';
  f.spouse!.dateOfBirth = '1958-01-01';
  assert.equal(v(f, 'seniorDeduction'), 12000);
});

test('senior phase-out: single MAGI 85,000 -> 5,400', () => {
  // Lines 33-35: (85,000 - 75,000) x 6% = 600; 6,000 - 600 = 5,400.
  const f = makeFacts({ w2s: [w2('w2_1', 8500000)] });
  f.taxpayer.dateOfBirth = '1959-12-31';
  assert.equal(v(f, 'seniorDeduction'), 5400);
  f.taxpayer.hasValidSsn = false;
  assert.equal(v(f, 'seniorDeduction'), 0);
});

test('only one spouse 65+ gets one senior amount', () => {
  const f = mfj({ w2s: [w2('w2_1', 10000000)] });
  f.taxpayer.dateOfBirth = '1955-05-05';
  assert.equal(v(f, 'seniorDeduction'), 6000);
});
