import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { openStore } from '../src/store/workspace.ts';
import { handler as docsExtract } from '../src/tools/docs-extract.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as profileGet } from '../src/tools/profile-get.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { w2Pdf } from './fixtures/make-pdfs.ts';
import { fakeDeps, freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let ws: string;
const deps = fakeDeps();

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025 }, deps);
  assert.ok(r.ok);
  ws = r.workspace;
});
afterEach(() => env.cleanup());

type SetItem = {
  path: string;
  value: unknown;
  source: 'user' | 'inferred';
  note?: string;
};
async function set(...items: SetItem[]) {
  const r = await profileSet({ workspace: ws, set: items as any }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}
const user = (path: string, value: unknown): SetItem => ({
  path,
  value,
  source: 'user',
});
const read = async () => (await openStore(ws)).read();

test('profile_set records provenance', async () => {
  const r = await set(user('filingStatus', 'single'), {
    path: 'taxpayer.dateOfBirth',
    value: '1990-04-01',
    source: 'inferred',
    note: 'from the W-2 age hint',
  });
  assert.deepEqual(r.updated, ['filingStatus', 'taxpayer.dateOfBirth']);
  assert.deepEqual(r.rejected, []);
  const d = await read();
  assert.equal(d.facts.filingStatus, 'single');
  assert.equal(d.facts.taxpayer.dateOfBirth, '1990-04-01');
  assert.equal(d.provenance['filingStatus']?.source, 'user');
  assert.equal(d.provenance['filingStatus']?.at, deps.now().toISOString());
  assert.equal(d.provenance['taxpayer.dateOfBirth']?.source, 'inferred');
  const g = await profileGet({ workspace: ws, paths: ['filingStatus'] }, deps);
  assert.ok(g.ok);
  assert.equal((g as any).values.filingStatus, 'single');
  assert.equal((g as any).provenance.filingStatus.sourceText, 'you told me');
});

test('user override of doc value is recorded', async () => {
  const st = await openStore(ws);
  await writeFile(join(ws, 'inbox', 'w2.pdf'), await w2Pdf());
  await docsScan({ workspace: ws }, deps);
  await docsExtract({ workspace: ws }, deps);
  const docId = (await st.read()).docs[0]!.docId;
  await set(user('w2s[w2_1].federalWithheld', 600000));
  const d = await st.read();
  assert.equal(d.facts.w2s[0]!.federalWithheld, 600000);
  assert.equal(d.provenance['w2s[w2_1].federalWithheld']?.source, 'user');
  assert.equal(d.provenance['w2s[w2_1].federalWithheld']?.overrides, 'doc');
  assert.equal(d.provenance['w2s[w2_1].federalWithheld']?.docId, docId);
});

test('rejects unknown path', async () => {
  const before = await read();
  const r = await set(
    user('taxpayer.favoriteColor', 'blue'),
    user('nonsense[[', 1)
  );
  assert.deepEqual(r.updated, []);
  assert.equal(r.rejected.length, 2);
  assert.match(r.rejected[0]!.reason, /favoriteColor/);
  const after = await read();
  assert.deepEqual(after.facts, before.facts);
  assert.deepEqual(after.provenance, before.provenance);
});

test('rejects bad values and keeps the good ones', async () => {
  const r = await set(
    user('filingStatus', 'mfs'),
    user('payments.estimatedTaxPayments', 12.5),
    user('payments.estimatedTaxPayments', 125000)
  );
  assert.deepEqual(r.updated, ['payments.estimatedTaxPayments']);
  assert.equal(r.rejected.length, 2);
  assert.equal((await read()).facts.payments?.estimatedTaxPayments, 125000);
});

test('rejects raw SSNs anywhere', async () => {
  const r = await set(
    user('taxpayer.ssnToken', '123-45-6789'),
    user('businesses[taxpayer].name', 'Pat 123-45-6789 LLC'),
    user('dependents[dependent_1].ssnToken', '{{SSN:dependent_1}}')
  );
  assert.deepEqual(r.updated, []);
  assert.equal(r.rejected.length, 3);
  assert.ok(!JSON.stringify(r).includes('6789'));
  assert.equal((await read()).facts.dependents.length, 0);
});

test('creates dependents and businesses on first use', async () => {
  const r = await set(
    user('dependents[dependent_2].dateOfBirth', '2015-06-01'),
    user('dependents[dependent_2].relationship', 'child'),
    user('businesses[taxpayer].expenses.supplies', 12000),
    user('identity.dependents[dependent_2].firstName', 'Robin')
  );
  assert.equal(r.rejected.length, 0, JSON.stringify(r));
  const d = await read();
  assert.deepEqual(d.facts.dependents, [
    { id: 'dependent_2', dateOfBirth: '2015-06-01', relationship: 'child' },
  ]);
  assert.deepEqual(d.facts.businesses, [
    { owner: 'taxpayer', expenses: { supplies: 12000 } },
  ]);
  assert.equal(d.identity.dependents?.dependent_2?.firstName, 'Robin');
});

test('new W-2 needs an owner in the same batch', async () => {
  const bad = await set(user('w2s[w2_9].wages', 100000));
  assert.deepEqual(bad.updated, []);
  assert.match(bad.rejected[0]!.reason, /owner/);
  assert.equal((await read()).facts.w2s.length, 0);

  const good = await set(
    user('w2s[w2_9].wages', 100000),
    user('w2s[w2_9].owner', 'spouse')
  );
  assert.deepEqual(good.rejected, []);
  const w2 = (await read()).facts.w2s[0]!;
  assert.equal(w2.owner, 'spouse');
  assert.equal(w2.wages, 100000);
  assert.equal(w2.federalWithheld, 0);
});

test('null deletes an item and records provenance', async () => {
  await set(user('dependents[dependent_1].dateOfBirth', '2016-01-01'));
  const r = await set(user('dependents[dependent_1]', null));
  assert.deepEqual(r.updated, ['dependents[dependent_1]']);
  const d = await read();
  assert.equal(d.facts.dependents.length, 0);
  assert.equal(d.provenance['dependents[dependent_1].dateOfBirth'], undefined);
  assert.equal(d.provenance['dependents[dependent_1]']?.note, 'removed');
});

test('tax year cannot change', async () => {
  const r = await set(user('taxYear', 2026));
  assert.equal(r.rejected.length, 1);
});

test('rentals: create on first use, owner required, delete with null', async () => {
  const r = await set(
    user('rentals[rental_1].propertyType', 1),
    user('rentals[rental_1].expenses.repairs', 45000),
    user('rentals[rental_1].owner', 'joint'),
    user('identity.rentals[rental_1].address.street', '12 Rental Rd'),
    user('identity.rentals[rental_1].address.zip', '78702')
  );
  assert.deepEqual(r.rejected, []);
  let d = await read();
  assert.deepEqual(d.facts.rentals, [
    {
      id: 'rental_1',
      expenses: { repairs: 45000 },
      propertyType: 1,
      owner: 'joint',
    },
  ]);
  assert.equal(d.identity.rentals?.rental_1?.address?.street, '12 Rental Rd');

  const noOwner = await set(user('rentals[rental_2].fairRentalDays', 200));
  assert.match(noOwner.rejected[0]!.reason, /taxpayer, spouse or joint/);
  const bad = await set(
    user('rentals[rental_1].propertyType', 9),
    user('rentals[rental_1].expenses.depreciation', 100),
    user('identity.rentals[rental_1].address.zip', 'abc')
  );
  assert.equal(bad.rejected.length, 3, JSON.stringify(bad));

  await set(user('rentals[rental_1]', null));
  d = await read();
  assert.deepEqual(d.facts.rentals, []);
  assert.equal(d.provenance['rentals[rental_1]']?.note, 'removed');
  assert.equal(d.provenance['rentals[rental_1].propertyType'], undefined);
});

test('contract additions: 1098-E, actual home office, student loan, EITC, screening', async () => {
  const r = await set(
    user('e1098s[e1098_1].interest', 184500),
    user('e1098s[e1098_1].owner', 'taxpayer'),
    user('e1098s[e1098_1].box2Checked', true),
    user('adjustments.studentLoanInterestOther', 30000),
    user('studentLoan.legallyObligated', true),
    user('studentLoan.qualifiedLoan', true),
    user('eitc.priorDisallowance', false),
    user('screening.hasRentalOrRoyaltyIncome', false),
    user('screening.paidStudentLoanInterest', true),
    user('taxpayer.livedInUsOverHalfYear', true),
    user('taxpayer.qualifyingChildOfAnother', false),
    user('businesses[taxpayer].homeOffice', {
      method: 'actual',
      officeSquareFeet: 200,
      homeSquareFeet: 2000,
      ownership: 'own',
      indirect: { mortgage_interest: 900000, utilities: 300000 },
      home: {
        basisOrValue: 40000000,
        landValue: 8000000,
        businessUseStart: '2024-01-01',
      },
      carryover: { operating: 10000 },
    })
  );
  assert.deepEqual(r.rejected, []);
  const d = await read();
  assert.deepEqual(d.facts.e1098s, [
    { id: 'e1098_1', interest: 184500, owner: 'taxpayer', box2Checked: true },
  ]);
  assert.equal(d.facts.businesses[0]!.homeOffice?.method, 'actual');
  assert.equal(d.facts.taxpayer.livedInUsOverHalfYear, true);

  const removed = await set(
    user('outOfScope.rentalIncome', false),
    user('outOfScope.studentLoanInterest', false),
    user('taxpayer.ssnToken', '{{SSN:taxpayer}}'),
    user('businesses[taxpayer].homeOffice.indirect.pool', 100)
  );
  assert.deepEqual(removed.updated, []);
  assert.equal(removed.rejected.length, 4, JSON.stringify(removed));
});
