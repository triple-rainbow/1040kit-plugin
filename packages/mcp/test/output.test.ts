import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { FormId, LineNode, ReturnResult, TaxFacts } from '@1040kit/engine';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

import { ACKNOWLEDGMENT_TEXT } from '../src/output/acknowledgment.ts';
import { fillReturn, validateMaps } from '../src/output/fill.ts';
import { openStore } from '../src/store/workspace.ts';
import { handler as calcReturn } from '../src/tools/calc-return.ts';
import { handler as filingPrepare } from '../src/tools/filing-prepare.ts';
import { handler as formsFill } from '../src/tools/forms-fill.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { FAKE } from './fixtures/make-pdfs.ts';
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

const ACCT = '0000987654321';
const ack = { acknowledged: true } as const;

function lines(): [FormId, string, string, number][] {
  return [
    ['f1040', '1a', 'wages', 52346],
    ['f1040', '1z', 'totalWages', 52346],
    ['f1040', '2b', 'taxableInterest', 1235],
    ['f1040', '8', 'sch1Income', 18250],
    ['f1040', '9', 'totalIncome', 71831],
    ['f1040', '10', 'adjustments', 1289],
    ['f1040', '11a', 'agi', 70542],
    ['f1040', '12e', 'standardDeduction', 15750],
    ['f1040', '15', 'taxableIncome', 52000],
    ['f1040', '16', 'tax', 6000],
    ['f1040', '19', 'ctc', 0],
    ['f1040', '24', 'totalTax', 8579],
    ['f1040', '25a', 'withholding', 6123],
    ['f1040', '33', 'totalPayments', 6123],
    ['f1040', '37', 'refundOrOwed', -2456],
    ['f1040', '99z', 'mysteryLine', 7],
    ['sch1', '3', 'businessIncome', 18250],
    ['sch1', '15', 'seDeduction', 1289],
    ['schC.taxpayer', '1', 'schC.grossReceipts.taxpayer', 18250],
    ['schC.taxpayer', '31', 'schC.netProfit.taxpayer', 18250],
    ['schSE.taxpayer', '12', 'seTax.taxpayer', 2579],
    ['sch2', '4', 'sch2SeTax', 2579],
    ['schB', '2', 'schBInterest', 1235],
    ['schB', '4', 'schBInterestNet', 1235],
  ];
}

function bigResult(
  facts: TaxFacts,
  over: Partial<ReturnResult> = {}
): ReturnResult {
  const nodes: Record<string, LineNode> = {};
  for (const [form, line, id, value] of lines()) {
    nodes[id] = {
      id,
      label: `Label ${id}`,
      value,
      form,
      line,
      trace: { formula: `formula ${id}`, inputs: [] },
      citations: [],
    };
  }
  return fakeResult(facts, {
    forms: ['f1040', 'sch1', 'sch2', 'schB', 'schC.taxpayer', 'schSE.taxpayer'],
    nodes,
    summary: {
      ...emptySummary(),
      totalIncome: 71831,
      agi: 70542,
      totalTax: 8579,
      totalPayments: 6123,
      refundOrOwed: -2456,
    },
    ...over,
  });
}

const engine = (over: Partial<ReturnResult> = {}) =>
  fakeEngine({ computeReturn: (f) => bigResult(f, over) });

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025 }, fakeDeps());
  assert.ok(r.ok);
  ws = r.workspace;
  await (
    await openStore(ws)
  ).write((d) => {
    d.facts.filingStatus = 'single';
    d.facts.taxpayer = { id: 'taxpayer', dateOfBirth: '1958-03-01' };
    d.vault['{{EIN:w2_1}}'] = FAKE.ein;
    d.facts.w2s.push({
      id: 'w2_1',
      owner: 'taxpayer',
      employerEinToken: '{{EIN:w2_1}}',
      wages: 5234567,
      federalWithheld: 612345,
      ssWages: 5234567,
      ssTax: 324543,
      medicareWages: 5234567,
      medicareTax: 75901,
    });
    d.facts.int1099s.push({ id: 'int_1', owner: 'taxpayer', interest: 123456 });
    d.facts.businesses.push({
      owner: 'taxpayer',
      name: 'Pat Example Design',
      expenses: {},
    });
    d.facts.dependents.push({
      id: 'dependent_1',
      dateOfBirth: '2015-05-05',
      relationship: 'child',
      monthsLivedWithTaxpayer: 12,
      hasValidSsn: true,
    });
    d.labels['int_1'] = 'Example Savings Bank';
    d.identity = {
      taxpayer: {
        firstName: 'Pat',
        lastName: 'Example',
        occupation: 'Designer',
      },
      dependents: { dependent_1: { firstName: 'Robin', lastName: 'Example' } },
      address: {
        street: '1 Example Way',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
      },
    };
  });
});
afterEach(() => env.cleanup());

async function calc(deps = fakeDeps({ engine: engine() })) {
  const r = await calcReturn({ workspace: ws }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  return deps;
}

test('every field map entry resolves in the 2025 PDFs', async () => {
  assert.deepEqual(await validateMaps(2025), []);
});

test('forms_fill refuses incomplete return', async () => {
  const none = await formsFill({ workspace: ws, ...ack }, fakeDeps());
  assert.equal(!none.ok && none.error.code, 'RETURN_INCOMPLETE');

  const deps = await calc(
    fakeDeps({
      engine: engine({
        complete: false,
        unsupported: [
          {
            code: 'niit',
            message: 'Net investment income tax is not supported',
            deferredTo: 'v2',
          },
        ],
      }),
    })
  );
  const r = await formsFill({ workspace: ws, ...ack }, deps);
  assert.equal(!r.ok && r.error.code, 'RETURN_INCOMPLETE');
  assert.match(!r.ok ? r.error.message : '', /Net investment income/);
  const f = await filingPrepare({ workspace: ws, path: 'mail' }, deps);
  assert.equal(!f.ok && f.error.code, 'RETURN_INCOMPLETE');

  // complete, but facts changed afterwards
  const ok = await calc();
  await profileSet(
    {
      workspace: ws,
      set: [{ path: 'taxpayer.blind', value: true, source: 'user' }],
    },
    ok
  );
  const stale = await formsFill({ workspace: ws, ...ack }, ok);
  assert.equal(!stale.ok && stale.error.code, 'RETURN_INCOMPLETE');
  assert.match(!stale.ok ? stale.error.message : '', /changed/);
});

test('filled 1040 has wages in line 1a field', async () => {
  const data = await (await openStore(ws)).read();
  const out = await fillReturn(data, bigResult(data.facts));
  const f1040 = out.forms.find((f) => f.formId === 'f1040')!;
  const form = (await PDFDocument.load(f1040.bytes)).getForm();
  assert.equal(
    form.getTextField('topmostSubform[0].Page1[0].f1_47[0]').getText(),
    '52,346'
  );
  assert.equal(
    form.getTextField('topmostSubform[0].Page1[0].f1_75[0]').getText(),
    '70,542'
  ); // 11a
  assert.equal(
    form.getTextField('topmostSubform[0].Page2[0].f2_01[0]').getText(),
    '70,542'
  ); // 11b copied
  assert.equal(
    form.getTextField('topmostSubform[0].Page2[0].f2_35[0]').getText(),
    '-2,456'
  ); // 37
  assert.equal(
    form.getTextField('topmostSubform[0].Page1[0].f1_14[0]').getText(),
    'Pat'
  );
  assert.ok(
    form
      .getCheckBox('topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[0]')
      .isChecked()
  ); // single
  assert.ok(form.getCheckBox('topmostSubform[0].Page2[0].c2_5[0]').isChecked()); // born before 1961-01-02
  assert.equal(
    form
      .getTextField(
        'topmostSubform[0].Page1[0].Table_Dependents[0].Row1[0].f1_31[0]'
      )
      .getText(),
    'Robin'
  );
  const schC = (
    await PDFDocument.load(
      out.forms.find((f) => f.formId === 'schC.taxpayer')!.bytes
    )
  ).getForm();
  assert.equal(
    schC.getTextField('topmostSubform[0].Page1[0].f1_46[0]').getText(),
    '18,250'
  ); // line 31
  const schB = (
    await PDFDocument.load(out.forms.find((f) => f.formId === 'schB')!.bytes)
  ).getForm();
  assert.equal(
    schB
      .getTextField('topmostSubform[0].Page1[0].Line1_ReadOrder[0].f1_03[0]')
      .getText(),
    'Example Savings Bank'
  );
  assert.deepEqual(out.unmapped, [{ form: 'f1040', line: '99z', value: 7 }]);
  assert.ok(
    out.handwrite.some((h) => /Robin/.test(h)),
    JSON.stringify(out.handwrite)
  );
});

test('no SSN anywhere in the PDF; handwrite names every SSN box', async () => {
  const deps = await calc();
  const r = await formsFill({ workspace: ws, ...ack }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  const text = JSON.stringify(r);
  assert.ok(!text.includes('6789') && !text.includes('123456789'), text);
  assert.deepEqual(r.unmappedLines, [{ form: 'f1040', line: '99z', value: 7 }]);
  assert.doesNotMatch(r.note, /contains the real SSN/);

  const hw = r.handwrite;
  const has = (re: RegExp) =>
    assert.ok(
      hw.some((h) => re.test(h)),
      `${re} not in ${JSON.stringify(hw)}`
    );
  has(
    /^Form 1040, page 1, "Your social security number" box \(top right\): write your SSN\.$/
  );
  has(
    /^Form 1040, page 1, Dependents table, .*dependent 1 \(Robin Example\): write Robin Example’s SSN\.$/
  );
  for (const form of [
    'Schedule 1',
    'Schedule 2',
    'Schedule B',
    'Schedule C',
    'Schedule SE',
  ])
    has(
      new RegExp(`^${form}, .*social security number.*: write your SSN`, 'i')
    );
  assert.ok(
    !hw.some((h) => /spouse/i.test(h)),
    'single filer: no spouse SSN box'
  );
  // owes money → no direct-deposit item
  assert.ok(!hw.some((h) => /routing/.test(h)));

  const bytes = await readFile(join(ws, 'outputs', '2025-federal-return.pdf'));
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text: pdfText } = await extractText(pdf, { mergePages: true });
  for (const v of [FAKE.ssn, '123456789', FAKE.ein, '123456789', ACCT])
    assert.ok(!pdfText.includes(v), `PDF contains ${v}`);
  assert.doesNotMatch(pdfText, /\b\d{3}-\d{2}-\d{4}\b/);
  assert.ok(pdfText.includes('52,346'));
  assert.equal(pdf.numPages >= 8, true);
  // flattened: no fillable fields remain
  assert.equal((await PDFDocument.load(bytes)).getForm().getFields().length, 0);

  // every SSN field in the unflattened forms is empty
  const data = await (await openStore(ws)).read();
  const out = await fillReturn(data, bigResult(data.facts));
  const f1040 = (
    await PDFDocument.load(out.forms.find((f) => f.formId === 'f1040')!.bytes)
  ).getForm();
  for (const name of [
    'topmostSubform[0].Page1[0].f1_16[0]',
    'topmostSubform[0].Page1[0].Table_Dependents[0].Row3[0].f1_39[0]',
  ])
    assert.equal(f1040.getTextField(name).getText(), undefined, name);
});

test('a refund adds the direct-deposit boxes to handwrite', async () => {
  const deps = await calc(
    fakeDeps({
      engine: engine({ summary: { ...emptySummary(), refundOrOwed: 1200 } }),
    })
  );
  const r = await formsFill({ workspace: ws, ...ack }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(
    r.handwrite.some((h) =>
      /^Form 1040, page 2, lines 35b and 35d \(direct deposit\): write your bank routing and account numbers/.test(
        h
      )
    ),
    JSON.stringify(r.handwrite)
  );
});

test('forms_fill needs the acknowledgment, and again after a fact change', async () => {
  const deps = await calc();
  const first = await formsFill({ workspace: ws }, deps);
  assert.equal(!first.ok && first.error.code, 'ACK_REQUIRED');
  assert.ok(
    !first.ok && first.error.message.includes(ACKNOWLEDGMENT_TEXT),
    'the message carries the exact text'
  );
  const no = await formsFill({ workspace: ws, acknowledged: false }, deps);
  assert.equal(!no.ok && no.error.code, 'ACK_REQUIRED');
  assert.deepEqual(await readdir(join(ws, 'outputs')), []);

  const yes = await formsFill({ workspace: ws, ...ack }, deps);
  assert.ok(yes.ok, JSON.stringify(yes));
  assert.equal(yes.acknowledgedAt, '2026-02-01T12:00:00.000Z');
  let data = await (await openStore(ws)).read();
  assert.equal(data.acknowledgment?.text, ACKNOWLEDGMENT_TEXT);
  assert.equal(data.acknowledgment?.at, '2026-02-01T12:00:00.000Z');
  assert.equal(data.acknowledgment?.factsHash, data.lastCalc?.factsHash);
  const summary = await readFile(
    join(ws, 'outputs', '2025-summary.md'),
    'utf8'
  );
  assert.ok(summary.includes(ACKNOWLEDGMENT_TEXT));
  assert.match(summary, /On 2026-02-01 .*you acknowledged/);

  // same facts: no need to acknowledge again
  const again = await formsFill({ workspace: ws }, deps);
  assert.ok(again.ok, JSON.stringify(again));

  // a fact changes → recompute → acknowledgment needed again
  const set = await profileSet(
    {
      workspace: ws,
      set: [{ path: 'taxpayer.blind', value: true, source: 'user' }],
    },
    deps
  );
  assert.ok(set.ok);
  await calc(deps);
  const stale = await formsFill({ workspace: ws }, deps);
  assert.equal(!stale.ok && stale.error.code, 'ACK_REQUIRED');
  const re = await formsFill({ workspace: ws, ...ack }, deps);
  assert.ok(re.ok, JSON.stringify(re));
  data = await (await openStore(ws)).read();
  assert.equal(data.acknowledgment?.factsHash, data.lastCalc?.factsHash);
});

test('entry sheet lists every non-zero line', async () => {
  const deps = await calc();
  const r = await filingPrepare(
    { workspace: ws, path: 'fillable_forms' },
    deps
  );
  assert.ok(r.ok, JSON.stringify(r));
  const md = await readFile(
    join(ws, 'outputs', '2025-free-file-fillable-forms.md'),
    'utf8'
  );
  for (const [form, line, id, value] of lines()) {
    const has = md.includes(`| ${line} | Label ${id} |`);
    assert.equal(has, value !== 0, `${form} ${line}`);
  }
  assert.match(md, /\| Form 1040 \| 1a \| Label wages \| 52,346 \|/);
  assert.match(md, /- Your SSN: \*\*type this yourself\*\*/);
  assert.match(md, /SSN: \*\*type this yourself\*\*/); // dependent
  assert.match(md, /## Type these yourself/);
  assert.match(
    md,
    /- Schedule C, "Social security number" box \(top right\): your SSN — \*\*type this yourself\*\*/
  );
  assert.doesNotMatch(md, /\b\d{3}-\d{2}-\d{4}\b/);
});

test('mailing address by state', async () => {
  // refund in Texas → Austin
  let deps = await calc(
    fakeDeps({
      engine: engine({ summary: { ...emptySummary(), refundOrOwed: 1200 } }),
    })
  );
  let r = await filingPrepare({ workspace: ws, path: 'mail' }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  let md = await readFile(
    join(ws, 'outputs', '2025-mailing-instructions.md'),
    'utf8'
  );
  assert.match(md, /Austin, TX 73301-0002/);
  assert.doesNotMatch(md, /Charlotte/);
  assert.match(md, /where-to-file-paper-tax-returns/);

  // owed in Texas → both addresses
  deps = await calc();
  r = await filingPrepare({ workspace: ws, path: 'mail' }, deps);
  md = await readFile(
    join(ws, 'outputs', '2025-mailing-instructions.md'),
    'utf8'
  );
  assert.match(md, /Austin, TX 73301-0002/);
  assert.match(md, /P\.O\. Box 1214\nCharlotte, NC 28201-1214/);
  assert.match(md, /\$2,456/);

  // California refund → Ogden
  await profileSet(
    {
      workspace: ws,
      set: [{ path: 'identity.address.state', value: 'CA', source: 'user' }],
    },
    deps
  );
  deps = await calc(
    fakeDeps({
      engine: engine({ summary: { ...emptySummary(), refundOrOwed: 5 } }),
    })
  );
  await filingPrepare({ workspace: ws, path: 'mail' }, deps);
  md = await readFile(
    join(ws, 'outputs', '2025-mailing-instructions.md'),
    'utf8'
  );
  assert.match(md, /Ogden, UT 84201-0002/);
});

test('no raw SSN, EIN or account number in any text file', async () => {
  const deps = await calc();
  assert.ok((await formsFill({ workspace: ws, ...ack }, deps)).ok);
  assert.ok((await filingPrepare({ workspace: ws, path: 'mail' }, deps)).ok);
  assert.ok(
    (await filingPrepare({ workspace: ws, path: 'fillable_forms' }, deps)).ok
  );
  const dir = join(ws, 'outputs');
  const mds = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  assert.deepEqual(mds.sort(), [
    '2025-free-file-fillable-forms.md',
    '2025-mailing-instructions.md',
    '2025-summary.md',
  ]);
  for (const f of mds) {
    const t = await readFile(join(dir, f), 'utf8');
    for (const secret of [
      FAKE.ssn,
      '123456789',
      FAKE.ein,
      '123456789',
      ACCT,
      '987654321',
    ]) {
      assert.ok(!t.includes(secret), `${f} contains ${secret}`);
    }
  }
});

test('a business name containing a vault value is refused, not written', async () => {
  await (
    await openStore(ws)
  ).write((d) => {
    d.identity.taxpayer!.firstName = `Pat ${FAKE.ssn}`;
  });
  const deps = await calc();
  const r = await filingPrepare(
    { workspace: ws, path: 'fillable_forms' },
    deps
  );
  assert.equal(!r.ok && r.error.code, 'PII_IN_OUTPUT');
  assert.deepEqual(
    (await readdir(join(ws, 'outputs'))).filter((f) => f.endsWith('.md')),
    []
  );
});
