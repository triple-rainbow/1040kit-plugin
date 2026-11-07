/**
 * i1040gi qualifying child: a half/step sibling or a descendant of a sibling
 * (niece, nephew) counts the same as a child for HoH, the CTC and the EIC.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { engine } from '../src/index.ts';
import type { Dependent, TaxFacts } from '../src/types.ts';

const base = JSON.parse(
  readFileSync(
    new URL('./golden/eitc-hoh-one-child.json', import.meta.url),
    'utf8'
  )
).facts as TaxFacts;

const withRelationship = (r: Dependent['relationship']): TaxFacts => ({
  ...base,
  dependents: base.dependents.map((d) => ({ ...d, relationship: r })),
});

const asChild = engine.computeReturn(withRelationship('child'));

for (const r of ['niece_nephew', 'half_sibling', 'step_sibling'] as const) {
  test(`a ${r} counts as a qualifying child (HoH, CTC, EIC)`, () => {
    const result = engine.computeReturn(withRelationship(r));
    assert.equal(result.complete, true, JSON.stringify(result.unsupported));
    assert.deepEqual(result.summary, asChild.summary);
    assert.equal(result.nodes.eic?.value, asChild.nodes.eic?.value);
    assert.ok(result.forms.includes('schEIC'));
    assert.ok(result.forms.includes('sch8812'));
  });
}

test("'other' is not a qualifying child: no Schedule EIC", () => {
  const result = engine.computeReturn(withRelationship('other'));
  assert.ok(!result.forms.includes('schEIC'));
  assert.notDeepEqual(result.summary, asChild.summary);
});
