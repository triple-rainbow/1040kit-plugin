/**
 * The manual-test return of 2026-11-06 (engine golden
 * single-freelance-sli-odc): every line the IRS form needs prints, including
 * totals that repeat another line (Schedule 2 line 21 = Form 1040 line 23)
 * and lines the engine used to compute inline. Values are the golden's
 * hand-worked numbers.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { engine, type FormId, type TaxFacts } from '@1040kit/engine';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';

import { drivers } from '../src/calc.ts';
import { loadFieldMap, PDF_FOR_FORM } from '../src/output/field-maps.ts';
import { fillReturn } from '../src/output/fill.ts';
import { missingIdentity } from '../src/output/ready.ts';
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

function storeData() {
  const data = { ...emptyStoreData(2025), facts: golden.facts };
  data.identity = {
    taxpayer: {
      firstName: 'Jessie',
      lastName: 'Example',
      occupation: 'designer',
    },
    dependents: { dependent_1: { firstName: 'Iris', lastName: 'Example' } },
    address: {
      street: '1 Example St',
      city: 'Ogden',
      state: 'UT',
      zip: '84401',
    },
  };
  return data;
}

const EXPECTED: [FormId, string, string][] = [
  ['f1040', '11b', '64,050'],
  ['f1040', '23', '1,872'],
  ['sch1', '3', '13,250'],
  ['sch1', '10', '13,250'],
  ['sch1', '15', '936'],
  ['sch1', '21', '1,845'],
  ['sch1', '26', '2,781'],
  ['sch2', '4', '1,872'],
  ['sch2', '21', '1,872'],
  ['schC.taxpayer', '1', '18,250'],
  ['schC.taxpayer', '3', '18,250'],
  ['schC.taxpayer', '5', '18,250'],
  ['schC.taxpayer', '7', '18,250'],
  ['schC.taxpayer', '27b', '1,300'],
  ['schC.taxpayer', '48', '1,300'],
  ['schC.taxpayer', '31', '13,250'],
  ['schSE.taxpayer', '2', '13,250'],
  ['schSE.taxpayer', '3', '13,250'],
  ['schSE.taxpayer', '4a', '12,236'],
  ['schSE.taxpayer', '4c', '12,236'],
  ['schSE.taxpayer', '6', '12,236'],
  ['schSE.taxpayer', '8a', '52,346'],
  ['schSE.taxpayer', '8d', '52,346'],
  ['schSE.taxpayer', '9', '123,754'],
  ['schSE.taxpayer', '10', '1,517'],
  ['schSE.taxpayer', '12', '1,872'],
  ['schSE.taxpayer', '13', '936'],
  ['sch8812', '1', '64,050'],
  ['sch8812', '3', '64,050'],
  ['sch8812', '6', '1'],
  ['sch8812', '7', '500'],
  ['sch8812', '8', '500'],
  ['sch8812', '9', '200,000'],
  ['sch8812', '12', '500'],
  ['sch8812', '13', '5,261'],
  ['sch8812', '14', '500'],
  ['f8995', '1i', '12,314'],
  ['f8995', '2', '12,314'],
  ['f8995', '4', '12,314'],
  ['f8995', '5', '2,463'],
  ['f8995', '10', '2,463'],
  ['f8995', '11', '48,300'],
  ['f8995', '13', '48,300'],
  ['f8995', '14', '9,660'],
  ['f8995', '15', '2,463'],
];

// Part II-A stops at line 16a = 0, so nothing below it prints.
const BLANK: [FormId, string][] = [
  ['sch8812', '16a'],
  ['sch8812', '18a'],
  ['sch8812', '27'],
];

test('manual-test return: every required line prints', async () => {
  const result = engine.computeReturn(golden.facts);
  assert.equal(result.complete, true);
  const out = await fillReturn(storeData(), result);
  assert.deepEqual(out.unmapped, []);
  const docs = new Map<FormId, PDFDocument>();
  for (const f of out.forms)
    docs.set(f.formId, await PDFDocument.load(f.bytes));
  const field = (form: FormId, short: string) => {
    const hits = docs
      .get(form)!
      .getForm()
      .getFields()
      .filter(
        (f) => f.getName() === short || f.getName().endsWith(`.${short}`)
      );
    assert.equal(hits.length, 1, `${form} ${short}`);
    return hits[0]!;
  };
  const text = (form: FormId, line: string) => {
    const name = loadFieldMap(2025, PDF_FOR_FORM[form])!.lines[line]!;
    return (field(form, name) as PDFTextField).getText() ?? '';
  };
  for (const [form, line, want] of EXPECTED)
    assert.equal(text(form, line), want, `${form} line ${line}`);
  for (const [form, line] of BLANK)
    assert.equal(text(form, line), '', `${form} line ${line}`);

  // Schedule 8812 line 12: "Yes" (line 8 is more than line 11).
  const boxes = loadFieldMap(2025, 'f1040s8')!.fields!;
  assert.equal(
    (field('sch8812', boxes['line12.yes']!) as PDFCheckBox).isChecked(),
    true
  );
  assert.equal(
    (field('sch8812', boxes['line12.no']!) as PDFCheckBox).isChecked(),
    false
  );

  // Home address and dependent name print on page 1.
  const f1040 = loadFieldMap(2025, 'f1040')!;
  const page1 = (key: string) =>
    (field('f1040', f1040.fields![key]!) as PDFTextField).getText();
  assert.equal(page1('address.street'), '1 Example St');
  assert.equal(page1('address.city'), 'Ogden');
  assert.equal(page1('address.zip'), '84401');
});

test('drivers skip fixed thresholds and forms the return does not file', () => {
  const result = engine.computeReturn(golden.facts);
  assert.deepEqual(
    drivers(result).map((d) => d.id),
    ['wages', 'standardDeduction', 'additionalIncome']
  );
});

test('forms_fill needs names and the full home address, never SSNs', () => {
  assert.deepEqual(missingIdentity(storeData()), []);
  const data = storeData();
  data.identity.address = { state: 'UT' };
  data.identity.dependents = { dependent_1: { firstName: 'Iris' } };
  assert.deepEqual(missingIdentity(data), [
    'identity.dependents[dependent_1].lastName',
    'identity.address.street',
    'identity.address.city',
    'identity.address.zip',
  ]);
});
