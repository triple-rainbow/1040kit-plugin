/** Form 8959 (i8959 2025 examples) and Form 8960 (i8960 2025). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { div1099, int1099, makeFacts, nec, w2 } from './helpers.ts';

/** A W-2 whose box 6 includes the 0.9% Additional Medicare Tax withheld over $200,000. */
const bigW2 = (
  id: string,
  wagesCents: number,
  owner: 'taxpayer' | 'spouse' = 'taxpayer'
) => {
  const base = w2(id, wagesCents, 0, owner, {
    ssWages: 17610000,
    ssTax: 1091820,
  });
  const extra = Math.max(0, wagesCents - 20000000);
  return {
    ...base,
    medicareTax: Math.round(wagesCents * 0.0145 + extra * 0.009),
  };
};

test('8959: single, wages 250,000 -> 450 tax, 450 withheld (Part V) to line 25c', () => {
  const r = computeReturn(makeFacts({ w2s: [bigW2('w2_1', 25000000)] }));
  const n = r.nodes;
  assert.equal(n['f8959.medicareWages']?.value, 250000);
  assert.equal(n['f8959.wagesOverThreshold']?.value, 50000);
  assert.equal(n['f8959.taxOnWages']?.value, 450);
  assert.equal(n['f8959.total']?.value, 450);
  assert.equal(n['f8959.total']?.line, '18');
  assert.equal(n['sch2.additionalMedicareTax']?.value, 450);
  assert.equal(n['sch2.additionalMedicareTax']?.line, '11');
  assert.equal(n['f8959.medicareWithheld']?.value, 4075);
  assert.equal(n['f8959.regularWithholding']?.value, 3625);
  assert.equal(n['f8959.additionalWithheld']?.value, 450);
  assert.equal(n.withholdingOther?.value, 450);
  assert.equal(n.withholdingOther?.line, '25c');
  assert.equal(n.totalWithholding?.value, 450);
  assert.ok(r.forms.includes('f8959') && r.forms.includes('sch2'));
  assert.ok(!r.unsupported.some((u) => u.code === 'additional_medicare_tax'));
});

test('8959 example (i8959 Kathleen and Liam): MFJ wages 130,000 reduce the SE threshold -> 180', () => {
  // Liam: net profit 151,597 x 92.35% = 140,000 of SE income (Schedule SE line 6).
  const f = makeFacts({
    filingStatus: 'mfj',
    spouse: {
      id: 'spouse',
      dateOfBirth: '1988-01-01',
      hasValidSsn: true,
      canBeClaimedAsDependent: false,
    },
    w2s: [w2('w2_1', 13000000)],
    nec1099s: [nec('nec_1', 15159700, 'spouse')],
    businesses: [{ owner: 'spouse', expenses: {} }],
  });
  const n = computeReturn(f).nodes;
  assert.equal(n['f8959.seIncome']?.value, 140000);
  assert.equal(n['f8959.seThresholdReduced']?.value, 120000);
  assert.equal(n['f8959.seOverThreshold']?.value, 20000);
  assert.equal(n['f8959.taxOnSe']?.value, 180);
  assert.equal(n['f8959.taxOnWages']?.value, 0);
  assert.equal(n.additionalMedicareTax?.value, 180);
});

test('8959 example (i8959 Bob): single, SE income 220,000 -> 180; a loss counts as 0', () => {
  // 238,224 x 92.35% = 220,000.
  const f = makeFacts({
    nec1099s: [nec('nec_1', 23822400)],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
  });
  assert.equal(computeReturn(f).nodes['f8959.taxOnSe']?.value, 180);
  const loss = makeFacts({
    filingStatus: 'mfj',
    spouse: { id: 'spouse', dateOfBirth: '1988-01-01', hasValidSsn: true },
    nec1099s: [nec('nec_1', 30000000), nec('nec_2', 100000, 'spouse')],
    businesses: [
      { owner: 'taxpayer', expenses: {} },
      { owner: 'spouse', expenses: { supplies: 1000000 } },
    ],
  });
  const n = computeReturn(loss).nodes;
  assert.equal(n['f8959.seIncome']?.value, 277050); // 300,000 x 92.35%; the spouse's loss is ignored
});

test('2026 Form 8959 draft line numbers: wages total on 12, SE in Part IV, Schedule 2 lines 11 and 17b', () => {
  const r = computeReturn(makeFacts({ w2s: [bigW2('w2_1', 25000000)] }, 2026));
  const n = r.nodes;
  assert.equal(n['f8959.taxOnWages']?.line, '7');
  assert.equal(n['f8959.wagesAndRrtaTax']?.line, '12');
  assert.equal(n['f8959.taxOnSe']?.line, '18');
  assert.equal(n['f8959.total']?.line, undefined);
  assert.equal(n['sch2.additionalMedicareTaxWages']?.line, '17b');
  assert.equal(n['sch2.additionalMedicareTaxWages']?.value, 450);
  assert.equal(n['sch2.otherEmploymentTaxes']?.line, '17d');
  assert.equal(n['sch2.additionalMedicareTaxSe']?.line, '11');
});

test('8960: wages + interest + dividends + royalties over the threshold; Schedule C backed out on 4b', () => {
  const f = makeFacts({
    w2s: [w2('w2_1', 25000000)],
    int1099s: [int1099('int_1', 2000000)],
    div1099s: [div1099('div_1', 1000000, 500000)],
    nec1099s: [nec('nec_1', 1000000)],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
    misc1099s: [
      {
        id: 'misc_1',
        owner: 'taxpayer',
        royalties: 500000,
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
  });
  const r = computeReturn(f);
  const n = r.nodes;
  const biz = n.businessIncome!.value;
  assert.equal(n['f8960.taxableInterest']?.value, 20000);
  assert.equal(n['f8960.ordinaryDividends']?.value, 10000);
  assert.equal(n['f8960.businessRentalIncome']?.value, biz + 5000);
  assert.equal(n['f8960.nonSection1411Adjustment']?.value, -biz);
  assert.equal(n['f8960.netBusinessRental']?.value, 5000);
  assert.equal(n['f8960.investmentIncome']?.value, 35000);
  assert.equal(n['f8960.netInvestmentIncome']?.value, 35000);
  assert.equal(n['f8960.magi']?.value, n.agi?.value);
  assert.equal(n['f8960.taxBase']?.value, 35000);
  assert.equal(n['f8960.tax']?.value, 1330); // 35,000 x 3.8%
  assert.equal(n['f8960.tax']?.line, '17');
  assert.equal(n['sch2.niit']?.line, '12');
  assert.equal(
    n.otherTaxes?.value,
    n.seTaxTotal!.value + n.additionalMedicareTax!.value + 1330
  );
  assert.ok(r.forms.includes('f8960'));
});

test('8960: MAGI just over the threshold limits the tax base; under the threshold no NIIT', () => {
  const over = makeFacts({
    w2s: [w2('w2_1', 19500000)],
    int1099s: [int1099('int_1', 1000000)],
  });
  const n = computeReturn(over).nodes;
  assert.equal(n['f8960.magiOverThreshold']?.value, 5000);
  assert.equal(n['f8960.taxBase']?.value, 5000);
  assert.equal(n.niit?.value, 190);
  const under = makeFacts({
    w2s: [w2('w2_1', 18000000)],
    int1099s: [int1099('int_1', 1000000)],
  });
  assert.equal(computeReturn(under).nodes.niit?.value, 0);
  assert.ok(!computeReturn(under).forms.includes('f8960'));
  // 2026: NIIT on Schedule 2 line 6 (draft).
  assert.equal(
    computeReturn({ ...over, taxYear: 2026 }).nodes['sch2.niit']?.line,
    '6'
  );
});
