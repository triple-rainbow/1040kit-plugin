/** Head of household: offered (never applied) when a single filer has a qualifying person. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { findDeductions } from '../src/rules/deductions.ts';
import { reviewChecks } from '../src/rules/review.ts';
import type { Dependent, TaxFacts } from '../src/types.ts';

const golden = JSON.parse(
  readFileSync(
    new URL('./golden/single-freelance-sli-odc.json', import.meta.url),
    'utf8'
  )
) as { facts: TaxFacts };

const withDependent = (patch: Partial<Dependent>): TaxFacts => ({
  ...golden.facts,
  dependents: [{ ...golden.facts.dependents[0]!, ...patch }],
});

const hoh = (f: TaxFacts) =>
  findDeductions(f, computeReturn(f)).find((o) => o.id === 'head_of_household');
const warned = (f: TaxFacts) =>
  reviewChecks(f, computeReturn(f)).some(
    (x) => x.code === 'head_of_household_may_apply'
  );

test('single with a child who lived with them all year: head of household offered with its savings', () => {
  const o = hoh(golden.facts);
  assert.ok(o);
  assert.equal(o.status, 'possible');
  // HoH turns $510 owed into a $534 refund (standard deduction 23,625, HoH brackets).
  assert.equal(o.estimatedSavings, 1044);
  assert.deepEqual(o.factPaths, ['filingStatus']);
  assert.ok(warned(golden.facts));
});

test('already head of household: claimed, no review warning', () => {
  const f: TaxFacts = { ...golden.facts, filingStatus: 'hoh' };
  assert.equal(hoh(f)?.status, 'claimed');
  assert.equal(warned(f), false);
});

test('no qualifying person: not offered', () => {
  for (const patch of [
    { monthsLivedWithTaxpayer: 5 },
    { relationship: 'other' as const },
  ]) {
    const f = withDependent(patch);
    assert.equal(hoh(f), undefined, JSON.stringify(patch));
    assert.equal(warned(f), false);
  }
  assert.equal(hoh({ ...golden.facts, dependents: [] }), undefined);
});

test('a dependent parent qualifies without living with the filer', () => {
  const f = withDependent({
    relationship: 'parent',
    dateOfBirth: '1955-01-01',
    monthsLivedWithTaxpayer: 0,
    grossIncome: 0,
  });
  assert.equal(hoh(f)?.status, 'possible');
});
