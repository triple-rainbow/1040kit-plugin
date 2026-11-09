import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { explainLine } from '../src/explain.ts';
import { makeFacts, nec, w2 } from './helpers.ts';

const r = computeReturn(
  makeFacts({ w2s: [w2('w2_1', 100040), w2('w2_2', 100040)] })
);

test('explain by form line: "f1040:1a" -> wages with both W-2 inputs', () => {
  const e = explainLine(r, 'f1040:1a');
  assert.ok(e);
  assert.equal(e.node.id, 'wages');
  const refs = e.node.trace.inputs.map((i) => i.ref);
  assert.ok(refs.includes('w2s[w2_1].wages'));
  assert.ok(refs.includes('w2s[w2_2].wages'));
});

test('explain by node id with depth', () => {
  const e = explainLine(r, 'agi', 1);
  assert.ok(e);
  assert.equal(e.node.id, 'agi');
  assert.deepEqual(e.children.map((c) => c.node.id).sort(), [
    'adjustments',
    'totalIncome',
  ]);
  assert.ok(e.children.every((c) => c.children.length === 0));
  const deep = explainLine(r, 'agi');
  assert.ok(deep!.children.some((c) => c.children.length > 0)); // default depth 2
  const none = explainLine(r, 'agi', 0);
  assert.deepEqual(none!.children, []);
});

test('explain resolves lines that repeat a node (aliases)', () => {
  assert.equal(explainLine(r, 'f1040:11b')?.node.id, 'agi');
  assert.equal(explainLine(r, 'f1040:16')?.node.id, 'tax');
});

test('explain per-person schedule lines', () => {
  const se = computeReturn(
    makeFacts({
      nec1099s: [nec('nec_1', 5000000)],
      businesses: [{ owner: 'taxpayer', expenses: {} }],
    })
  );
  assert.equal(explainLine(se, 'schSE.taxpayer:12')?.node.id, 'seTax.taxpayer');
  assert.equal(
    explainLine(se, 'schC.taxpayer:31')?.node.id,
    'schC.netProfit.taxpayer'
  );
});

test('explain unknown is null', () => {
  assert.equal(explainLine(r, 'f1040:99z'), null);
  assert.equal(explainLine(r, 'noSuchNode'), null);
  assert.equal(explainLine(r, ''), null);
});

test('an alias line is explained as itself, with its own description', () => {
  const r = computeReturn(
    makeFacts({
      filingStatus: 'single',
      nec1099s: [nec('nec_1', 3000000)],
      businesses: [{ owner: 'taxpayer', name: 'Design', expenses: {} }],
    })
  );
  const e = explainLine(r, 'schC.taxpayer:5');
  assert.ok(e);
  assert.equal(e.node.line, '5');
  assert.equal(e.node.form, 'schC.taxpayer');
  assert.equal(e.node.label, 'Gross profit (line 3 minus line 4)');
  assert.equal(e.node.value, r.nodes['schC.grossIncome.taxpayer']!.value);
  const agi = explainLine(r, 'f1040:11b');
  assert.equal(agi?.node.line, '11b');
});
