/**
 * Field maps for the forms added in v1 (Schedule E, Schedule EIC, Forms 8829,
 * 8959, 8960) and the 1040 / Schedule 1 / Schedule 2 lines they feed. A fake
 * engine supplies the lines; each check fills the real IRS PDF, flattens it,
 * and reads the text back at the position the IRS form prints that line
 * (positions from scripts/dump-fields.ts).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type {
  FormId,
  LineNode,
  ReturnResult,
  TaxFacts,
  TraceInput,
} from '@1040kit/engine';
import { PDFCheckBox, PDFDocument, PDFTextField } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';

import { assetPath, PDF_FOR_FORM } from '../src/output/field-maps.ts';
import { fillReturn } from '../src/output/fill.ts';
import { openStore } from '../src/store/workspace.ts';
import { handler as calcReturn } from '../src/tools/calc-return.ts';
import { handler as filingPrepare } from '../src/tools/filing-prepare.ts';
import { handler as formsFill } from '../src/tools/forms-fill.ts';
import { handler as returnReview } from '../src/tools/return-review.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
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

type Row = [FormId, string, number, TraceInput[]?];
const dep1: TraceInput[] = [
  {
    ref: 'dependents[dependent_1].monthsLivedWithTaxpayer',
    kind: 'fact',
    value: 12,
  },
];

const ROWS: Row[] = [
  ['f1040', '1a', 260000],
  ['f1040', '25c', 400],
  ['f1040', '27a', 1500],
  ['sch1', '5', 19200],
  ['sch1', '21', 2500],
  ['sch2', '11', 450],
  ['sch2', '12', 47],
  ['schE', '3:A', 14400],
  ['schE', '3:B', 9600],
  ['schE', '9:A', 1200],
  ['schE', '12:A', 3000],
  ['schE', '19:B', 50],
  ['schE', '20:A', 4200],
  ['schE', '20:B', 600],
  ['schE', '21:A', 10200],
  ['schE', '21:B', 9000],
  ['schE', '23a', 24000],
  ['schE', '23c', 3000],
  ['schE', '23e', 4800],
  ['schE', '24', 19200],
  ['schE', '26', 19200],
  ['schEIC', '6:1', 12, dep1],
  ['schEIC', '3:1', 2015, dep1],
  ['f8829.taxpayer', '1', 200],
  ['f8829.taxpayer', '2', 2000],
  ['f8829.taxpayer', '3', 10],
  ['f8829.taxpayer', '7', 10],
  ['f8829.taxpayer', '8', 30000],
  ['f8829.taxpayer', '10:B', 9000],
  ['f8829.taxpayer', '18:a', 300],
  ['f8829.taxpayer', '18:b', 1200],
  ['f8829.taxpayer', '36', 1500],
  ['f8959', '1', 250000],
  ['f8959', '4', 250000],
  ['f8959', '5', 200000],
  ['f8959', '6', 50000],
  ['f8959', '7', 450],
  ['f8959', '18', 450],
  ['f8959', '19', 3625],
  ['f8959', '24', 400],
  ['f8960', '1', 1235],
  ['f8960', '8', 1235],
  ['f8960', '12', 1235],
  ['f8960', '13', 260000],
  ['f8960', '14', 200000],
  ['f8960', '15', 60000],
  ['f8960', '16', 1235],
  ['f8960', '17', 47],
];

const FORMS: FormId[] = [
  'f1040',
  'sch1',
  'sch2',
  'schC.taxpayer',
  'schE',
  'schEIC',
  'f8829.taxpayer',
  'f8959',
  'f8960',
];

function result(facts: TaxFacts): ReturnResult {
  const nodes: Record<string, LineNode> = {};
  for (const [form, line, value, inputs] of ROWS) {
    const id = `${form}:${line}`;
    nodes[id] = {
      id,
      label: `Label ${id}`,
      value,
      form,
      line,
      trace: { formula: 'f', inputs: inputs ?? [] },
      citations: [],
    };
  }
  return fakeResult(facts, {
    forms: FORMS,
    nodes,
    summary: { ...emptySummary(), refundOrOwed: 900 },
  });
}

const engine = fakeEngine({ computeReturn: (f) => result(f) });
const deps = () => fakeDeps({ engine });

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025, acknowledged: true }, fakeDeps());
  assert.ok(r.ok);
  ws = r.workspace;
  const set = await profileSet(
    {
      workspace: ws,
      set: [
        { path: 'filingStatus', value: 'hoh', source: 'user' },
        { path: 'taxpayer.dateOfBirth', value: '1985-02-02', source: 'user' },
        {
          path: 'dependents[dependent_1]',
          value: {
            dateOfBirth: '2015-06-01',
            relationship: 'child',
            monthsLivedWithTaxpayer: 12,
            hasValidSsn: true,
          },
          source: 'user',
        },
        {
          path: 'rentals[rental_1]',
          value: {
            owner: 'taxpayer',
            propertyType: 1,
            fairRentalDays: 365,
            personalUseDays: 0,
            expenses: { insurance: 120000, mortgage_interest: 300000 },
          },
          source: 'user',
        },
        { path: 'rentals[rental_2].owner', value: 'joint', source: 'user' },
        { path: 'rentals[rental_2].propertyType', value: 2, source: 'user' },
        {
          path: 'rentals[rental_2].fairRentalDays',
          value: 200,
          source: 'user',
        },
        {
          path: 'businesses[taxpayer]',
          value: {
            name: 'Pat Example Design',
            expenses: {},
            homeOffice: {
              method: 'actual',
              officeSquareFeet: 200,
              homeSquareFeet: 2000,
              ownership: 'rent',
              indirect: { rent: 2400000, utilities: 300000 },
            },
          },
          source: 'user',
        },
        { path: 'identity.taxpayer.firstName', value: 'Pat', source: 'user' },
        {
          path: 'identity.taxpayer.lastName',
          value: 'Example',
          source: 'user',
        },
        {
          path: 'identity.dependents[dependent_1].firstName',
          value: 'Robin',
          source: 'user',
        },
        {
          path: 'identity.dependents[dependent_1].lastName',
          value: 'Example',
          source: 'user',
        },
        {
          path: 'identity.rentals[rental_1].address.street',
          value: '12 Rental Rd',
          source: 'user',
        },
        {
          path: 'identity.rentals[rental_1].address.city',
          value: 'Austin',
          source: 'user',
        },
        {
          path: 'identity.rentals[rental_1].address.state',
          value: 'TX',
          source: 'user',
        },
        {
          path: 'identity.rentals[rental_1].address.zip',
          value: '78702',
          source: 'user',
        },
        {
          path: 'identity.address.street',
          value: '1 Example St',
          source: 'user',
        },
        { path: 'identity.address.city', value: 'Austin', source: 'user' },
        { path: 'identity.address.state', value: 'TX', source: 'user' },
        { path: 'identity.address.zip', value: '78701', source: 'user' },
      ],
    },
    fakeDeps()
  );
  assert.ok(set.ok && set.rejected.length === 0, JSON.stringify(set));
});
afterEach(() => env.cleanup());

interface Item {
  str: string;
  x: number;
  y: number;
}

async function flatText(bytes: Uint8Array): Promise<Item[][]> {
  const doc = await PDFDocument.load(bytes);
  doc.getForm().flatten();
  const pdf = await getDocumentProxy(new Uint8Array(await doc.save()));
  const pages: Item[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    pages.push(
      tc.items
        .filter(
          (it): it is typeof it & { str: string; transform: number[] } =>
            'str' in it && !!it.str.trim()
        )
        .map((it) => ({
          str: it.str,
          x: it.transform[4]!,
          y: it.transform[5]!,
        }))
    );
  }
  return pages;
}

/** Rect of the widget at (page, x, y) in the blank form, as dump-fields prints it. */
async function rectAt(form: FormId, page: number, x: number, y: number) {
  const doc = await PDFDocument.load(
    await readFile(assetPath(2025, PDF_FOR_FORM[form]))
  );
  const pg = doc.getPages()[page - 1]!;
  for (const f of doc.getForm().getFields()) {
    if (!(f instanceof PDFTextField)) continue;
    for (const w of f.acroField.getWidgets()) {
      const r = w.getRectangle();
      const onPage = pg.node
        .Annots()
        ?.asArray()
        .some(
          (a) => a.toString() === doc.context.getObjectRef(w.dict)?.toString()
        );
      if (onPage && Math.round(r.x) === x && Math.round(r.y) === y) return r;
    }
  }
  throw new Error(`${form}: no text field at page ${page} (${x}, ${y})`);
}

async function textAt(
  pages: Item[][],
  form: FormId,
  page: number,
  x: number,
  y: number
): Promise<string> {
  const r = await rectAt(form, page, x, y);
  return pages[page - 1]!.filter(
    (i) =>
      i.x >= r.x - 1 &&
      i.x <= r.x + r.width &&
      i.y >= r.y - 2 &&
      i.y <= r.y + r.height
  )
    .map((i) => i.str)
    .join('');
}

async function filled() {
  const data = await (await openStore(ws)).read();
  const out = await fillReturn(data, result(data.facts));
  const pages = new Map<FormId, Item[][]>();
  for (const f of out.forms) pages.set(f.formId, await flatText(f.bytes));
  return { out, pages };
}

test('new forms: every line has a field (unmappedLines stays [])', async () => {
  const { out } = await filled();
  assert.deepEqual(out.unmapped, []);
  assert.deepEqual(
    out.forms.map((f) => f.formId),
    [
      'f1040',
      'sch1',
      'sch2',
      'schC.taxpayer',
      'schE',
      'schEIC',
      'f8959',
      'f8960',
      'f8829.taxpayer',
    ],
    'filing order follows the attachment sequence numbers'
  );
});

test('values print at the IRS positions of their lines', async () => {
  const { pages } = await filled();
  const at = (form: FormId, page: number, x: number, y: number) =>
    textAt(pages.get(form)!, form, page, x, y);
  const checks: [FormId, number, number, number, string][] = [
    // Form 1040 page 2: 25c, 27a
    ['f1040', 2, 410, 480, '400'],
    ['f1040', 2, 410, 420, '1,500'],
    // Schedule E: 1a/1b/2 for property A, line 3 A/B, 12 A, 19 B, 20 A, totals
    ['schE', 1, 66, 600, '12 Rental Rd, Austin, TX 78702'],
    ['schE', 1, 65, 540, '1'],
    ['schE', 1, 382, 540, '365'],
    ['schE', 1, 65, 528, '2'],
    ['schE', 1, 382, 528, '200'],
    ['schE', 1, 317, 438, '14,400'],
    ['schE', 1, 403, 438, '9,600'],
    ['schE', 1, 317, 354, '1,200'],
    ['schE', 1, 317, 318, '3,000'],
    ['schE', 1, 403, 234, '50'],
    ['schE', 1, 108, 234, 'Other rental expenses'],
    ['schE', 1, 317, 222, '4,200'],
    ['schE', 1, 403, 186, '9,000'],
    ['schE', 1, 403, 150, '24,000'],
    ['schE', 1, 403, 102, '4,800'],
    ['schE', 1, 490, 90, '19,200'],
    ['schE', 1, 490, 42, '19,200'],
    // Schedule EIC, child 1
    ['schEIC', 1, 210, 468, 'Robin Example'],
    ['schEIC', 1, 245, 330, '2'],
    ['schEIC', 1, 310, 330, '5'],
    ['schEIC', 1, 210, 150, 'child'],
    ['schEIC', 1, 230, 66, '12'],
    ['schEIC', 1, 36, 684, 'Pat Example'],
    // Form 8829
    ['f8829.taxpayer', 1, 490, 648, '200'],
    ['f8829.taxpayer', 1, 490, 636, '2,000'],
    ['f8829.taxpayer', 1, 490, 540, '10'],
    ['f8829.taxpayer', 1, 490, 504, '30,000'],
    ['f8829.taxpayer', 1, 382, 468, '9,000'],
    ['f8829.taxpayer', 1, 295, 372, '300'],
    ['f8829.taxpayer', 1, 382, 372, '1,200'],
    ['f8829.taxpayer', 1, 490, 144, '1,500'],
    ['f8829.taxpayer', 1, 36, 684, 'Pat Example'],
    // Form 8959
    ['f8959', 1, 410, 648, '250,000'],
    ['f8959', 1, 504, 528, '450'],
    ['f8959', 1, 504, 228, '450'],
    ['f8959', 1, 410, 192, '3,625'],
    ['f8959', 1, 504, 72, '400'],
    // Form 8960
    ['f8960', 1, 504, 636, '1,235'],
    ['f8960', 1, 504, 444, '1,235'],
    ['f8960', 1, 410, 300, '260,000'],
    ['f8960', 1, 410, 288, '200,000'],
    ['f8960', 1, 504, 240, '47'],
  ];
  for (const [form, page, x, y, want] of checks) {
    assert.equal(
      await at(form, page, x, y),
      want,
      `${form} p${page} (${x},${y})`
    );
  }
  // Schedule 1 lines 5 and 21, Schedule 2 lines 11 and 12 (field values)
  const data = await (await openStore(ws)).read();
  const out = await fillReturn(data, result(data.facts));
  const field = async (form: FormId, name: string) =>
    (
      (await PDFDocument.load(out.forms.find((f) => f.formId === form)!.bytes))
        .getForm()
        .getFields()
        .find((f) => f.getName().endsWith(`.${name}`)) as PDFTextField
    ).getText();
  assert.equal(await field('sch1', 'f1_09[0]'), '19,200');
  assert.equal(await field('sch1', 'f2_13[0]'), '2,500');
  assert.equal(await field('sch2', 'f1_22[0]'), '450');
  assert.equal(await field('sch2', 'f1_23[0]'), '47');
});

test('SSN boxes stay blank on every new form; handwrite says where', async () => {
  const { out, pages } = await filled();
  const blank = async (form: FormId, page: number, x: number, y: number) =>
    assert.equal(
      await textAt(pages.get(form)!, form, page, x, y),
      '',
      `${form} SSN box`
    );
  await blank('schE', 1, 454, 684);
  await blank('schEIC', 1, 469, 684);
  await blank('schEIC', 1, 210, 348); // line 2, child 1
  await blank('f8829.taxpayer', 1, 455, 684);
  await blank('f8959', 1, 446, 684);
  await blank('f8960', 1, 454, 684);
  const hw = out.handwrite;
  for (const want of [
    'Schedule E, "Your social security number" box (top right): write your SSN.',
    'Schedule EIC, "Your social security number" box (top right): write your SSN.',
    'Schedule EIC, line 2, Child 1 (Robin Example): write Robin Example’s SSN.',
    'Form 8829, "Social security number" box (top right): write your SSN.',
    'Form 8959, "Your social security number" box (top right): write your SSN.',
    'Form 8960, "Your social security number" box (top right): write your SSN.',
    'Form 1040, page 2, lines 35b and 35d (direct deposit): write your bank routing and account numbers and check 35c, if you want the refund deposited (leave them blank for a paper check).',
    'Schedule E, line 1a, property B: write the property’s street address, city, state and ZIP code.',
  ])
    assert.ok(
      hw.includes(want),
      `${want}\n not in ${JSON.stringify(hw, null, 1)}`
    );
});

test('entry sheet and mailing instructions cover the new forms', async () => {
  const d = deps();
  assert.ok((await calcReturn({ workspace: ws }, d)).ok);
  const review = await returnReview({ workspace: ws }, d);
  assert.ok(review.ok && review.ready, JSON.stringify(review));
  const ok = await returnReview({ workspace: ws, confirmed: true }, d);
  assert.ok(ok.ok && ok.confirmed, JSON.stringify(ok));
  const fill = await formsFill({ workspace: ws }, d);
  assert.ok(fill.ok, JSON.stringify(fill));
  assert.deepEqual(fill.unmappedLines, []);
  for (const path of ['fillable_forms', 'mail'] as const)
    assert.ok((await filingPrepare({ workspace: ws, path }, d)).ok);
  const sheet = await readFile(
    join(ws, 'outputs', '2025-free-file-fillable-forms.md'),
    'utf8'
  );
  assert.match(
    sheet,
    /- Schedule EIC, line 2, Child 1 \(Robin Example\): Robin Example’s SSN — \*\*type this yourself\*\*/
  );
  assert.match(
    sheet,
    /Child 1: Robin Example; SSN \*\*type this yourself\*\*; year of birth 2015/
  );
  assert.match(
    sheet,
    /Property A: 12 Rental Rd, Austin, TX 78702; type 1; fair rental days 365/
  );
  assert.match(sheet, /\| Schedule E \| 3:A \| Label schE:3:A \| 14,400 \|/);
  // Text and box entries the PDF prints are on the sheet too.
  assert.match(sheet, /- Line C, business name: Pat Example Design/);
  assert.match(sheet, /- Line A, principal business or profession: /);
  assert.match(
    sheet,
    /Dependent 1: Robin Example, child, .*Lived with you more than half the year/
  );
  assert.match(sheet, /- Someone can claim you as a dependent: /);
  // Lines 1a, 1b and 2 are in their own section, not in the amounts table.
  assert.doesNotMatch(sheet, /\| Schedule E \| (1a|1b|2)[.:]/);
  assert.match(sheet, /\| Form 8959 \| 18 \| Label f8959:18 \| 450 \|/);
  assert.match(
    sheet,
    /direct deposit\): your bank routing and account numbers.*\*\*type this yourself\*\*/
  );
  const mail = await readFile(
    join(ws, 'outputs', '2025-mailing-instructions.md'),
    'utf8'
  );
  const order = [
    'Schedule 1 (sequence no. 01)',
    'Schedule 2 (sequence no. 02)',
    'Schedule C (you) (sequence no. 09)',
    'Schedule E (sequence no. 13)',
    'Schedule EIC (sequence no. 43)',
    'Form 8959 (sequence no. 71)',
    'Form 8960 (sequence no. 72)',
    'Form 8829 (you) (sequence no. 176)',
  ].map((t) => mail.indexOf(t));
  assert.ok(
    order.every((i) => i > 0),
    mail
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order
  );
  assert.match(
    mail,
    /Form 1040, page 1, "Your social security number" box \(top right\): write your SSN\./
  );
});

test('Schedule EIC lines 4a/4b: older student and disabled child', async () => {
  await (
    await openStore(ws)
  ).write((d) => {
    d.facts.dependents[0]!.dateOfBirth = '2003-03-03';
    d.facts.dependents[0]!.fullTimeStudent = true;
    d.facts.dependents.push({
      id: 'dependent_2',
      dateOfBirth: '1990-01-01',
      relationship: 'sibling',
      monthsLivedWithTaxpayer: 12,
      permanentlyDisabled: true,
    });
  });
  const data = await (await openStore(ws)).read();
  const r = result(data.facts);
  r.nodes['schEIC:6:2'] = {
    ...r.nodes['schEIC:6:1']!,
    id: 'schEIC:6:2',
    line: '6:2',
    trace: {
      formula: 'f',
      inputs: [
        {
          ref: 'dependents[dependent_2].monthsLivedWithTaxpayer',
          kind: 'fact',
          value: 12,
        },
      ],
    },
  };
  const out = await fillReturn(data, r);
  const form = (
    await PDFDocument.load(out.forms.find((f) => f.formId === 'schEIC')!.bytes)
  ).getForm();
  const box = (suffix: string) =>
    (
      form
        .getFields()
        .find((f) => f.getName().endsWith(`.${suffix}`)) as PDFCheckBox
    ).isChecked();
  // child 1: 22, a student, younger than the taxpayer → 4a yes, 4b skipped
  assert.equal(
    box('Line4a_Child1_ReadOrder[0].Yes_ReadOrder[0].c1_1[0]'),
    true
  );
  assert.equal(
    box('Line4b_Child1_ReadOrder[0].Yes_ReadOrder[0].c1_4[0]'),
    false
  );
  assert.equal(box('Line4b_Child1_ReadOrder[0].c1_4[0]'), false);
  // child 2: 35, so not a student under 24 → 4a no, 4b disabled yes
  assert.equal(box('Line4a_Child2_ReadOrder[0].c1_2[0]'), true);
  assert.equal(
    box('Line4b_Child2_ReadOrder[0].Yes_ReadOrder[0].c1_5[0]'),
    true
  );
  assert.ok(
    out.handwrite.includes(
      'Schedule EIC, line 2, Child 2 (dependent_2): write dependent_2’s SSN.'
    ),
    JSON.stringify(out.handwrite)
  );
});
