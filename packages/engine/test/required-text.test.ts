/**
 * The interview's words are what the user reads: short questions and plain
 * reasons. IRS references belong in `cite`, not in `why`.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { requiredFacts } from '../src/required.ts';
import type { MissingFact, TaxFacts } from '../src/types.ts';
import { makeFacts, nec, w2 } from './helpers.ts';

function strip(facts: TaxFacts): TaxFacts[] {
  // Each golden, and the same golden with its answers removed, to reach
  // as many questions as possible.
  return [
    facts,
    {
      ...facts,
      filingStatus: undefined,
      screening: undefined,
      outOfScope: undefined,
      digitalAssetActivity: undefined,
      dependents: facts.dependents.map((d) => ({ id: d.id })),
      rentals: (facts.rentals ?? []).map((r) => ({
        id: r.id,
        owner: r.owner,
        expenses: {},
      })),
    } as TaxFacts,
  ];
}

const dir = new URL('./golden/', import.meta.url);
const states: TaxFacts[] = [
  makeFacts(),
  makeFacts({ filingStatus: 'hoh' }),
  makeFacts({ filingStatus: 'single', screening: { hasDependents: true } }),
  makeFacts({
    filingStatus: 'single',
    w2s: [w2(1500000)],
    nec1099s: [nec(500000)],
    screening: { paidStudentLoanInterest: true },
  }),
  ...readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) =>
      strip(JSON.parse(readFileSync(new URL(f, dir), 'utf8')).facts)
    ),
];

const all = new Map<string, MissingFact>();
for (const facts of states)
  for (const m of requiredFacts(facts)) all.set(m.path + m.question, m);

test('interview questions are short', () => {
  assert.ok(all.size > 30, `only ${all.size} questions reached`);
  for (const m of all.values())
    assert.ok(m.question.length <= 140, `${m.question.length}: ${m.question}`);
});

test('explanations are plain English; IRS references go in cite', () => {
  const jargon =
    /\bv1\b|\bi1040\w*|\bPub\. \d|\bIRC\b|§|\bline \d|Form \d{4}|Schedule [A-Z1-9]\b/;
  for (const m of all.values())
    assert.ok(!jargon.test(m.why), `${m.path}: ${m.why}`);
});
