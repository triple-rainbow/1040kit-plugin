import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import type { Dependent, TaxFacts } from '../src/types.ts';
import { makeFacts, w2 } from './helpers.ts';

const kid = (
  id: string,
  dob: string,
  extra: Partial<Dependent> = {}
): Dependent => ({
  id,
  dateOfBirth: dob,
  relationship: 'child',
  monthsLivedWithTaxpayer: 12,
  hasValidSsn: true,
  providedOverHalfOwnSupport: false,
  ...extra,
});

const nodes = (f: TaxFacts) => computeReturn(f).nodes;

test('ctc two kids: MFJ wages 100,000 -> 4,400', () => {
  const f = makeFacts({
    filingStatus: 'mfj',
    spouse: { id: 'spouse', dateOfBirth: '1985-01-01', hasValidSsn: true },
    dependents: [
      kid('dependent_1', '2015-04-04'),
      kid('dependent_2', '2018-09-09'),
    ],
    w2s: [w2('w2_1', 10000000, 800000)],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes.ctc?.value, 4400);
  assert.equal(r.nodes.odc?.value, 0);
  assert.equal(r.nodes.childCredits?.value, 4400);
  assert.equal(r.nodes.childCredits?.line, '19');
  assert.equal(r.nodes.actc?.value, 0);
  assert.ok(r.forms.includes('sch8812'));
});

test('ctc limited by tax -> actc refundable part', () => {
  // HoH, wages 30,000, two kids. 15 = 30,000 - 23,625 = 6,375; 16 = Tax Table HoH 6,350-6,400 = 638.
  // 8812: 8 = 4,400; 12 = 4,400; 13 = 638; 14 = 638; 16a = 3,762; 16b = 3,400; 17 = 3,400;
  // 18a = 30,000; 19 = 27,500; 20 = 4,125; 16b < 5,100 -> 27 = min(3,400, 4,125) = 3,400.
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [
      kid('dependent_1', '2016-01-01'),
      kid('dependent_2', '2019-01-01'),
    ],
    w2s: [w2('w2_1', 3000000, 100000)],
  });
  const n = nodes(f);
  assert.equal(n.tax?.value, 638);
  assert.equal(n.childCredits?.value, 638);
  assert.equal(n.actc?.value, 3400);
  assert.equal(n.actc?.line, '28');
  assert.equal(n.totalTax?.value, 0);
  // EIC: 2025 EIC Table row 30,000-30,050, HoH with 2 children = 5,746.
  assert.equal(n.eic?.value, 5746);
  assert.equal(n.refundOrOwed?.value, 1000 + 3400 + 5746);
});

test('actc limited by 15% of earned income over 2,500', () => {
  // Single parent? use HoH, wages 10,000 -> tax 0; 19 = 7,500; 20 = 1,125 -> ACTC 1,125.
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2016-01-01')],
    w2s: [w2('w2_1', 1000000)],
  });
  assert.equal(nodes(f).actc?.value, 1125);
});

test('child turning 17 during year gets ODC not CTC', () => {
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2008-12-31', { fullTimeStudent: false })],
    w2s: [w2('w2_1', 6000000)],
  });
  const n = nodes(f);
  assert.equal(n.ctc?.value, 0);
  assert.equal(n.odc?.value, 500);
  assert.equal(n.childCredits?.value, 500);
  assert.equal(n.actc?.value, 0);
});

test('a child born 2009-01-01 is still under 17 at the end of 2025', () => {
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2009-01-01')],
    w2s: [w2('w2_1', 6000000)],
  });
  assert.equal(nodes(f).ctc?.value, 2200);
});

test('no SSN no CTC but ODC', () => {
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2016-01-01', { hasValidSsn: false })],
    w2s: [w2('w2_1', 6000000)],
  });
  const n = nodes(f);
  assert.equal(n.ctc?.value, 0);
  assert.equal(n.odc?.value, 500);
});

test('filer without a valid SSN cannot claim the CTC (2025+)', () => {
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2016-01-01')],
    w2s: [w2('w2_1', 6000000)],
  });
  f.taxpayer.hasValidSsn = false;
  assert.equal(nodes(f).ctc?.value, 0);
});

test('ctc phase-out: $50 per $1,000 (or part) over 200,000', () => {
  // Single-status HoH with AGI 210,500: excess 10,500 -> 11,000 x 5% = 550. 2,200 - 550 = 1,650.
  const f = makeFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2016-01-01')],
    w2s: [w2('w2_1', 21050000)],
  });
  const n = nodes(f);
  assert.equal(n.ctcOdcPhaseout?.value, 550);
  assert.equal(n.childCredits?.value, 1650);
});

test('a qualifying relative over the gross income limit gets no ODC', () => {
  const f = makeFacts({
    dependents: [
      {
        id: 'dependent_1',
        dateOfBirth: '1950-01-01',
        relationship: 'parent',
        grossIncome: 600000,
        hasValidSsn: true,
      },
    ],
    w2s: [w2('w2_1', 6000000)],
  });
  assert.equal(nodes(f).odc?.value, 0);
  f.dependents[0]!.grossIncome = 300000;
  assert.equal(nodes(f).odc?.value, 500);
});
