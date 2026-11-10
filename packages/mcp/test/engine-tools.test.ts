import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type {
  FormId,
  LineNode,
  MissingFact,
  ReturnResult,
  TaxFacts,
} from '@1040kit/engine';

import { openStore } from '../src/store/workspace.ts';
import { handler as calcReturn } from '../src/tools/calc-return.ts';
import { handler as deductionsFind } from '../src/tools/deductions-find.ts';
import { handler as docsExtract } from '../src/tools/docs-extract.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as explainLine } from '../src/tools/explain-line.ts';
import { handler as interviewNext } from '../src/tools/interview-next.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as reviewChecks } from '../src/tools/review-checks.ts';
import { handler as scenarioCompare } from '../src/tools/scenario-compare.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { w2Pdf } from './fixtures/make-pdfs.ts';
import {
  emptySummary,
  fakeDeps,
  fakeEngine,
  fakeResult,
  freshEnv,
  type TestEnv,
} from './helpers.ts';

let env: TestEnv;
let ws: string;

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025, acknowledged: true }, fakeDeps());
  assert.ok(r.ok);
  ws = r.workspace;
});
afterEach(() => env.cleanup());

function node(
  id: string,
  value: number,
  extra: Partial<LineNode> = {},
  inputs: LineNode['trace']['inputs'] = []
): LineNode {
  return {
    id,
    label: id,
    value,
    trace: { formula: `formula of ${id}`, inputs },
    citations: [
      {
        docId: 'i1040gi',
        section: 'Line 1a',
        url: 'https://www.irs.gov/instructions/i1040gi',
      },
    ],
    ...extra,
  };
}

function resultWithLines(facts: TaxFacts): ReturnResult {
  const n = (
    id: string,
    v: number,
    extra: Partial<LineNode> = {},
    refs: string[] = [],
    facts: string[] = []
  ) =>
    node(id, v, extra, [
      ...refs.map((ref) => ({ ref, kind: 'node' as const, value: 0 })),
      ...facts.map((ref) => ({ ref, kind: 'fact' as const, value: 1 })),
    ]);
  const nodes: Record<string, LineNode> = {
    wages: n(
      'wages',
      52346,
      { form: 'f1040', line: '1a' },
      [],
      ['w2s[w2_1].wages']
    ),
    interest: n('interest', 1235, { form: 'f1040', line: '2b' }),
    totalIncome: n('totalIncome', 53581, { form: 'f1040', line: '9' }, [
      'wages',
      'interest',
    ]),
    agi: n('agi', 53581, { form: 'f1040', line: '11' }, ['totalIncome']),
    standardDeduction: n('standardDeduction', 15750, {
      form: 'f1040',
      line: '12',
    }),
    deductions: n('deductions', 15750, {}, ['standardDeduction']),
    taxableIncome: n('taxableIncome', 37831, { form: 'f1040', line: '15' }, [
      'agi',
      'deductions',
    ]),
    tax: n('tax', 4300, { form: 'f1040', line: '16' }, ['taxableIncome']),
    totalTax: n('totalTax', 4300, { form: 'f1040', line: '24' }, ['tax']),
    withholding: n(
      'withholding',
      6123,
      { form: 'f1040', line: '25a' },
      [],
      ['w2s[w2_1].federalWithheld']
    ),
    totalPayments: n('totalPayments', 6123, { form: 'f1040', line: '33' }, [
      'withholding',
    ]),
    refundOrOwed: n('refundOrOwed', 1823, { form: 'f1040', line: '34' }, [
      'totalPayments',
      'totalTax',
    ]),
    unused: n('unused', 999999),
  };
  return fakeResult(facts, {
    nodes,
    summary: { ...emptySummary(), refundOrOwed: 1823 },
  });
}

test('interview_next skips answered facts', async () => {
  const missing: MissingFact[] = [
    {
      path: 'filingStatus',
      question: 'What is your filing status?',
      why: 'x',
      blocking: true,
      priority: 1,
    },
    {
      path: 'taxpayer.dateOfBirth',
      question: 'When were you born?',
      why: 'x',
      blocking: false,
      priority: 2,
    },
    {
      path: 'dependents[dependent_1].dateOfBirth',
      question: 'Child DOB?',
      why: 'x',
      blocking: true,
      priority: 3,
    },
  ];
  const deps = fakeDeps({
    engine: fakeEngine({ requiredFacts: () => missing }),
  });
  await profileSet(
    {
      workspace: ws,
      set: [
        { path: 'filingStatus', value: 'single', source: 'user' },
        ...[
          ['identity.taxpayer.firstName', 'Pat'],
          ['identity.taxpayer.lastName', 'Example'],
          ['identity.address.street', '1 Main St'],
          ['identity.address.city', 'Austin'],
          ['identity.address.state', 'TX'],
          ['identity.address.zip', '78701'],
        ].map(([path, value]) => ({
          path: path!,
          value: value!,
          source: 'user' as const,
        })),
      ],
    },
    deps
  );
  const r = await interviewNext({ workspace: ws, limit: 1 }, deps);
  assert.ok(r.ok);
  assert.deepEqual(
    r.questions.map((q) => q.path),
    ['dependents[dependent_1].dateOfBirth']
  );
  assert.equal(r.done, false);
  assert.equal(r.remaining, 2);
  const none = await interviewNext({ workspace: ws }, fakeDeps());
  assert.ok(none.ok && none.done);
});

test('calc_return returns lines without traces', async () => {
  const deps = fakeDeps({
    engine: fakeEngine({ computeReturn: resultWithLines }),
  });
  const r = await calcReturn({ workspace: ws }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.complete, true);
  assert.equal(r.lines[0]!.id, 'wages');
  assert.deepEqual(r.lines[0], {
    id: 'wages',
    form: 'f1040',
    line: '1a',
    label: 'wages',
    value: 52346,
  });
  assert.deepEqual(
    r.lines.map((l) => l.line),
    ['1a', '2b', '9', '11', '12', '15', '16', '24', '25a', '33', '34']
  );
  assert.ok(!JSON.stringify(r).includes('trace'));
  // drivers: walk from refundOrOwed, skip summary nodes, largest |value| first
  assert.deepEqual(
    r.drivers.map((d) => d.id),
    ['wages', 'standardDeduction', 'withholding']
  );
  const d = await (await openStore(ws)).read();
  assert.ok(d.lastCalc?.factsHash);
});

test('engine failure is a soft error', async () => {
  const r = await calcReturn(
    { workspace: ws },
    fakeDeps({
      engine: fakeEngine({
        computeReturn: () => {
          throw new Error('not implemented');
        },
      }),
    })
  );
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.code, 'ENGINE_ERROR');
});

test('explain_line annotates provenance', async () => {
  await writeFile(join(ws, 'inbox', 'my-w2.pdf'), await w2Pdf());
  await docsScan({ workspace: ws }, fakeDeps());
  await docsExtract({ workspace: ws }, fakeDeps());
  const deps = fakeDeps({
    engine: fakeEngine({
      computeReturn: resultWithLines,
      explainLine: (result, ref) => {
        const id = ref === 'f1040:1a' ? 'wages' : ref;
        const n = result.nodes[id];
        return n ? { node: n, children: [] } : null;
      },
    }),
  });
  const r = await explainLine({ workspace: ws, ref: 'f1040:1a' }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  const input = (r.explanation as any).node.trace.inputs[0];
  assert.equal(input.ref, 'w2s[w2_1].wages');
  assert.equal(input.provenance.source, 'doc');
  assert.equal(input.provenance.file, 'my-w2.pdf');
  assert.equal(input.provenance.text, 'from my-w2.pdf (box1)');
  assert.equal((r.explanation as any).node.citations[0].docId, 'i1040gi');

  await profileSet(
    {
      workspace: ws,
      set: [{ path: 'w2s[w2_1].wages', value: 5000000, source: 'user' }],
    },
    deps
  );
  const r2 = await explainLine({ workspace: ws, ref: 'wages' }, deps);
  assert.ok(r2.ok);
  assert.equal(
    (r2.explanation as any).node.trace.inputs[0].provenance.text,
    'you told me (replacing the document value)'
  );

  const unknown = await explainLine({ workspace: ws, ref: 'f1040:99' }, deps);
  assert.equal(!unknown.ok && unknown.error.code, 'UNKNOWN_LINE');
});

test('deductions, review and scenarios use the documented keys', async () => {
  let priorSeen: unknown = 'unset';
  const deps = fakeDeps({
    engine: fakeEngine({
      findDeductions: () => [
        {
          id: 'tips',
          title: 'No tax on tips',
          eligibility: 'tips reported on W-2',
          question: 'Did you receive tips?',
          docsNeeded: ['W-2'],
          estimatedSavings: 120,
          status: 'possible',
          citations: [],
          factPaths: ['obbba.qualifiedTips.taxpayer'],
        },
      ],
      reviewChecks: (_f, _r, prior) => {
        priorSeen = prior;
        return [
          {
            severity: 'warning',
            code: 'ss_tax_mismatch',
            message: 'm',
            nodeIds: [],
          },
        ];
      },
      compareScenarios: (_f, sc) =>
        sc.map((s) => ({
          name: s.name,
          summary: emptySummary(),
          complete: true,
          delta: { refundOrOwed: 500, totalTax: -500 },
        })),
    }),
  });
  const d = await deductionsFind({ workspace: ws }, deps);
  assert.ok(d.ok);
  assert.equal(
    d.opportunities[0]!.factPaths![0],
    'obbba.qualifiedTips.taxpayer'
  );
  const rc = await reviewChecks({ workspace: ws }, deps);
  assert.ok(rc.ok);
  assert.equal(rc.findings[0]!.code, 'ss_tax_mismatch');
  assert.equal(priorSeen, undefined);
  const s = await scenarioCompare(
    {
      workspace: ws,
      scenarios: [
        {
          name: 'SEP',
          patch: { adjustments: { sepContributions: { taxpayer: 500000 } } },
        },
      ],
    },
    deps
  );
  assert.ok(s.ok, JSON.stringify(s));
  assert.deepEqual(s.base, emptySummary());
  assert.equal(s.scenarios[0]!.delta.refundOrOwed, 500);
});

test('calc_return lists only non-zero lines on forms that are on the return', async () => {
  const deps = fakeDeps({
    engine: fakeEngine({
      computeReturn: (facts) => {
        const r = resultWithLines(facts);
        const extra = (id: string, form: FormId, line: string, value: number) =>
          (r.nodes[id] = {
            ...r.nodes.wages!,
            id,
            form,
            line,
            label: id,
            value,
          });
        extra('zeroLine', 'f1040', '6b', 0);
        extra('seniorCap', 'sch1a', '37', 6000); // sch1a is not on this return
        return r;
      },
    }),
  });
  const r = await calcReturn({ workspace: ws }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  const ids = r.lines.map((l) => l.id);
  assert.ok(!ids.includes('zeroLine'));
  assert.ok(!ids.includes('seniorCap'));
  assert.ok(ids.includes('wages'));
});
