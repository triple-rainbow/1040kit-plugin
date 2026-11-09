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

type Asked = {
  path: string;
  answer:
    | AnswerSpec
    | { kind: 'group'; fields: { path: string; answer: AnswerSpec }[] };
};
/** Top-level questions plus the fields of grouped ones. */
function flat(qs: Asked[]): { path: string; answer: AnswerSpec }[] {
  return qs.flatMap((q) =>
    q.answer.kind === 'group'
      ? q.answer.fields
      : [q as { path: string; answer: AnswerSpec }]
  );
}

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
  const withChips = flat(next.questions as Asked[]).filter(
    (q) => chipValues(q.answer).length > 0
  );
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

test('dependent questions use the first name once it is known', async () => {
  const init = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/named-dependent`,
    acknowledged: true,
  });
  const ws = init.workspace as string;
  await call('profile_set', {
    workspace: ws,
    set: [
      {
        path: 'dependents[dependent_1].dateOfBirth',
        value: '2019-06-01',
        source: 'user',
      },
      {
        path: 'identity.dependents[dependent_1].firstName',
        value: 'Robin',
        source: 'user',
      },
    ],
  });
  const next = await call('interview_next', { workspace: ws, limit: 20 });
  // Everything still open about Robin comes as one compact form.
  const card = next.questions.find(
    (q: { path: string }) => q.path === 'dependent:dependent_1'
  );
  assert.ok(
    card,
    JSON.stringify(next.questions.map((q: { path: string }) => q.path))
  );
  assert.equal(card.question, 'About Robin');
  assert.equal(card.answer.kind, 'group');
  assert.ok(card.answer.fields.length >= 3);
  assert.ok(
    card.answer.fields.every((f: { path: string }) =>
      f.path.startsWith('dependents[dependent_1].')
    )
  );
  assert.ok(
    !next.questions.some((q: { path: string }) =>
      q.path.startsWith('dependents[dependent_1].')
    )
  );
});

test('a new dependent is one compact form, with room for more people', async () => {
  const init = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/new-dependent`,
    acknowledged: true,
  });
  const ws = init.workspace as string;
  await call('profile_set', {
    workspace: ws,
    set: [
      { path: 'screening.hasDependents', value: true, source: 'user' },
      { path: 'filingStatus', value: 'single', source: 'user' },
    ],
  });
  const next = await call('interview_next', { workspace: ws, limit: 20 });
  const card = next.questions.find(
    (q: { path: string }) => q.path === 'dependents'
  );
  assert.ok(
    card,
    JSON.stringify(next.questions.map((q: { path: string }) => q.path))
  );
  assert.equal(card.answer.kind, 'group');
  const paths = card.answer.fields.map((f: { path: string }) => f.path);
  assert.deepEqual(paths, [
    'identity.dependents[dependent_1].firstName',
    'identity.dependents[dependent_1].lastName',
    'dependents[dependent_1].relationship',
    'dependents[dependent_1].dateOfBirth',
    'dependents[dependent_1].monthsLivedWithTaxpayer',
    'dependents[dependent_1].hasValidSsn',
    'dependents[dependent_1].providedOverHalfOwnSupport',
  ]);
  // The filer's own SSN is asked in the same round, not after.
  assert.ok(
    next.questions.some(
      (q: { path: string }) => q.path === 'taxpayer.hasValidSsn'
    )
  );
  assert.equal(card.answer.addAnother.nextIndex, 2);

  // What the form saves for two people is accepted as is.
  const person = (id: string, first: string) =>
    card.answer.addAnother.fields.map((f: { path: string }) => ({
      path: f.path.split('{id}').join(id),
      value: {
        firstName: first,
        lastName: 'Example',
        relationship: 'child',
        dateOfBirth: '2018-04-01',
        monthsLivedWithTaxpayer: 12,
        hasValidSsn: true,
        providedOverHalfOwnSupport: false,
      }[f.path.slice(f.path.lastIndexOf('.') + 1)],
      source: 'user',
    }));
  const r = await call('profile_set', {
    workspace: ws,
    set: [...person('dependent_1', 'Robin'), ...person('dependent_2', 'Sam')],
  });
  assert.deepEqual(r.rejected, [], JSON.stringify(r.rejected));
  const after = await call('interview_next', { workspace: ws, limit: 20 });
  // Nothing left to ask about either person except what the form didn't cover.
  for (const q of after.questions as { path: string; question: string }[])
    assert.ok(!['dependents'].includes(q.path), q.path);
});

test('business code goes to chat; the home area is a number and checked', async () => {
  assert.deepEqual(answerSpec('businesses[taxpayer].principalBusinessCode'), {
    kind: 'open',
  });
  assert.equal(
    answerSpec('businesses[taxpayer].homeOffice.homeSquareFeet').kind,
    'number'
  );
  const init = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/home-area`,
    acknowledged: true,
  });
  const ws = init.workspace as string;
  const r = await call('profile_set', {
    workspace: ws,
    set: [
      {
        path: 'businesses[taxpayer]',
        value: {
          owner: 'taxpayer',
          expenses: {},
          homeOffice: {
            method: 'simplified',
            squareFeet: 200,
            homeSquareFeet: 100,
          },
        },
        source: 'user',
      },
    ],
  });
  assert.equal(r.rejected.length, 1, JSON.stringify(r));
  assert.match(r.rejected[0].reason, /whole home/);
});

test('the vehicle card comes with deductions and credits, records questions together', async () => {
  const init = await call('workspace_init', {
    year: 2025,
    path: `${env.home}/vehicle`,
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
  await call('profile_set', {
    workspace: ws,
    set: [
      ...none,
      { path: 'outOfScope.other', value: [], source: 'user' },
      { path: 'filingStatus', value: 'single', source: 'user' },
      { path: 'taxpayer.dateOfBirth', value: '1985-05-01', source: 'user' },
      {
        path: 'taxpayer.canBeClaimedAsDependent',
        value: false,
        source: 'user',
      },
      { path: 'nec1099s[nec_1].owner', value: 'taxpayer', source: 'user' },
      {
        path: 'nec1099s[nec_1].nonemployeeComp',
        value: 9000000,
        source: 'user',
      },
      {
        path: 'businesses[taxpayer]',
        value: {
          owner: 'taxpayer',
          name: 'Design',
          expenses: {},
          vehicle: { businessMiles: 3000 },
          materiallyParticipated: true,
          principalBusinessCode: '541430',
          accountingMethod: 'cash',
          startedOrAcquiredThisYear: false,
          operatedFromHome: true,
          madePaymentsRequiring1099: false,
        },
        source: 'user',
      },
    ],
  });
  let next = await call('interview_next', { workspace: ws, limit: 20 });
  // Skip whatever income questions remain until the deductions phase.
  for (let i = 0; i < 5 && next.phase === 'income'; i++) {
    const set = (next.questions as { path: string; answer: { kind: string } }[])
      .filter((q) => q.answer.kind === 'yesno')
      .map((q) => ({ path: q.path, value: false, source: 'user' }));
    if (!set.length) break;
    await call('profile_set', { workspace: ws, set });
    next = await call('interview_next', { workspace: ws, limit: 20 });
  }
  assert.equal(
    next.phase,
    'deductions',
    JSON.stringify(next.questions.map((q: { path: string }) => q.path))
  );
  const card = next.questions.find(
    (q: { path: string }) => q.path === 'vehicle:taxpayer'
  );
  assert.ok(
    card,
    JSON.stringify(next.questions.map((q: { path: string }) => q.path))
  );
  const fields = card.answer.fields.map((f: { path: string }) => f.path);
  assert.ok(fields.includes('businesses[taxpayer].vehicleUse.hasEvidence'));
  assert.ok(fields.includes('businesses[taxpayer].vehicleUse.evidenceWritten'));
});

test('the widget page script parses', async () => {
  const r = await client.readResource({ uri: INTERVIEW_WIDGET_URI });
  const html = (r.contents[0] as { text: string }).text;
  const scripts = [
    ...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]!);
  // The page's own script (the runtime is the first one). A template-string
  // escape slip (a lost backslash) would stop the whole card from loading.
  const page = scripts.at(-1)!.replace(/await /g, '');
  assert.doesNotThrow(
    () => new Function(page),
    'widget script has a syntax error'
  );
});
