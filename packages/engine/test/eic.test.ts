/** Earned income credit (i1040gi 2025 line 27a) and Schedule EIC. Amounts from the 2025 EIC Table. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { requiredFacts } from '../src/required.ts';
import type { Dependent, TaxFacts } from '../src/types.ts';
import { int1099, makeFacts, nec, w2 } from './helpers.ts';

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

const eicFacts = (patch: Partial<TaxFacts> = {}) =>
  makeFacts({
    eitc: { priorDisallowance: false },
    ...patch,
    taxpayer: {
      id: 'taxpayer',
      dateOfBirth: '1990-05-01',
      hasValidSsn: true,
      canBeClaimedAsDependent: false,
      livedInUsOverHalfYear: true,
      qualifyingChildOfAnother: false,
      ...patch.taxpayer,
    },
  });

const eic = (f: TaxFacts) => computeReturn(f).nodes.eic?.value ?? 0;

test('HoH, one child, wages 20,000 -> 4,328 (table row 20,000-20,050)', () => {
  const f = eicFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2018-04-01')],
    w2s: [w2('w2_1', 2000000)],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes.eic?.value, 4328);
  assert.equal(r.nodes.eic?.line, '27a');
  assert.equal(r.nodes.eic?.form, 'f1040');
  assert.equal(r.nodes['eic.qualifyingChildren']?.value, 1);
  assert.ok(r.forms.includes('schEIC'));
  assert.equal(
    r.nodes.otherPaymentsAndCredits?.value,
    4328 + (r.nodes.actc?.value ?? 0)
  );
});

test('single, no child, age 35, wages 12,000 -> 542', () => {
  assert.equal(eic(eicFacts({ w2s: [w2('w2_1', 1200000)] })), 542);
});

test('no-child age test: 25 through 64 only (born after 1960-12-31 and before 2001-01-02)', () => {
  const at = (dob: string) =>
    eic(
      eicFacts({
        w2s: [w2('w2_1', 1200000)],
        taxpayer: { id: 'taxpayer', dateOfBirth: dob },
      })
    );
  assert.equal(at('2001-01-01'), 542); // 25 at the end of 2025
  assert.equal(at('2001-01-02'), 0); // 24
  assert.equal(at('1961-01-01'), 542); // 64
  assert.equal(at('1960-12-31'), 0); // 65
  // MFJ: either spouse in the age range is enough.
  const mfj = eicFacts({
    filingStatus: 'mfj',
    taxpayer: { id: 'taxpayer', dateOfBirth: '2003-01-01' },
    spouse: {
      id: 'spouse',
      dateOfBirth: '1990-01-01',
      hasValidSsn: true,
      livedInUsOverHalfYear: true,
    },
    w2s: [w2('w2_1', 1200000)],
  });
  assert.equal(eic(mfj), 649); // MFJ, no child, 12,000: row 12,000-12,050 = 649
});

test('AGI above the threshold with other income: smaller of the two lookups', () => {
  // Single, one child: earned 20,000 -> 4,328; AGI 25,000 (>= 23,350) -> 4,060.
  const f = eicFacts({
    dependents: [kid('dependent_1', '2018-04-01')],
    filingStatus: 'hoh',
    w2s: [w2('w2_1', 2000000)],
    int1099s: [int1099('int_1', 500000)],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes['eic.creditOnEarnedIncome']?.value, 4328);
  assert.equal(r.nodes['eic.creditOnAgi']?.value, 4060);
  assert.equal(r.nodes.eic?.value, 4060);
});

test('investment income over $11,950 -> no EIC', () => {
  const base = {
    dependents: [kid('dependent_1', '2018-04-01')],
    filingStatus: 'hoh' as const,
    w2s: [w2('w2_1', 1500000)],
  };
  assert.equal(
    eic(eicFacts({ ...base, int1099s: [int1099('int_1', 1195000)] })) > 0,
    true
  );
  assert.equal(
    eic(eicFacts({ ...base, int1099s: [int1099('int_1', 1195100)] })),
    0
  );
});

test('filer SSN, US home, qualifying child of another, dependent filer', () => {
  const kidCase = {
    filingStatus: 'hoh' as const,
    dependents: [kid('dependent_1', '2018-04-01')],
    w2s: [w2('w2_1', 2000000)],
  };
  assert.equal(
    eic(
      eicFacts({ ...kidCase, taxpayer: { id: 'taxpayer', hasValidSsn: false } })
    ),
    0
  );
  assert.equal(
    eic(
      eicFacts({
        ...kidCase,
        taxpayer: { id: 'taxpayer', qualifyingChildOfAnother: true },
      })
    ),
    0
  );
  // Child must live with you in the US; abroad -> no qualifying child; no-child rules then need a US home too.
  assert.equal(
    eic(
      eicFacts({
        ...kidCase,
        taxpayer: { id: 'taxpayer', livedInUsOverHalfYear: false },
      })
    ),
    0
  );
  const noKid = { w2s: [w2('w2_1', 1200000)] };
  assert.equal(
    eic(
      eicFacts({
        ...noKid,
        taxpayer: { id: 'taxpayer', canBeClaimedAsDependent: true },
      })
    ),
    0
  );
});

test('qualifying child tests for the EIC differ from the CTC: no support test, age 19-23 students, younger than you', () => {
  const one = (d: Dependent, filingStatus: 'hoh' | 'single' = 'hoh') =>
    computeReturn(
      eicFacts({ filingStatus, dependents: [d], w2s: [w2('w2_1', 2000000)] })
    ).nodes['eic.qualifyingChildren']?.value;
  assert.equal(
    one(kid('dependent_1', '2018-01-01', { providedOverHalfOwnSupport: true })),
    1
  );
  assert.equal(
    one(kid('dependent_1', '2005-06-01', { fullTimeStudent: true })),
    1
  ); // 20, student
  assert.equal(
    one(kid('dependent_1', '2005-06-01', { fullTimeStudent: false })),
    0
  );
  assert.equal(
    one(
      kid('dependent_1', '1980-06-01', {
        relationship: 'sibling',
        permanentlyDisabled: true,
      })
    ),
    1
  );
  // A 22-year-old student sibling older than the filer (born 2004) is not a qualifying child.
  const f = eicFacts({
    filingStatus: 'hoh',
    taxpayer: { id: 'taxpayer', dateOfBirth: '2004-01-01' },
    dependents: [
      kid('dependent_1', '2003-06-01', {
        relationship: 'sibling',
        fullTimeStudent: true,
      }),
    ],
    w2s: [w2('w2_1', 2000000)],
  });
  assert.equal(computeReturn(f).nodes['eic.qualifyingChildren']?.value, 0);
  assert.equal(
    one(kid('dependent_1', '2018-01-01', { monthsLivedWithTaxpayer: 6 })),
    0
  );
  assert.equal(
    one(kid('dependent_1', '2018-01-01', { relationship: 'parent' })),
    0
  );
});

test('a qualifying child without a valid SSN: self-only EIC under the no-child rules', () => {
  const f = eicFacts({
    filingStatus: 'hoh',
    dependents: [kid('dependent_1', '2018-04-01', { hasValidSsn: false })],
    w2s: [w2('w2_1', 1200000)],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes['eic.qualifyingChildren']?.value, 0);
  assert.equal(r.nodes.eic?.value, 542); // HoH uses the single/HoH column, no child
  assert.ok(r.forms.includes('schEIC')); // the child is still listed on Schedule EIC
});

test('self-employed earned income: net SE earnings less half of SE tax (Worksheet B)', () => {
  // NEC 10,000: SE tax 1,413, deduction 707, earned income 9,293 = AGI -> row 9,250-9,300 = 649.
  const f = eicFacts({
    nec1099s: [nec('nec_1', 1000000)],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
  });
  const r = computeReturn(f);
  assert.equal(r.nodes.earnedIncome?.value, 9293);
  assert.equal(r.nodes.eic?.value, 649);
});

test('Schedule EIC rows: child number, dependent trace, months lived', () => {
  const f = eicFacts({
    filingStatus: 'hoh',
    dependents: [
      kid('dependent_1', '2018-04-01', { monthsLivedWithTaxpayer: 8 }),
      kid('dependent_2', '2005-02-01', { fullTimeStudent: true }),
    ],
    w2s: [w2('w2_1', 2500000)],
  });
  const n = computeReturn(f).nodes;
  assert.equal(n['schEIC.yearOfBirth.dependent_1']?.line, '3:1');
  assert.equal(n['schEIC.yearOfBirth.dependent_1']?.value, 2018);
  assert.equal(n['schEIC.monthsLived.dependent_1']?.value, 8);
  assert.equal(n['schEIC.monthsLived.dependent_1']?.line, '6:1');
  assert.ok(
    n['schEIC.monthsLived.dependent_1']!.trace.inputs.some((i) =>
      i.ref.startsWith('dependents[dependent_1]')
    )
  );
  // Born after 2006 and younger than you: lines 4a/4b skipped.
  assert.equal(n['schEIC.student.dependent_1'], undefined);
  assert.equal(n['schEIC.student.dependent_2']?.line, '4a:2');
  assert.equal(n['schEIC.student.dependent_2']?.value, 1);
  assert.equal(n['schEIC.disabled.dependent_2'], undefined);
  assert.equal(n['schEIC.relationship.dependent_2']?.line, '5:2');
});

test('EIC questions are asked only when the credit is possible', () => {
  const low = makeFacts({ w2s: [w2('w2_1', 1200000)] });
  const paths = requiredFacts(low).map((m) => m.path);
  for (const p of [
    'taxpayer.livedInUsOverHalfYear',
    'taxpayer.qualifyingChildOfAnother',
    'eitc.priorDisallowance',
  ])
    assert.ok(paths.includes(p), p);
  const high = makeFacts({ w2s: [w2('w2_1', 9000000)] });
  const hp = requiredFacts(high).map((m) => m.path);
  assert.ok(!hp.includes('eitc.priorDisallowance'));
  assert.ok(!hp.includes('taxpayer.livedInUsOverHalfYear'));
  // Without a qualifying child the date of birth becomes blocking.
  const noDob = makeFacts({ w2s: [w2('w2_1', 1200000)] });
  delete noDob.taxpayer.dateOfBirth;
  assert.equal(
    requiredFacts(noDob).find((m) => m.path === 'taxpayer.dateOfBirth')
      ?.blocking,
    true
  );
});

test('ACTC Part II-B subtracts the EIC (Schedule 8812 line 24)', () => {
  // HoH, 3 children, wages 25,000: 16b = 5,100 -> Part II-B considered; line 25 = 1,913 + 0 - EIC < 0 -> 0,
  // so 27 = min(17, line 20 = 15% x 22,500 = 3,375).
  const f = eicFacts({
    filingStatus: 'hoh',
    dependents: [
      kid('dependent_1', '2014-01-01'),
      kid('dependent_2', '2016-01-01'),
      kid('dependent_3', '2018-01-01'),
    ],
    w2s: [w2('w2_1', 2500000)],
  });
  const n = computeReturn(f).nodes;
  assert.equal(n.eic?.value, 7693); // row 25,000-25,050, HoH 3 children
  assert.equal(n.actc?.value, 3375);
});
