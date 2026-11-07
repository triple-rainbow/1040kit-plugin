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
  const init = await call('workspace_init', { year: 2025 });
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
