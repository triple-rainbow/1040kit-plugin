import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { SUMMARY_NODE_IDS, type TaxFacts } from '../src/types.ts';
import { div1099, int1099, makeFacts, w2 } from './helpers.ts';

const value = (r: ReturnType<typeof computeReturn>, id: string) => {
  const node = r.nodes[id];
  assert.ok(node, `node ${id} exists`);
  return node.value;
};

test('adds cents before rounding: two W-2s of $1,000.40 -> line 1a $2,001', () => {
  const r = computeReturn(
    makeFacts({ w2s: [w2('w2_1', 100040), w2('w2_2', 100040)] })
  );
  assert.equal(value(r, 'wages'), 2001);
  assert.equal(r.nodes.wages?.form, 'f1040');
  assert.equal(r.nodes.wages?.line, '1a');
});

test('trace names the facts', () => {
  const r = computeReturn(
    makeFacts({ w2s: [w2('w2_1', 100040), w2('w2_2', 100040)] })
  );
  const refs = r.nodes.wages?.trace.inputs.map((i) => i.ref) ?? [];
  assert.ok(refs.includes('w2s[w2_1].wages'));
  assert.ok(refs.includes('w2s[w2_2].wages'));
  const input = r.nodes.wages?.trace.inputs.find(
    (i) => i.ref === 'w2s[w2_1].wages'
  );
  assert.equal(input?.kind, 'fact');
  assert.equal(input?.value, 100040);
  assert.ok((r.nodes.wages?.citations.length ?? 0) > 0);
  // a derived node lists node inputs
  const agiRefs = r.nodes.agi?.trace.inputs
    .filter((i) => i.kind === 'node')
    .map((i) => i.ref);
  assert.ok(agiRefs?.includes('totalIncome'));
});

test('qualified dividends taxed at 0/15% (QDCG worksheet)', () => {
  // Single, wages 60,000, qualified (= ordinary) dividends 5,000.
  // Taxable income = 65,000 - 15,750 = 49,250.
  // QDCG worksheet (i1040gi line 16, 2025):
  //  1) 49,250  2) 5,000  3) 0  4) 5,000  5) 44,250  6) 48,350  7) 48,350
  //  8) 44,250  9) 4,100 (0%)  10) 5,000  11) 4,100  12) 900  13) 533,400
  // 14) 49,250 15) 48,350 16) 900 17) 900 18) 135 19) 5,000 20) 0 21) 0
  // 22) Tax Table on 44,250 (single) = 5,075   23) 5,210
  // 24) Tax Table on 49,250 = 5,755           25) min = 5,210
  const r = computeReturn(
    makeFacts({
      w2s: [w2('w2_1', 6000000)],
      div1099s: [div1099('div_1', 500000, 500000)],
    })
  );
  assert.equal(value(r, 'taxableIncome'), 49250);
  assert.equal(value(r, 'tax'), 5210);
});

test('capital gain distributions go on line 7a and use the QDCG worksheet', () => {
  const r = computeReturn(
    makeFacts({
      w2s: [w2('w2_1', 6000000)],
      div1099s: [div1099('div_1', 0, 0, { capitalGainDistributions: 500000 })],
    })
  );
  assert.equal(value(r, 'capitalGainDistributions'), 5000);
  assert.equal(r.nodes.capitalGainDistributions?.line, '7a');
  assert.equal(value(r, 'tax'), 5210);
});

test('schedule B threshold: interest $1,500.00 excludes schB, $1,500.01 includes it', () => {
  const at = computeReturn(
    makeFacts({
      w2s: [w2('w2_1', 3000000)],
      int1099s: [int1099('int_1', 150000)],
    })
  );
  assert.ok(!at.forms.includes('schB'));
  const over = computeReturn(
    makeFacts({
      w2s: [w2('w2_1', 3000000)],
      int1099s: [int1099('int_1', 150001)],
    })
  );
  assert.ok(over.forms.includes('schB'));
  assert.ok(over.forms.includes('f1040'));
});

test('65+ adds to standard deduction: single born 1960-01-01 -> 17,750', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 3000000)] });
  f.taxpayer.dateOfBirth = '1960-01-01';
  const r = computeReturn(f);
  assert.equal(value(r, 'standardDeduction'), 17750);
});

test('born 1961-01-02 is not 65 for 2025 (born before January 2, 1961 rule)', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 3000000)] });
  f.taxpayer.dateOfBirth = '1961-01-02';
  assert.equal(value(computeReturn(f), 'standardDeduction'), 15750);
  f.taxpayer.dateOfBirth = '1961-01-01';
  assert.equal(value(computeReturn(f), 'standardDeduction'), 17750);
});

test('MFJ both 65 and one blind -> 36,300 (i1040gi chart)', () => {
  const f = makeFacts({
    filingStatus: 'mfj',
    spouse: {
      id: 'spouse',
      dateOfBirth: '1955-03-03',
      blind: true,
      hasValidSsn: true,
    },
    w2s: [w2('w2_1', 3000000)],
  });
  f.taxpayer.dateOfBirth = '1950-01-01';
  assert.equal(value(computeReturn(f), 'standardDeduction'), 36300);
});

test('dependent standard deduction: greater of 1,350 or earned income + 450', () => {
  const f = makeFacts({ w2s: [w2('w2_1', 400000)] });
  f.taxpayer.canBeClaimedAsDependent = true;
  assert.equal(value(computeReturn(f), 'standardDeduction'), 4450);
  const g = makeFacts({ int1099s: [int1099('int_1', 50000)] });
  g.taxpayer.canBeClaimedAsDependent = true;
  assert.equal(value(computeReturn(g), 'standardDeduction'), 1350);
});

test('withholding, refund and amount owed', () => {
  const r = computeReturn(
    makeFacts({
      w2s: [w2('w2_1', 5000000, 700000)],
      int1099s: [int1099('int_1', 10000, { federalWithheld: 1000 })],
      payments: { estimatedTaxPayments: 50000 },
    })
  );
  assert.equal(value(r, 'withholdingW2'), 7000);
  assert.equal(value(r, 'withholding1099'), 10);
  assert.equal(value(r, 'totalWithholding'), 7010);
  assert.equal(value(r, 'estimatedPayments'), 500);
  assert.equal(r.summary.totalPayments, 7510);
  assert.equal(r.summary.refundOrOwed, 7510 - r.summary.totalTax);
  assert.ok(r.summary.refundOrOwed > 0);
  assert.equal(value(r, 'overpaid'), r.summary.refundOrOwed);
  assert.equal(value(r, 'amountOwed'), 0);
});

test('taxable income never negative', () => {
  const r = computeReturn(makeFacts({ w2s: [w2('w2_1', 500000)] }));
  assert.equal(value(r, 'taxableIncome'), 0);
  assert.equal(value(r, 'tax'), 0);
});

test('every result contains SUMMARY_NODE_IDS, even when zero', () => {
  for (const facts of [
    makeFacts(),
    makeFacts({ w2s: [w2('w2_1', 5000000, 400000)] }),
  ]) {
    const r = computeReturn(facts);
    for (const id of SUMMARY_NODE_IDS) {
      assert.ok(r.nodes[id], `node ${id}`);
    }
    assert.equal(r.nodes.refundOrOwed?.value, r.summary.refundOrOwed);
    assert.equal(r.nodes.deductions?.value, r.summary.deductions);
    assert.equal(r.nodes.totalPayments?.value, r.summary.totalPayments);
  }
});

test('computeReturn never throws on empty facts', () => {
  // Facts saved before e1098s/rentals were added to the contract still compute.
  const r = computeReturn({
    taxYear: 2025,
    taxpayer: { id: 'taxpayer' },
    dependents: [],
    w2s: [],
    int1099s: [],
    div1099s: [],
    nec1099s: [],
    misc1099s: [],
    k1099s: [],
    businesses: [],
  } as unknown as TaxFacts);
  assert.equal(r.taxYear, 2025);
  assert.equal(r.summary.refundOrOwed, 0);
});
