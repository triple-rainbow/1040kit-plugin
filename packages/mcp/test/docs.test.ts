import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { openStore } from '../src/store/workspace.ts';
import { handler as docsExtract } from '../src/tools/docs-extract.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import * as pdf from './fixtures/make-pdfs.ts';
import { fakeDeps, freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let ws: string;
let inbox: string;
const deps = fakeDeps();

beforeEach(async () => {
  env = await freshEnv();
  const res = await workspaceInit({ year: 2025, acknowledged: true }, deps);
  assert.ok(res.ok);
  ws = res.workspace;
  inbox = res.inbox;
});
afterEach(async () => {
  await env.cleanup();
});

async function put(name: string, bytes: Uint8Array | string) {
  await writeFile(join(inbox, name), bytes);
}

async function scan() {
  const res = await docsScan({ workspace: ws }, deps);
  assert.ok(res.ok, JSON.stringify(res));
  return res.documents;
}

async function extract(docIds?: string[]) {
  const res = await docsExtract({ workspace: ws, docIds }, deps);
  assert.ok(res.ok, JSON.stringify(res));
  return res;
}

/** Nothing SSN-shaped (or the fixture SSNs) anywhere in the decrypted store. */
function assertNoSsnStored(data: unknown, extra: string[] = []) {
  const text = JSON.stringify(data);
  for (const v of [pdf.FAKE.ssn, '123456789', ...extra])
    assert.ok(!text.includes(v), `store contains ${v}`);
  assert.doesNotMatch(text, /\b\d{3}-\d{2}-\d{4}\b/, 'SSN-shaped value stored');
  assert.doesNotMatch(text, /\{\{(SSN|ACCT):/, 'SSN/ACCT token stored');
}

const byFile = (docs: { file: string }[], f: string) => {
  const d = docs.find((x) => x.file === f);
  assert.ok(d, `no entry for ${f}`);
  return d as any;
};

test('classifies synthetic W-2 and 1099-NEC', async () => {
  await put('w2.pdf', await pdf.w2Pdf());
  await put('nec.pdf', await pdf.necPdf());
  await put('int.pdf', await pdf.intPdf());
  await put('div.pdf', await pdf.divPdf());
  const docs = await scan();
  assert.equal(byFile(docs, 'w2.pdf').kind, 'w2');
  assert.equal(byFile(docs, 'nec.pdf').kind, '1099nec');
  assert.equal(byFile(docs, 'int.pdf').kind, '1099int');
  assert.equal(byFile(docs, 'div.pdf').kind, '1099div');
  for (const d of docs) {
    assert.equal(d.status, 'new');
    assert.match(d.sha256, /^[0-9a-f]{64}$/);
  }
  // persisted
  const data = await (await openStore(ws)).read();
  assert.equal(data.docs.length, 4);
  // rescanning keeps ids stable
  const again = await scan();
  assert.deepEqual(
    again.map((d) => d.docId).sort(),
    docs.map((d) => d.docId).sort()
  );
});

test('extracts W-2 boxes to cents', async () => {
  await put('w2.pdf', await pdf.w2Pdf());
  await scan();
  const res = await extract();
  assert.equal(res.extracted.length, 1);
  const e = res.extracted[0]!;
  assert.equal(e.kind, 'w2');
  assert.equal(e.fields.wages, 5234567);
  assert.equal(e.fields.federalWithheld, 612345);
  assert.equal(e.fields.ssTax, 324543);
  assert.equal(e.fields.medicareTax, 75901);
  assert.ok(e.factPaths.includes('w2s[w2_1].wages'));
  assert.deepEqual(e.lowConfidence, []);
  const data = await (await openStore(ws)).read();
  const w2 = data.facts.w2s[0]!;
  assert.equal(w2.id, 'w2_1');
  assert.equal(w2.owner, 'taxpayer');
  assert.equal(w2.wages, 5234567);
  assert.equal(w2.employerEinToken, '{{EIN:w2_1}}');
  assert.equal(data.provenance['w2s[w2_1].wages']?.source, 'doc');
  assert.equal(data.provenance['w2s[w2_1].wages']?.docId, e.docId);
  assertNoSsnStored(data);
  assert.equal(data.identity.taxpayer?.lastName, 'Example');
  const docs = await scan();
  assert.equal(docs[0]!.status, 'extracted');
});

test('SSNs and account numbers are discarded; EINs come back as tokens', async () => {
  await put('w2.pdf', await pdf.w2Pdf());
  await put('int.pdf', await pdf.intPdf());
  await put('nec.pdf', await pdf.necPdf());
  await scan();
  const res = await extract();
  const w2 = res.extracted.find((e) => e.kind === 'w2')!;
  assert.equal(w2.fields.employeeSsn, undefined);
  assert.equal(w2.fields.employerEin, '{{EIN:w2_1}}');
  const int = res.extracted.find((e) => e.kind === '1099int')!;
  assert.equal(int.fields.accountNumber, undefined);
  assert.equal(int.fields.recipientTin, undefined);
  assert.equal(int.fields.interest, 123456);
  const text = JSON.stringify(res);
  assert.ok(!text.includes('6789'), text);
  assert.ok(!text.includes('3456789'));
  assert.ok(!text.includes('987654321'));
  // the vault holds the EINs only; nothing SSN-like anywhere in the store
  const data = await (await openStore(ws)).read();
  assert.deepEqual(Object.keys(data.vault).sort(), [
    '{{EIN:int_1}}',
    '{{EIN:nec_1}}',
    '{{EIN:w2_1}}',
  ]);
  assert.equal(data.vault['{{EIN:w2_1}}'], pdf.FAKE.ein);
  assertNoSsnStored(data);
});

test('an SSN-shaped payer TIN is discarded, not tokenized', async () => {
  await put('nec.pdf', await pdf.necPdf({ ein: '234-56-7890' }));
  await scan();
  const res = await extract();
  const nec = res.extracted[0]!;
  assert.equal(nec.fields.payerTin, undefined);
  assert.ok(
    nec.lowConfidence.some(
      (l) => l.field === 'payerTin' && /Social Security/.test(l.reason)
    ),
    JSON.stringify(nec)
  );
  const data = await (await openStore(ws)).read();
  assert.deepEqual(data.vault, {});
  assert.equal(data.facts.nec1099s[0]!.payerToken, undefined);
  assertNoSsnStored(data, ['234567890', '7890']);
});

test('1098-E: box 1, box 2 and the lender EIN', async () => {
  await put('1098e.pdf', await pdf.e1098Pdf({ box2: true }));
  await put(
    '1098e-b.pdf',
    await pdf.e1098Pdf({ interest: '412.00', tag: 'b' })
  );
  const docs = await scan();
  assert.ok(
    docs.every((d) => d.kind === '1098e'),
    JSON.stringify(docs)
  );
  const res = await extract();
  assert.equal(res.extracted.length, 2, JSON.stringify(res.skipped));
  const a = res.extracted.find((e) => e.fields.interest === 184_500);
  const b = res.extracted.find((e) => e.fields.interest === 41_200);
  const aId = /\[(e1098_\d)\]/.exec(a!.factPaths[0]!)![1]!;
  assert.equal(a!.kind, '1098e');
  assert.equal(a!.fields.interest, 184_500);
  assert.equal(a!.fields.box2Checked, true);
  assert.equal(a!.fields.lenderTin, `{{EIN:${aId}}}`);
  assert.equal(a!.fields.lenderName, 'Example Student Loans');
  assert.equal(a!.fields.owner, 'taxpayer');
  assert.equal(b!.fields.interest, 41_200);
  assert.equal(b!.fields.box2Checked, undefined);
  const data = await (await openStore(ws)).read();
  assert.deepEqual(
    data.facts.e1098s.map((e) => [e.interest, e.lenderToken]).sort(),
    [
      [184_500, `{{EIN:${aId}}}`],
      [41_200, `{{EIN:${aId === 'e1098_1' ? 'e1098_2' : 'e1098_1'}}}`],
    ].sort()
  );
  assert.equal(data.provenance['e1098s[e1098_1].interest']?.field, 'box1');
  assertNoSsnStored(data);
});

test('1099-MISC boxes 1 and 2 (rents, royalties)', async () => {
  await put('misc.pdf', await pdf.miscPdf());
  await scan();
  const res = await extract();
  const m = res.extracted[0]!;
  assert.equal(m.kind, '1099misc');
  assert.equal(m.fields.rents, 1_440_000);
  assert.equal(m.fields.royalties, 25_075);
  assert.equal(m.fields.otherIncome, undefined);
  const data = await (await openStore(ws)).read();
  assert.equal(data.facts.misc1099s[0]!.rents, 1_440_000);
  assert.equal(data.provenance['misc1099s[misc_1].royalties']?.field, 'box2');
});

test('low confidence on failed cross-check', async () => {
  await put('w2.pdf', await pdf.w2Pdf({ box4: '1,000.00' }));
  await put(
    'div.pdf',
    await pdf.divPdf({ ordinary: '100.00', qualified: '300.00' })
  );
  await scan();
  const res = await extract();
  const w2 = res.extracted.find((e) => e.kind === 'w2')!;
  assert.ok(
    w2.lowConfidence.some((l) => l.field === 'ssTax'),
    JSON.stringify(w2)
  );
  const div = res.extracted.find((e) => e.kind === '1099div')!;
  assert.ok(div.lowConfidence.some((l) => l.field === 'qualifiedDividends'));
});

test('a second name is assigned to the spouse', async () => {
  await put('w2-a.pdf', await pdf.w2Pdf());
  await put(
    'w2-b.pdf',
    await pdf.w2Pdf({
      ssn: pdf.FAKE.spouseSsn,
      ein: pdf.FAKE.ein2,
      employee: 'Sam Example',
    })
  );
  await scan();
  const res = await extract();
  const owners = res.extracted.map((e) => e.fields.owner).sort();
  assert.deepEqual(owners, ['spouse', 'taxpayer']);
  const data = await (await openStore(ws)).read();
  assert.equal(data.identity.spouse?.firstName, 'Sam');
  assert.ok(data.facts.spouse);
  assertNoSsnStored(data, [pdf.FAKE.spouseSsn, '987654320']);
});

test('messy inbox', async () => {
  const w2 = await pdf.w2Pdf();
  await put('w2.pdf', w2);
  await put('w2 copy.pdf', w2);
  await put('scan.pdf', await pdf.imageOnlyPdf());
  await put('locked.pdf', await pdf.encryptedPdf());
  await put('groceries.pdf', await pdf.randomPdf());
  await put('retirement.pdf', await pdf.r1099Pdf());
  await put('photo.heic', 'not really an image');
  await put('bank.csv', 'Date,Description,Amount\n01/02/2025,ADOBE,-10.00\n');
  await put('broken.pdf', '%PDF-1.7 garbage');
  const docs = await scan();
  const orig =
    byFile(docs, 'w2 copy.pdf').status === 'duplicate'
      ? byFile(docs, 'w2.pdf')
      : byFile(docs, 'w2 copy.pdf');
  const dup = docs.find((d) => d.status === 'duplicate');
  assert.ok(dup, 'one copy is a duplicate');
  assert.equal(dup.duplicateOf, orig.docId);
  assert.equal(byFile(docs, 'scan.pdf').status, 'needs_ocr');
  assert.equal(byFile(docs, 'locked.pdf').status, 'encrypted_pdf');
  assert.equal(byFile(docs, 'groceries.pdf').kind, 'unknown');
  const r = byFile(docs, 'retirement.pdf');
  assert.equal(r.status, 'unsupported_form');
  assert.match(r.note, /1099-R/);
  assert.match(r.note, /v1\.1/);
  assert.equal(byFile(docs, 'bank.csv').kind, 'bank_csv');
  assert.equal(byFile(docs, 'broken.pdf').kind, 'unknown');

  const res = await extract();
  assert.equal(res.extracted.length, 1, JSON.stringify(res));
  const reasons = Object.fromEntries(
    res.skipped.map((s) => [
      docs.find((d) => d.docId === s.docId)!.file,
      s.reason,
    ])
  );
  assert.equal(reasons['scan.pdf'], 'needs_ocr');
  assert.equal(reasons['locked.pdf'], 'encrypted_pdf');
  assert.equal(reasons['groceries.pdf'], 'unknown_document');
  assert.equal(reasons['retirement.pdf'], 'unsupported_form');
  assert.equal(reasons['bank.csv'], 'use_expenses_import');
  assert.match(reasons[dup.file]!, /^duplicate_of:/);
});

test('corrected W-2 supersedes original', async () => {
  await put('w2.pdf', await pdf.w2Pdf());
  await scan();
  const first = await extract();
  const origId = first.extracted[0]!.docId;
  await put('w2c.pdf', await pdf.w2Pdf({ corrected: true, box1: '53,000.00' }));
  const docs = await scan();
  const corrId = byFile(docs, 'w2c.pdf').docId;
  const res = await extract();
  assert.equal(res.extracted.length, 1);
  assert.equal(res.extracted[0]!.docId, corrId);
  assert.deepEqual(res.skipped, [
    { docId: origId, reason: `corrected_supersedes:${corrId}` },
  ]);
  const data = await (await openStore(ws)).read();
  assert.equal(data.facts.w2s.length, 1);
  assert.equal(data.facts.w2s[0]!.wages, 5300000);
  assert.equal(data.facts.w2s[0]!.corrected, true);
  assert.equal(data.provenance['w2s[w2_1].wages']?.docId, corrId);
});

test('corrected and original in one batch keeps only the correction', async () => {
  await put('a.pdf', await pdf.w2Pdf({ corrected: true, box1: '53,000.00' }));
  await put('b.pdf', await pdf.w2Pdf());
  await scan();
  const res = await extract();
  assert.equal(res.extracted.length, 1);
  assert.equal(res.skipped.length, 1);
  assert.match(res.skipped[0]!.reason, /^corrected_supersedes:/);
  const data = await (await openStore(ws)).read();
  assert.equal(data.facts.w2s.length, 1);
  assert.equal(data.facts.w2s[0]!.wages, 5300000);
});

test('re-extract is idempotent', async () => {
  await put('w2.pdf', await pdf.w2Pdf());
  await put('nec.pdf', await pdf.necPdf());
  const docs = await scan();
  await extract();
  await extract(docs.map((d) => d.docId));
  await extract(docs.map((d) => d.docId));
  const data = await (await openStore(ws)).read();
  assert.equal(data.facts.w2s.length, 1);
  assert.equal(data.facts.nec1099s.length, 1);
  assert.equal(data.facts.nec1099s[0]!.nonemployeeComp, 1825000);
});

test('user override survives re-extract', async () => {
  await put('w2.pdf', await pdf.w2Pdf());
  const docs = await scan();
  await extract();
  const store = await openStore(ws);
  await store.write((d) => {
    d.facts.w2s[0]!.federalWithheld = 100;
    d.provenance['w2s[w2_1].federalWithheld'] = {
      source: 'user',
      at: new Date().toISOString(),
      overrides: 'doc',
    };
  });
  await extract(docs.map((d) => d.docId));
  const data = await store.read();
  assert.equal(data.facts.w2s[0]!.federalWithheld, 100);
});
