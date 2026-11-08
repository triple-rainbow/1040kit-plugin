/**
 * MCP Apps interview widget: interview_next advertises it, the resource is a
 * self-contained page, and every value its chips can send is one profile_set
 * accepts (the chips are built from the same schema).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { defaultDeps } from '../src/deps.ts';
import { createServer } from '../src/server.ts';
import { answerSpec, type AnswerSpec } from '../src/ui/answers.ts';
import { INTERVIEW_WIDGET_URI } from '../src/ui/interview-widget.ts';
import { freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let client: Client;

before(async () => {
  env = await freshEnv();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(defaultDeps()).connect(a);
  client = new Client({ name: 'widget-test', version: '0.0.0' });
  await client.connect(b);
});

after(async () => {
  await client?.close();
  await env.cleanup();
});

const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  return r.structuredContent as Record<string, any>;
};

test('interview_next points at the widget; other tools do not', async () => {
  const { tools } = await client.listTools();
  const next = tools.find((t) => t.name === 'interview_next')!;
  assert.equal(
    (next._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri,
    INTERVIEW_WIDGET_URI
  );
  for (const t of tools.filter((t) => t.name !== 'interview_next'))
    assert.equal(
      (t._meta as { ui?: unknown } | undefined)?.ui,
      undefined,
      t.name
    );
});

test('the widget resource is one self-contained HTML page', async () => {
  const r = await client.readResource({ uri: INTERVIEW_WIDGET_URI });
  const page = r.contents[0]!;
  assert.equal(page.mimeType, RESOURCE_MIME_TYPE);
  const html = (page as { text: string }).text;
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(
    html.includes('globalThis.McpApps={'),
    'runtime inlined as a global'
  );
  assert.ok(
    !/export\s*\{[^}]*\}\s*;?\s*<\/script>/.test(html),
    'no ESM export left'
  );
  // No network: no external scripts, styles or fetches.
  assert.ok(!/<(script|link)[^>]+(src|href)=["']?https?:/i.test(html));
  assert.ok(!/fetch\(\s*['"]https?:/.test(html));
  // Untrusted text is never parsed as HTML.
  assert.ok(!html.includes('innerHTML'));
});

function chipValues(a: AnswerSpec): unknown[] {
  if (a.kind === 'yesno') return [true, false];
  if (a.kind === 'choice') return a.options.map((o) => o.value);
  if (a.kind === 'number' && a.min !== undefined && a.max !== undefined)
    return [a.min, a.max];
  return [];
}

test('every chip value is accepted by profile_set', async () => {
  const init = await call('workspace_init', { year: 2025, acknowledged: true });
  const ws = init.workspace as string;
  await call('profile_set', {
    workspace: ws,
    set: [
      {
        path: 'dependents[dependent_1].dateOfBirth',
        value: '2019-06-01',
        source: 'user',
      },
    ],
  });
  const next = await call('interview_next', { workspace: ws, limit: 20 });
  assert.equal(next.workspace, ws);
  const withChips = (
    next.questions as { path: string; answer: AnswerSpec }[]
  ).filter((q) => chipValues(q.answer).length > 0);
  assert.ok(
    withChips.length >= 4,
    JSON.stringify(next.questions.map((q: any) => q.path))
  );
  for (const q of withChips) {
    for (const value of chipValues(q.answer)) {
      const r = await call('profile_set', {
        workspace: ws,
        set: [{ path: q.path, value, source: 'user' }],
      });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(r.rejected, [], `${q.path} = ${JSON.stringify(value)}`);
    }
  }
});

test('answer types come from the facts schema', () => {
  assert.deepEqual(answerSpec('taxpayer.hasValidSsn'), { kind: 'yesno' });
  assert.deepEqual(answerSpec('taxpayer.dateOfBirth'), { kind: 'date' });
  assert.deepEqual(answerSpec('dependents[dependent_2].grossIncome'), {
    kind: 'amount',
  });
  assert.deepEqual(
    answerSpec('dependents[dependent_1].monthsLivedWithTaxpayer'),
    {
      kind: 'number',
      min: 0,
      max: 12,
    }
  );
  const fs = answerSpec('filingStatus');
  assert.equal(fs.kind, 'choice');
  assert.deepEqual(fs.kind === 'choice' && fs.options.map((o) => o.label), [
    'Single',
    'Married filing jointly',
    'Head of household',
  ]);
  assert.deepEqual(answerSpec('dependents'), { kind: 'open' });
  assert.deepEqual(answerSpec('no.such.path'), { kind: 'open' });
});

test('situations come as one check-all-that-apply question, first', async () => {
  const init = await call('workspace_init', { year: 2025, acknowledged: true });
  const ws = init.workspace as string;
  const next = await call('interview_next', { workspace: ws, limit: 20 });
  assert.equal(next.phase, 'income');
  assert.equal(next.phaseTitle, 'You and your income');
  const paths = (next.questions as { path: string }[]).map((q) => q.path);
  assert.equal(paths[0], 'situations');
  assert.ok(
    !paths.some((p) =>
      /^(outOfScope|screening)\.|^digitalAssetActivity$/.test(p)
    ),
    JSON.stringify(paths)
  );
  const q = next.questions[0];
  assert.equal(q.answer.kind, 'multiselect');
  assert.equal(q.answer.options.length, 13);
  assert.equal(q.answer.other.path, 'outOfScope.other');

  // What the card saves: the checked ones true, the rest false, other as a list.
  const set = [
    ...q.answer.options.map((o: { path: string }) => ({
      path: o.path,
      value: o.path === 'screening.paidStudentLoanInterest',
      source: 'user',
    })),
    { path: 'outOfScope.other', value: [], source: 'user' },
  ];
  const r = await call('profile_set', { workspace: ws, set });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.rejected, []);
  const after = await call('interview_next', { workspace: ws, limit: 20 });
  assert.ok(
    !after.questions.some((x: { path: string }) => x.path === 'situations')
  );
});

test('deductions and credits come after income, with an intro', async () => {
  const init = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/low-income`,
    acknowledged: true,
  });
  const ws = init.workspace as string;
  const none = (
    await call('interview_next', { workspace: ws, limit: 20 })
  ).questions[0].answer.options.map((o: { path: string }) => ({
    path: o.path,
    value: false,
    source: 'user',
  }));
  const r = await call('profile_set', {
    workspace: ws,
    set: [
      ...none,
      { path: 'outOfScope.other', value: [], source: 'user' },
      { path: 'filingStatus', value: 'single', source: 'user' },
      { path: 'taxpayer.dateOfBirth', value: '1994-05-01', source: 'user' },
      {
        path: 'taxpayer.canBeClaimedAsDependent',
        value: false,
        source: 'user',
      },
      { path: 'taxpayer.hasValidSsn', value: true, source: 'user' },
      { path: 'w2s[w2_1].owner', value: 'taxpayer', source: 'user' },
      { path: 'w2s[w2_1].wages', value: 1800000, source: 'user' },
      { path: 'w2s[w2_1].federalWithheld', value: 90000, source: 'user' },
    ],
  });
  assert.deepEqual(r.rejected, [], JSON.stringify(r.rejected));
  const next = await call('interview_next', { workspace: ws, limit: 20 });
  assert.equal(
    next.phase,
    'deductions',
    JSON.stringify(next.questions.map((q: { path: string }) => q.path))
  );
  assert.equal(next.phaseTitle, 'Deductions and credits');
  assert.match(next.phaseIntro, /lowering your taxable income/);
  assert.ok(
    next.questions.some(
      (q: { path: string }) => q.path === 'eitc.priorDisallowance'
    )
  );
  assert.equal(next.remainingAfterThisPhase, 0);
});

test('nothing reads or asks before the start agreement', async () => {
  const init = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/no-ack`,
  });
  assert.equal(init.acknowledgment.agreed, false);
  assert.ok(init.acknowledgment.text.length > 0);
  const next = await call('interview_next', { workspace: init.workspace });
  assert.equal(next.ok, false);
  assert.equal(next.error.code, 'ACK_REQUIRED');
  const agreed = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/no-ack`,
    acknowledged: true,
  });
  assert.equal(agreed.acknowledgment.agreed, true);
  // Asking again later doesn't re-prompt.
  const again = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/no-ack`,
  });
  assert.equal(again.acknowledgment.agreed, true);
  assert.equal(again.acknowledgment.at, agreed.acknowledgment.at);
});
