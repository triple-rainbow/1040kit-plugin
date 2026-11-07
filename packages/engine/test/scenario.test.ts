import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { compareScenarios, deepMerge } from '../src/rules/scenario.ts';
import { makeFacts, nec, w2 } from './helpers.ts';

test('sep scenario reduces tax', () => {
  const f = makeFacts({
    nec1099s: [nec('nec_1', 9000000)],
    businesses: [{ owner: 'taxpayer', expenses: {} }],
  });
  const base = computeReturn(f);
  const [s] = compareScenarios(f, [
    {
      name: 'SEP $10,000',
      patch: { adjustments: { sepContributions: { taxpayer: 1000000 } } },
    },
  ]);
  assert.ok(s);
  assert.equal(s.name, 'SEP $10,000');
  assert.ok(s.delta.refundOrOwed > 0);
  assert.ok(s.delta.totalTax < 0);
  assert.equal(
    s.delta.refundOrOwed,
    s.summary.refundOrOwed - base.summary.refundOrOwed
  );
  // the input facts are not mutated
  assert.equal(f.adjustments, undefined);
});

test('deep merge: objects merge, arrays replace', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 100), w2('w2_2', 200)] });
  const m = deepMerge(f, { w2s: [w2('w2_9', 300)], taxpayer: { blind: true } });
  assert.equal(m.w2s.length, 1);
  assert.equal(m.w2s[0]!.id, 'w2_9');
  assert.equal(m.taxpayer.blind, true);
  assert.equal(m.taxpayer.dateOfBirth, f.taxpayer.dateOfBirth);
  assert.equal(f.w2s.length, 2);
});

test('empty scenario has zero delta', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 5000000, 400000)] });
  const [s] = compareScenarios(f, [{ name: 'same', patch: {} }]);
  assert.deepEqual(s!.delta, { refundOrOwed: 0, totalTax: 0 });
});
