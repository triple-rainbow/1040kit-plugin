/** Form 8829 (i8829 2025; Pub. 946 Table A-7a). Synthetic homes only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { explainLine } from '../src/explain.ts';
import type { HomeOfficeActual, TaxFacts } from '../src/types.ts';
import { makeFacts, nec } from './helpers.ts';

const withOffice = (
  ho: Omit<HomeOfficeActual, 'method'>,
  receipts = 5000000,
  year: 2025 | 2026 = 2025
): TaxFacts =>
  makeFacts(
    {
      nec1099s: [nec('nec_1', receipts)],
      businesses: [
        {
          owner: 'taxpayer',
          expenses: { supplies: 1000000 },
          homeOffice: { method: 'actual', ...ho },
        },
      ],
    },
    year
  );

const owner: Omit<HomeOfficeActual, 'method'> = {
  officeSquareFeet: 200,
  homeSquareFeet: 2000,
  ownership: 'own',
  monthsUsed: 9,
  direct: { repairs_maintenance: 30000 },
  indirect: {
    mortgage_interest: 1200000,
    real_estate_taxes: 400000,
    insurance: 120000,
    utilities: 360000,
  },
  home: {
    basisOrValue: 30000000,
    landValue: 6000000,
    businessUseStart: '2025-04-15',
  },
};

test('homeowner, first used in April: standard-deduction lines 16-17, part-year, 39-year depreciation', () => {
  const r = computeReturn(withOffice(owner));
  const n = r.nodes;
  const v = (k: string) => n[`f8829.${k}.taxpayer`]?.value;
  assert.equal(v('businessPct'), 100000); // 10%
  assert.equal(v('grossIncomeLimit'), 40000); // Schedule C line 29
  assert.equal(v('homeDeductionsBusiness'), 0); // lines 9-14 empty (standard deduction)
  assert.equal(v('limitAfterHomeDeductions'), 40000);
  // Indirect amounts x 9/12 months.
  assert.equal(v('expense.mortgage_interest.indirect'), 9000);
  assert.equal(
    n['f8829.expense.mortgage_interest.indirect.taxpayer']?.line,
    '16:b'
  );
  assert.equal(v('expense.real_estate_taxes.indirect'), 3000);
  assert.equal(
    n['f8829.expense.real_estate_taxes.indirect.taxpayer']?.line,
    '17:b'
  );
  assert.equal(v('expense.insurance.indirect'), 900);
  assert.equal(v('expense.utilities.indirect'), 2700);
  assert.equal(v('expense.repairs_maintenance.direct'), 300);
  assert.equal(
    n['f8829.expense.repairs_maintenance.direct.taxpayer']?.line,
    '20:a'
  );
  assert.equal(v('operatingDirect'), 300);
  assert.equal(v('operatingIndirect'), 15600);
  assert.equal(v('operatingIndirectBusiness'), 1560);
  assert.equal(v('operatingTotal'), 1860);
  assert.equal(v('operatingAllowed'), 1860);
  assert.equal(v('limitAfterOperating'), 38140);
  // Part III: (300,000 - 60,000) x 10% = 24,000 x 1.819% (April) = 436.56 -> 437.
  assert.equal(v('buildingBasis'), 240000);
  assert.equal(v('businessBasis'), 24000);
  assert.equal(v('depreciationPct'), 18190);
  assert.equal(n['f8829.depreciationPct.taxpayer']?.line, '41');
  assert.equal(v('depreciationAllowable'), 437);
  assert.equal(v('depreciation'), 437);
  assert.equal(v('depreciationAllowed'), 437);
  assert.equal(v('allowable'), 1860 + 437);
  assert.equal(n['f8829.allowable.taxpayer']?.line, '36');
  assert.equal(n['schC.homeOffice.taxpayer']?.value, 2297);
  assert.equal(n['schC.netProfit.taxpayer']?.value, 40000 - 2297);
  assert.equal(v('operatingCarryoverOut'), 0);
  assert.equal(v('depreciationCarryoverOut'), 0);
  assert.ok(r.forms.includes('f8829.taxpayer'));
  assert.deepEqual(r.unsupported, []);
  // "<form>:<line>" lookups with column suffixes and the line 7 alias.
  assert.equal(explainLine(r, 'f8829.taxpayer:16:b')?.node.value, 9000);
  assert.equal(explainLine(r, 'f8829.taxpayer:7')?.node.value, 100000);
});

test('gross income limit: unused operating expenses and depreciation carry over (lines 43, 44)', () => {
  const r = computeReturn(
    withOffice(
      {
        officeSquareFeet: 200,
        homeSquareFeet: 2000,
        ownership: 'rent',
        indirect: { rent: 2400000 },
        carryover: { operating: 10000, casualtyAndDepreciation: 50000 },
      },
      1100000 // receipts 11,000 - supplies 10,000 = 1,000 tentative profit
    )
  );
  const v = (k: string) => r.nodes[`f8829.${k}.taxpayer`]?.value;
  assert.equal(v('grossIncomeLimit'), 1000);
  assert.equal(v('operatingIndirectBusiness'), 2400);
  assert.equal(v('operatingCarryover'), 100);
  assert.equal(v('operatingTotal'), 2500);
  assert.equal(v('operatingAllowed'), 1000);
  assert.equal(v('limitAfterOperating'), 0);
  assert.equal(v('depreciationCarryover'), 500);
  assert.equal(v('depreciationAllowed'), 0);
  assert.equal(v('allowable'), 1000);
  assert.equal(v('operatingCarryoverOut'), 1500);
  assert.equal(v('depreciationCarryoverOut'), 500);
  assert.equal(r.nodes['f8829.homeBasis.taxpayer'], undefined); // renter: no Part III
  assert.equal(r.nodes['schC.netProfit.taxpayer']?.value, 0);
});

test('depreciation percentage: later years 2.564%, stopping mid-year uses the mid-month fraction', () => {
  const pctFor = (start: string, monthsUsed?: number) =>
    computeReturn(
      withOffice({
        ...owner,
        monthsUsed,
        home: {
          basisOrValue: 30000000,
          landValue: 6000000,
          businessUseStart: start,
        },
      })
    ).nodes['f8829.depreciationPct.taxpayer']?.value;
  assert.equal(pctFor('2020-06-01'), 25640);
  assert.equal(pctFor('2020-06-01', 12), 25640);
  // Stopped after 6 months: 2.564% x 5.5 / 12 = 1.17517% -> 11,752 ppm.
  assert.equal(pctFor('2020-06-01', 6), 11752);
  // First used in December: 0.107%.
  assert.equal(pctFor('2025-12-01', 1), 1070);
  // First used in March, stopped in June of the same year: no depreciation.
  assert.equal(pctFor('2025-03-01', 4), 0);
  // 2026 table is the same 39-year mid-month table.
  const r26 = computeReturn(
    withOffice(
      {
        ...owner,
        home: {
          basisOrValue: 30000000,
          landValue: 6000000,
          businessUseStart: '2026-01-10',
        },
        monthsUsed: 12,
      },
      5000000,
      2026
    )
  );
  assert.equal(r26.nodes['f8829.depreciationPct.taxpayer']?.value, 24610);
});

test('mortgage interest entered as direct moves to column (b) (i8829: never a direct expense)', () => {
  const r = computeReturn(
    withOffice({
      officeSquareFeet: 100,
      homeSquareFeet: 1000,
      ownership: 'own',
      direct: { mortgage_interest: 500000 },
    })
  );
  assert.equal(
    r.nodes['f8829.expense.mortgage_interest.direct.taxpayer'],
    undefined
  );
  assert.equal(
    r.nodes['f8829.expense.mortgage_interest.indirect.taxpayer']?.value,
    5000
  );
  assert.equal(r.nodes['f8829.operatingIndirectBusiness.taxpayer']?.value, 500);
});
