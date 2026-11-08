/**
 * Schedule C items B and F-J and line 30(a)/(b): the real engine computes a
 * synthetic freelance return, fillReturn fills the real IRS PDF, and the Free
 * File entry sheet lists the same entries.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { engine, type Business, type TaxFacts } from '@1040kit/engine';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';

import { entrySheetMarkdown } from '../src/output/entry-sheet.ts';
import { fillReturn } from '../src/output/fill.ts';
import { emptyStoreData } from '../src/store/workspace.ts';

const golden = JSON.parse(
  readFileSync(
    new URL(
      '../../engine/test/golden/single-freelance-sli-odc.json',
      import.meta.url
    ),
    'utf8'
  )
) as { facts: TaxFacts };

function withBusiness(patch: Partial<Business>): TaxFacts {
  const facts = structuredClone(golden.facts);
  Object.assign(facts.businesses[0]!, patch);
  return facts;
}

async function schC(facts: TaxFacts) {
  const result = engine.computeReturn(facts);
  const data = { ...emptyStoreData(2025), facts };
  const out = await fillReturn(data, result);
  const form = (
    await PDFDocument.load(
      out.forms.find((f) => f.formId === 'schC.taxpayer')!.bytes
    )
  ).getForm();
  const field = (suffix: string) =>
    form.getFields().find((f) => f.getName().endsWith(`Page1[0].${suffix}`));
  return {
    result,
    sheet: entrySheetMarkdown(data, result),
    text: (s: string) => (field(s) as PDFTextField).getText(),
    box: (s: string) => (field(s) as PDFCheckBox).isChecked(),
  };
}

test('Schedule C header items and line 30(a) print and match the entry sheet', async () => {
  const c = await schC(golden.facts);
  assert.equal(c.result.complete, true);

  assert.equal(c.text('BComb[0].f1_4[0]'), '541430'); // B
  assert.equal(c.box('c1_1[0]'), true); // F cash
  assert.equal(c.box('c1_1[1]'), false);
  assert.equal(c.box('c1_1[2]'), false);
  assert.equal(c.box('c1_2[0]'), true); // G yes
  assert.equal(c.box('c1_2[1]'), false);
  assert.equal(c.box('c1_3[0]'), false); // H
  assert.equal(c.box('c1_4[0]'), false); // I no
  assert.equal(c.box('c1_4[1]'), true);
  assert.equal(c.box('c1_5[0]'), false); // J skipped after I "No"
  assert.equal(c.box('c1_5[1]'), false);
  assert.equal(c.text('Line30_ReadOrder[0].f1_43[0]'), '900'); // 30(a)
  assert.equal(c.text('Line30_ReadOrder[0].f1_44[0]'), '200'); // 30(b)

  for (const entry of [
    'Line B, business code: 541430',
    'Line F, accounting method: check **Cash**',
    'Line G, materially participated: check **Yes**',
    'Line I, payments that require Form(s) 1099: check **No**',
    'Line 30(a), simplified method: total area of your home 900 square feet',
    'Line 30(b), simplified method: part of your home used for business 200 square feet',
  ])
    assert.ok(c.sheet.includes(entry), entry);
  assert.ok(!c.sheet.includes('Line H'));
  assert.ok(!c.sheet.includes('Line J'));
});

test('Schedule C other method, new business, 1099s filed', async () => {
  const c = await schC(
    withBusiness({
      accountingMethod: 'other',
      accountingMethodOther: 'Hybrid',
      startedOrAcquiredThisYear: true,
      madePaymentsRequiring1099: true,
      filedRequired1099s: true,
    })
  );
  assert.equal(c.result.complete, true);
  assert.equal(c.box('c1_1[2]'), true);
  assert.equal(c.text('f1_9[0]'), 'Hybrid');
  assert.equal(c.box('c1_3[0]'), true);
  assert.equal(c.box('c1_4[0]'), true);
  assert.equal(c.box('c1_5[0]'), true);
  assert.equal(c.box('c1_5[1]'), false);
  for (const entry of [
    'Line F, accounting method: check **Other**, specify "Hybrid"',
    'Line H, started or acquired this business this year: check the box',
    'Line I, payments that require Form(s) 1099: check **Yes**',
    'Line J, filed the required Form(s) 1099: check **Yes**',
  ])
    assert.ok(c.sheet.includes(entry), entry);
});
