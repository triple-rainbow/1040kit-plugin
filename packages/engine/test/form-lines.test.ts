/**
 * Lines that print on the IRS forms but that the engine used to compute
 * inline (Schedule 8812 lines 8-10 and Part II, Schedule SE 4c and 9,
 * Form 8995 lines 1(c), 2 and 13), plus the copy lines in lineAliases.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { getParams } from '../src/params/index.ts';
import type { Dependent } from '../src/types.ts';
import { makeFacts, nec, w2 } from './helpers.ts';

const kid = (id: string, dob: string): Dependent => ({
  id,
  dateOfBirth: dob,
  relationship: 'child',
  monthsLivedWithTaxpayer: 12,
  hasValidSsn: true,
  providedOverHalfOwnSupport: false,
});

test('Schedule 8812 Part II-B: three children, self-employment only (no W-2 withholding)', () => {
  // Sch C 20,000; SE 4a 18,470, 12 = 2,826, 13 = 1,413; AGI 18,587; HoH taxable 0.
  // 8812: 5 = 8 = 12 = 6,600; 14 = 0; 16a 6,600; 16b 5,100; 17 5,100; 18a 18,587;
  // 19 16,087; 20 2,413; 16b >= 5,100 and 20 < 17 -> Part II-B: 21 = 0; 22 = 1,413;
  // 23 = 1,413; 24 = EIC; 25 = max(0, 23 - 24); 26 = max(20, 25); 27 = min(17, 26).
  const r = computeReturn(
    makeFacts({
      filingStatus: 'hoh',
      dependents: [
        kid('dependent_1', '2012-02-02'),
        kid('dependent_2', '2015-03-03'),
        kid('dependent_3', '2018-04-04'),
      ],
      nec1099s: [nec('nec_1', 2000000)],
      businesses: [{ owner: 'taxpayer', expenses: {} }],
    })
  );
  const v = (id: string) => r.nodes[id]!.value;
  assert.equal(v('seDeduction'), 1413);
  assert.equal(v('ctcOdcTotal'), 6600);
  assert.equal(v('childCredits'), 0);
  assert.equal(v('actc.unused'), 6600);
  assert.equal(v('actc.childLimit'), 5100);
  assert.equal(v('actc.limit'), 5100);
  assert.equal(v('actcEarnedIncome'), 18587);
  assert.equal(v('actc.earnedOverThreshold'), 16087);
  assert.equal(v('actc.earnedIncomeCredit'), 2413);
  assert.equal(v('actc.usesPartIIB'), 1);
  assert.equal(v('actc.withheldTaxes'), 0);
  assert.equal(v('actc.seDeduction'), 1413);
  assert.equal(v('actc.payrollTotal'), 1413);
  assert.equal(v('actc.eic'), v('eic'));
  assert.ok(v('eic') > 0);
  assert.equal(v('actc.payrollNet'), Math.max(0, 1413 - v('eic')));
  assert.equal(v('actc.partIIB'), Math.max(2413, v('actc.payrollNet')));
  assert.equal(v('actc'), Math.min(5100, v('actc.partIIB')));
});

test('Schedule 8812 phase-out lines 9-11: single wages 212,345 -> 10 = 13,000, 11 = 650', () => {
  const r = computeReturn(
    makeFacts({
      dependents: [kid('dependent_1', '2016-01-01')],
      w2s: [w2('w2_1', 21234500)],
    })
  );
  const v = (id: string) => r.nodes[id]!.value;
  assert.equal(v('agi'), 212345);
  assert.equal(v('ctcOdcThreshold'), 200000);
  assert.equal(v('ctcOdcExcess'), 13000);
  assert.equal(v('ctcOdcPhaseout'), 650);
  assert.equal(v('ctcOdcAfterPhaseout'), 1550);
});

test('Schedule SE line 4c is 0 under $400 and no SE tax is due', () => {
  const r = computeReturn(
    makeFacts({
      nec1099s: [nec('nec_1', 40000)],
      businesses: [{ owner: 'taxpayer', expenses: {} }],
    })
  );
  assert.equal(r.nodes['se.netEarnings.taxpayer']!.value, 369);
  assert.equal(r.nodes['se.netEarningsSubject.taxpayer']!.value, 0);
  assert.equal(r.nodes['seTax.taxpayer']!.value, 0);
});

test('every copy alias points at an existing node and a different line of the same form', () => {
  for (const year of [2025, 2026] as const) {
    const p = getParams(year);
    for (const [where, id] of Object.entries(p.lineAliases)) {
      const at = where.lastIndexOf(':');
      assert.ok(at > 0, `${year} ${where}`);
      const target = p.formLines[id];
      assert.ok(target, `${year} ${where} -> ${id} has no form line`);
      assert.ok(
        !(
          target.form === where.slice(0, at) &&
          target.line === where.slice(at + 1)
        ),
        `${year} ${where} repeats its own line`
      );
    }
  }
});
