/**
 * return_review: the holistic check before forms_fill. Real engine, synthetic
 * facts entered through the tools.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { defaultDeps } from '../src/deps.ts';
import { openStore } from '../src/store/workspace.ts';
import { handler as calcReturn } from '../src/tools/calc-return.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as filingPrepare } from '../src/tools/filing-prepare.ts';
import { handler as formsFill } from '../src/tools/forms-fill.ts';
import { handler as interviewNext } from '../src/tools/interview-next.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as returnReview } from '../src/tools/return-review.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { w2Pdf } from './fixtures/make-pdfs.ts';
import { freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let ws: string;
let inbox: string;
const deps = () => ({
  ...defaultDeps(),
  now: () => new Date('2026-02-01T12:00:00Z'),
  kbFetch: (async () => {
    throw new Error('no network');
  }) as typeof fetch,
});

const NONE_APPLY = [
  'screening.hasDependents',
  'screening.hasRentalOrRoyaltyIncome',
  'screening.paidStudentLoanInterest',
  'outOfScope.retirementDistributions',
  'outOfScope.socialSecurityBenefits',
  'outOfScope.stockOrCryptoSales',
  'outOfScope.unemploymentCompensation',
  'outOfScope.hsa',
  'outOfScope.educationExpenses',
  'outOfScope.k1Income',
  'outOfScope.foreignIncomeOrAccounts',
  'outOfScope.wantsToItemize',
  'outOfScope.marriedFilingSeparately',
  'digitalAssetActivity',
].map((path) => ({ path, value: false, source: 'user' as const }));

async function set(items: { path: string; value: unknown }[]) {
  const r = await profileSet(
    {
      workspace: ws,
      set: items.map((i) => ({ ...i, source: 'user' as const })) as never,
    },
    deps()
  );
  assert.ok(r.ok && r.rejected.length === 0, JSON.stringify(r));
}

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025, acknowledged: true }, deps());
  assert.ok(r.ok);
  ws = r.workspace;
  inbox = r.inbox;
  await set([
    ...NONE_APPLY,
    { path: 'outOfScope.other', value: [] },
    { path: 'filingStatus', value: 'single' },
    { path: 'taxpayer.dateOfBirth', value: '1980-05-01' },
    { path: 'taxpayer.canBeClaimedAsDependent', value: false },
    { path: 'taxpayer.hasValidSsn', value: true },
    { path: 'w2s[w2_1].owner', value: 'taxpayer' },
    { path: 'w2s[w2_1].wages', value: 9000000 },
    { path: 'w2s[w2_1].federalWithheld', value: 1100000 },
  ]);
});

afterEach(async () => env.cleanup());

const identity = [
  { path: 'identity.taxpayer.firstName', value: 'Pat' },
  { path: 'identity.taxpayer.lastName', value: 'Example' },
  { path: 'identity.address.street', value: '1 Main St' },
  { path: 'identity.address.city', value: 'Austin' },
  { path: 'identity.address.state', value: 'TX' },
  { path: 'identity.address.zip', value: '78701' },
];

test('missing names or address block the review; then it is ready', async () => {
  const r = await returnReview({ workspace: ws }, deps());
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.ready, false);
  assert.ok(
    r.blockers.some((b) => b.code === 'identity:identity.taxpayer.firstName'),
    JSON.stringify(r.blockers)
  );
  assert.equal((await (await openStore(ws)).read()).review, undefined);

  await set(identity);
  const ok = await returnReview({ workspace: ws }, deps());
  assert.ok(ok.ok && ok.ready, JSON.stringify(ok.ok && ok.blockers));
  assert.equal(ok.return.filingStatus, 'Single');
  assert.ok(ok.return.forms.includes('f1040'));
  assert.equal(ok.return.drivers.length > 0, true);
  assert.ok(ok.confirmWithUser.length >= 3);
  const data = await (await openStore(ws)).read();
  assert.equal(data.review?.at, '2026-02-01T12:00:00.000Z');
});

test('a document that never made it onto the return blocks the review', async () => {
  await set(identity);
  await writeFile(join(inbox, 'w2-second-job.pdf'), await w2Pdf());
  assert.ok((await docsScan({ workspace: ws }, deps())).ok);
  const r = await returnReview({ workspace: ws }, deps());
  assert.ok(r.ok);
  assert.equal(r.ready, false);
  assert.ok(
    r.blockers.some(
      (b) =>
        b.code.startsWith('document:') &&
        b.message.includes('w2-second-job.pdf')
    ),
    JSON.stringify(r.blockers)
  );
});

test('forms_fill needs a review of the current facts', async () => {
  await set(identity);
  assert.ok((await calcReturn({ workspace: ws }, deps())).ok);
  const before = await formsFill({ workspace: ws }, deps());
  assert.equal(!before.ok && before.error.code, 'REVIEW_REQUIRED');

  const r = await returnReview({ workspace: ws }, deps());
  assert.ok(r.ok && r.ready);
  const filled = await formsFill({ workspace: ws }, deps());
  assert.ok(filled.ok, JSON.stringify(filled));

  await set([{ path: 'w2s[w2_1].federalWithheld', value: 1200000 }]);
  assert.ok((await calcReturn({ workspace: ws }, deps())).ok);
  const stale = await formsFill({ workspace: ws }, deps());
  assert.equal(!stale.ok && stale.error.code, 'REVIEW_REQUIRED');
});

test('return_review needs the start agreement', async () => {
  await (
    await openStore(ws)
  ).write((d) => {
    delete d.acknowledgment;
    return d;
  });
  const r = await returnReview({ workspace: ws }, deps());
  assert.equal(!r.ok && r.error.code, 'ACK_REQUIRED');
});

test('filing_prepare needs the review; the entry sheet matches the return', async () => {
  await set(identity);
  assert.ok((await calcReturn({ workspace: ws }, deps())).ok);
  const early = await filingPrepare(
    { workspace: ws, path: 'fillable_forms' },
    deps()
  );
  assert.equal(!early.ok && early.error.code, 'REVIEW_REQUIRED');

  assert.ok((await returnReview({ workspace: ws }, deps())).ok);
  const r = await filingPrepare(
    { workspace: ws, path: 'fillable_forms' },
    deps()
  );
  assert.ok(r.ok, JSON.stringify(r));
  const md = await readFile(
    join(ws, 'outputs', '2025-free-file-fillable-forms.md'),
    'utf8'
  );
  // A W-2-only return: no Schedule 1-A, 8959 or 8960 lines.
  assert.doesNotMatch(md, /Schedule 1-A|Form 8959|Form 8960/);
  assert.match(md, /- Filing status: check \*\*Single\*\*/);
  assert.match(md, /- Digital assets question: check \*\*No\*\*/);
  assert.match(md, /\| Form 1040 \| 1a \| .* \| 90,000 \|/);
});

test('removing an answer asks it again', async () => {
  await set([{ path: 'filingStatus', value: null }]);
  const next = await interviewNext({ workspace: ws, limit: 20 }, deps());
  assert.ok(next.ok);
  assert.ok(
    next.questions.some((q) => q.path === 'filingStatus'),
    JSON.stringify(next.questions.map((q) => q.path))
  );
});

test('a review lists open deductions once, not one item each', async () => {
  await set(identity);
  const r = await returnReview({ workspace: ws }, deps());
  assert.ok(r.ok && r.ready);
  const deductionItems = r.attention.filter((a) =>
    a.code.startsWith('deduction')
  );
  assert.ok(deductionItems.length <= 1, JSON.stringify(r.attention));
  assert.match(r.confirmWithUser[0]!, /1 W-2/);
  assert.match(r.confirmWithUser[1]!, /Single, with no dependents/);
  // $11,000 withheld on $90,000 of wages: a balance due, shown as a positive amount.
  assert.equal(r.return.outcome.kind, 'amount_owed');
  assert.equal(r.return.outcome.amount, -r.return.summary.refundOrOwed);
});
