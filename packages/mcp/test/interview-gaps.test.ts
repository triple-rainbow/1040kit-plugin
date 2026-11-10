/**
 * Gaps found by the end-user run of the golden returns: the spouse's name
 * without documents, the main filer on a joint return, blindness, estimated
 * tax receipts, business and rental expense checklists, the home office,
 * the rental form, and an interview that only moves forward.
 * Real engine, synthetic people only.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { defaultDeps } from '../src/deps.ts';
import { openStore } from '../src/store/workspace.ts';
import { handler as docsExtract } from '../src/tools/docs-extract.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as interviewNext } from '../src/tools/interview-next.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { estPaymentPdf, w2Pdf } from './fixtures/make-pdfs.ts';
import { freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let ws: string;
let inbox: string;
const deps = () => ({
  ...defaultDeps(),
  kbFetch: (async () => {
    throw new Error('no network');
  }) as typeof fetch,
});

async function set(items: [string, unknown][]) {
  return profileSet(
    {
      workspace: ws,
      set: items.map(([path, value]) => ({
        path,
        value,
        source: 'user',
      })) as never,
    },
    deps()
  );
}
async function next(limit = 20) {
  const r = await interviewNext({ workspace: ws, limit }, deps());
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}
const data = async () => (await openStore(ws)).read();

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025, acknowledged: true }, deps());
  assert.ok(r.ok);
  ws = r.workspace;
  inbox = r.inbox;
});
afterEach(async () => env.cleanup());

test('a spouse without documents can still be named (joint return)', async () => {
  const r = await set([
    ['filingStatus', 'mfj'],
    ['identity.spouse.firstName', 'Sam'],
    ['identity.spouse.lastName', 'Example'],
    ['identity.spouse.occupation', 'Teacher'],
  ]);
  assert.ok(r.ok && r.rejected.length === 0, JSON.stringify(r));
  assert.deepEqual((await data()).identity.spouse, {
    firstName: 'Sam',
    lastName: 'Example',
    occupation: 'Teacher',
  });
  // One field at a time works too.
  const one = await set([['identity.spouse.firstName', 'Robin']]);
  assert.ok(one.ok && one.rejected.length === 0, JSON.stringify(one));
});

test('the household form: names read from documents come filled in; spouse rows only for a joint return', async () => {
  await writeFile(join(inbox, 'w2.pdf'), await w2Pdf());
  await docsScan({ workspace: ws }, deps());
  await docsExtract({ workspace: ws }, deps());
  const r = await next();
  const q = r.questions.find((x) => x.path === 'household');
  assert.ok(
    q && q.answer.kind === 'group',
    JSON.stringify(r.questions.map((x) => x.path))
  );
  const field = (p: string) =>
    q.answer.kind === 'group' && q.answer.fields.find((f) => f.path === p);
  assert.equal((field('identity.taxpayer.firstName') || {}).value, 'Pat');
  assert.equal((field('identity.taxpayer.lastName') || {}).value, 'Example');
  assert.ok(field('filingStatus'));
  const blind = field('taxpayer.blind');
  assert.ok(blind && blind.answer.kind === 'check');
  // Filing status not chosen yet: the spouse's rows and the switch show only for "mfj".
  const spouse = field('identity.spouse.firstName');
  assert.ok(spouse);
  assert.deepEqual(spouse.showIf, { path: 'filingStatus', equals: 'mfj' });
  const swap = field('mainFiler');
  assert.ok(swap && swap.answer.kind === 'swap');
  // A single filer: no spouse rows.
  await set([['filingStatus', 'single']]);
  const r2 = await next();
  const q2 = r2.questions.find((x) => x.path === 'household');
  assert.ok(q2 && q2.answer.kind === 'group');
  assert.ok(
    !q2.answer.fields.some(
      (f) => f.path.includes('spouse') || f.path === 'mainFiler'
    )
  );
});

test('the main filer switch swaps the two people and everything each owns', async () => {
  await set([
    ['filingStatus', 'mfj'],
    ['w2s[w2_1].owner', 'taxpayer'],
    ['w2s[w2_1].wages', 5000000],
    ['businesses[spouse].name', 'Studio'],
    ['adjustments.sepContributions.spouse', 100000],
    ['identity.taxpayer.firstName', 'Sam'],
    ['identity.spouse.firstName', 'Pat'],
    ['spouse.dateOfBirth', '1980-01-01'],
  ]);
  // The form sends the switch first, then the names as shown after it.
  const r = await set([
    ['identity.taxpayer.lastName', 'Example'],
    ['mainFiler', 'spouse'],
  ]);
  assert.ok(r.ok && r.rejected.length === 0, JSON.stringify(r));
  const d = await data();
  assert.equal(d.facts.w2s[0]!.owner, 'spouse');
  assert.equal(d.facts.businesses[0]!.owner, 'taxpayer');
  assert.deepEqual(d.facts.adjustments?.sepContributions, { taxpayer: 100000 });
  assert.equal(d.facts.taxpayer.id, 'taxpayer');
  assert.equal(d.facts.taxpayer.dateOfBirth, '1980-01-01');
  assert.equal(d.facts.spouse?.id, 'spouse');
  assert.equal(d.identity.taxpayer?.firstName, 'Pat');
  assert.equal(d.identity.spouse?.firstName, 'Sam');
  // The last name was sent after the switch: it is the new main filer's.
  assert.equal(d.identity.taxpayer?.lastName, 'Example');
  assert.ok(d.provenance['businesses[taxpayer].name']);
  assert.ok(!d.provenance['businesses[spouse].name']);
  assert.ok(d.answers.mainFiler);
  // "taxpayer" keeps things as they are.
  await set([['mainFiler', 'taxpayer']]);
  assert.equal((await data()).identity.taxpayer?.firstName, 'Pat');
});

test('a home office can be saved one field at a time, and its method changed', async () => {
  await set([
    ['businesses[taxpayer].name', 'Design'],
    [
      'businesses[taxpayer].homeOffice',
      { method: 'simplified', squareFeet: 200 },
    ],
  ]);
  const r = await set([
    ['businesses[taxpayer].homeOffice.method', 'actual'],
    ['businesses[taxpayer].homeOffice.officeSquareFeet', 200],
    ['businesses[taxpayer].homeOffice.homeSquareFeet', 1600],
    ['businesses[taxpayer].homeOffice.ownership', 'rent'],
    [
      'businesses[taxpayer].homeOffice.indirect',
      { rent: 2400000, utilities: 300000 },
    ],
  ]);
  assert.ok(r.ok && r.rejected.length === 0, JSON.stringify(r));
  assert.deepEqual((await data()).facts.businesses[0]!.homeOffice, {
    method: 'actual',
    officeSquareFeet: 200,
    homeSquareFeet: 1600,
    ownership: 'rent',
    indirect: { rent: 2400000, utilities: 300000 },
  });
  // An incomplete batch is still checked one write at a time.
  const bad = await set([
    ['businesses[taxpayer].homeOffice.method', 'simplified'],
  ]);
  assert.ok(bad.ok);
  assert.equal(bad.rejected.length, 1);
});

test('estimated tax receipts in the inbox are read and named in the payments part', async () => {
  await writeFile(join(inbox, 'q1.pdf'), await estPaymentPdf());
  await writeFile(
    join(inbox, 'q2.pdf'),
    await estPaymentPdf({ amount: '1,750.00', date: '06/16/2025' })
  );
  await writeFile(
    join(inbox, 'old.pdf'),
    await estPaymentPdf({ period: '2024', date: '01/15/2025' })
  );
  await writeFile(
    join(inbox, 'ext.pdf'),
    await estPaymentPdf({
      reason: 'Extension',
      date: '04/15/2025',
      amount: '900.00',
    })
  );
  const scan = await docsScan({ workspace: ws }, deps());
  assert.ok(scan.ok);
  assert.ok(
    scan.documents.every((d) => d.kind === 'est_payment'),
    JSON.stringify(scan.documents)
  );
  const ex = await docsExtract({ workspace: ws }, deps());
  assert.ok(ex.ok, JSON.stringify(ex));
  const d = await data();
  assert.deepEqual(
    (d.facts.estimatedPayments ?? []).map((p) => [p.amount, p.date]).sort(),
    [
      [150000, '2025-04-15'],
      [175000, '2025-06-16'],
    ]
  );
  const reasons = ex.skipped.map((s) => s.reason).sort();
  assert.deepEqual(reasons, [
    'not_estimated_payment:extension',
    'other_tax_year:2024',
  ]);
  // No confirmation numbers kept.
  assert.ok(!JSON.stringify(d).includes('0000-0000-0000'));
  const m = (await deps().engine.requiredFacts(d.facts)).find(
    (x) => x.path === 'payments.estimatedTaxPayments'
  );
  assert.ok(m);
  assert.match(m.why, /\$1,500\.00 on 2025-04-15/);
});

test('business expenses come as one checklist; saving it records each total and the step', async () => {
  await set([
    ['filingStatus', 'single'],
    ['nec1099s[nec_1].owner', 'taxpayer'],
    ['nec1099s[nec_1].nonemployeeComp', 3000000],
    ['businesses[taxpayer].name', 'Design'],
  ]);
  const d = await data();
  const { workspaceForms } = await import('../src/ui/interview-forms.ts');
  const { planQuestions } = await import('../src/ui/interview-plan.ts');
  const planned = workspaceForms(
    planQuestions(deps().engine.requiredFacts(d.facts), 2025),
    d
  );
  const q = planned.find(
    (x) => x.path === 'businesses[taxpayer].expensesReviewed'
  );
  assert.ok(q && q.answer.kind === 'checklist');
  assert.equal(q.phase, 'deductions');
  assert.ok(
    q.answer.items.some(
      (i) => i.path === 'businesses[taxpayer].expenses.supplies'
    )
  );
  assert.ok(!q.answer.items.some((i) => i.path.endsWith('.car_truck')));
  assert.match(q.answer.note ?? '', /don’t send receipts/);
  const r = await set([
    ['businesses[taxpayer].expenses.supplies', 120000],
    ['businesses[taxpayer].expensesReviewed', true],
  ]);
  assert.ok(r.ok && r.rejected.length === 0);
  assert.ok(
    !deps()
      .engine.requiredFacts((await data()).facts)
      .some((x) => x.path.endsWith('expensesReviewed'))
  );
});

test('a rental is entered with one form, and its 1099-MISC is linked with a choice', async () => {
  await set([
    ['filingStatus', 'single'],
    ['screening.hasRentalOrRoyaltyIncome', true],
    ['misc1099s[misc_1].owner', 'taxpayer'],
    ['misc1099s[misc_1].rents', 1800000],
    ['misc1099s[misc_1].treatAsBusiness', false],
  ]);
  const { workspaceForms } = await import('../src/ui/interview-forms.ts');
  const { planQuestions } = await import('../src/ui/interview-plan.ts');
  const plan = async () => {
    const d = await data();
    return workspaceForms(
      planQuestions(deps().engine.requiredFacts(d.facts), 2025),
      d
    );
  };
  const form = (await plan()).find((x) => x.path === 'rentals');
  assert.ok(form && form.answer.kind === 'group');
  assert.equal(form.answer.addAnother?.idPrefix, 'rental_');
  // Saving the form as the card does: every field in one call (owner hidden and prefilled).
  const values: Record<string, unknown> = {
    'rentals[rental_1].owner': 'taxpayer',
    'rentals[rental_1].propertyType': 2,
    'identity.rentals[rental_1].address.street': '9 Elm St',
    'identity.rentals[rental_1].address.city': 'Austin',
    'identity.rentals[rental_1].address.state': 'TX',
    'identity.rentals[rental_1].address.zip': '78702',
    'rentals[rental_1].fairRentalDays': 365,
    'rentals[rental_1].personalUseDays': 0,
  };
  assert.deepEqual(
    form.answer.fields
      .filter((f) => !f.optional)
      .map((f) => f.path)
      .sort(),
    Object.keys(values).sort()
  );
  const r = await set(Object.entries(values));
  assert.ok(r.ok && r.rejected.length === 0, JSON.stringify(r));
  const link = (await plan()).find(
    (x) => x.path === 'misc1099s[misc_1].rentalId'
  );
  assert.ok(link && link.answer.kind === 'choice');
  assert.deepEqual(link.answer.options, [
    { value: 'rental_1', label: '9 Elm St' },
  ]);
  const r2 = await set([['misc1099s[misc_1].rentalId', 'rental_1']]);
  assert.ok(r2.ok && r2.rejected.length === 0, JSON.stringify(r2));
  const calc = deps().engine.computeReturn((await data()).facts);
  assert.equal(calc.nodes['schE.totalRents']?.value, 18000);
});

test('the interview only moves forward: a late income question is asked in the current part', async () => {
  await set([
    ['filingStatus', 'single'],
    ['identity.taxpayer.firstName', 'Pat'],
    ['identity.taxpayer.lastName', 'Example'],
    ['identity.address.street', '1 Main St'],
    ['identity.address.city', 'Austin'],
    ['identity.address.state', 'TX'],
    ['identity.address.zip', '78701'],
    ['taxpayer.dateOfBirth', '1990-01-01'],
    ['taxpayer.canBeClaimedAsDependent', false],
    ['w2s[w2_1].owner', 'taxpayer'],
    ['w2s[w2_1].wages', 9000000],
    ['screening.paidStudentLoanInterest', true],
  ]);
  const none = (await next()).questions[0]!;
  assert.equal(none.path, 'situations');
  assert.ok(none.answer.kind === 'multiselect');
  await set([
    ...none.answer.options
      .filter((o) => o.path !== 'screening.paidStudentLoanInterest')
      .map((o): [string, unknown] => [o.path, false]),
    ['outOfScope.other', []],
  ]);
  const deductions = await next();
  assert.equal(deductions.phase, 'deductions');
  // A new income question turns up (the date of birth was removed): asked here, not by going back.
  await set([['taxpayer.dateOfBirth', null]]);
  const later = await next();
  assert.equal(later.phase, 'deductions');
});
