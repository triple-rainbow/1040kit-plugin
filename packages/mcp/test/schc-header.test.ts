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

async function schC(facts: TaxFacts, identity: Record<string, unknown> = {}) {
  const result = engine.computeReturn(facts);
  const data = { ...emptyStoreData(2025), facts, identity };
  const out = await fillReturn(data, result);
  const form = (
    await PDFDocument.load(
      out.forms.find((f) => f.formId === 'schC.taxpayer')!.bytes
    )
  ).getForm();
  const field = (suffix: string) =>
    form
      .getFields()
      .find(
        (f) =>
          /Page[12]\[0\]\./.test(f.getName()) &&
          f.getName().endsWith(`.${suffix}`)
      );
  return {
    result,
    out,
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

test('Part IV (vehicle) prints with car expenses and matches the entry sheet', async () => {
  const c = await schC(golden.facts);
  assert.equal(c.result.complete, true);
  const v = golden.facts.businesses[0]!.vehicleUse!;
  const [y, m, d] = v.placedInService!.split('-');
  assert.equal(c.text('f2_9[0]'), m); // 43
  assert.equal(c.text('f2_10[0]'), d);
  assert.equal(c.text('f2_11[0]'), y);
  assert.equal(
    c.text('f2_12[0]'),
    golden.facts.businesses[0]!.vehicle!.businessMiles.toLocaleString('en-US')
  ); // 44a
  assert.equal(c.text('f2_13[0]'), '0'); // 44b
  assert.equal(c.text('f2_14[0]'), '4,000'); // 44c
  assert.equal(c.box('c2_5[0]'), true); // 45 yes
  assert.equal(c.box('c2_6[1]'), true); // 46 no
  assert.equal(c.box('c2_7[0]'), true); // 47a yes
  assert.equal(c.box('c2_8[0]'), true); // 47b yes
  for (const entry of [
    `Line 43, month placed in service: ${m}`,
    'Line 44c, other miles: 4,000',
    'Line 45, available for personal use off duty: check **Yes**',
    'Line 46, another vehicle for personal use: check **No**',
    'Line 47b, the evidence is written: check **Yes**',
  ])
    assert.ok(c.sheet.includes(entry), entry);
});

test('a loss with all investment at risk checks 32a; a business address prints on line E', async () => {
  const facts = withBusiness({
    expenses: { supplies: 5000000 },
    allInvestmentAtRisk: true,
    operatedFromHome: false,
  });
  // The loss makes the earned income credit possible: answer its questions.
  facts.taxpayer = {
    ...facts.taxpayer,
    livedInUsOverHalfYear: true,
    qualifyingChildOfAnother: false,
  };
  facts.eitc = { priorDisallowance: false };
  const c = await schC(facts, {
    businesses: {
      taxpayer: {
        address: { street: '9 Studio Ln', cityStateZip: 'Austin, TX 78702' },
      },
    },
  });
  assert.equal(c.result.complete, true, JSON.stringify(c.result.missing));
  assert.equal(c.box('c1_7[0]'), true); // 32a
  assert.equal(c.box('c1_7[1]'), false);
  assert.equal(c.text('f1_7[0]'), '9 Studio Ln'); // E
  assert.equal(c.text('f1_8[0]'), 'Austin, TX 78702');
  assert.ok(
    c.sheet.includes('Line 32a, all investment is at risk: check the box')
  );
  assert.ok(c.sheet.includes('Line E, business address: 9 Studio Ln'));

  // No address given: the user is told to write it in.
  const blank = await schC(facts);
  assert.ok(
    blank.out.handwrite.some((h) => h.includes('Schedule C, line E')),
    JSON.stringify(blank.out.handwrite)
  );
});
