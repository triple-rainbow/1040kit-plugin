import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { categorize } from '../src/expenses/categorize.ts';
import { parseStatement } from '../src/expenses/parse.ts';
import { openStore } from '../src/store/workspace.ts';
import { handler as expensesImport } from '../src/tools/expenses-import.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { fakeDeps, freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let ws: string;
const deps = fakeDeps();

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025, acknowledged: true }, deps);
  assert.ok(r.ok);
  ws = r.workspace;
});
afterEach(() => env.cleanup());

const DEBIT_CREDIT = `Date,Description,Debit,Credit,Balance
01/03/2025,ADOBE *CREATIVE CLD,59.99,,1000.00
01/05/2025,STAPLES 00123,"1,024.50",,
01/09/2025,CLIENT PAYMENT ACME,,2500.00,
01/12/2025,WHOLE FOODS MKT,82.10,,
`;

const CHASE_CARD = `Transaction Date,Post Date,Description,Category,Type,Amount,Memo
01/02/2025,01/03/2025,GITHUB INC,Shopping,Sale,-4.00,
01/04/2025,01/05/2025,DELTA AIR LINES,Travel,Sale,-412.30,
01/06/2025,01/07/2025,DELTA AIR LINES,Travel,Return,412.30,
01/10/2025,01/10/2025,Payment Thank You-Mobile,,Payment,500.00,
01/11/2025,01/12/2025,MYSTERY SHOP 4111 1111 1111 1111,Shopping,Sale,-20.00,
`;

async function put(name: string, text: string) {
  await writeFile(join(ws, 'inbox', name), text);
}

test('parses debit/credit layout', () => {
  const s = parseStatement(DEBIT_CREDIT);
  assert.equal(s.layout, 'debit_credit');
  assert.equal(s.rows.length, 3);
  assert.deepEqual(
    s.rows.map((r) => [r.date, r.amount]),
    [
      ['2025-01-03', 5999],
      ['2025-01-05', 102450],
      ['2025-01-12', 8210],
    ]
  );
  assert.equal(s.ignored.length, 1);
  assert.match(s.ignored[0]!.reason, /credit/i);
});

test('detects Chase card layout and signs', () => {
  const s = parseStatement(CHASE_CARD);
  assert.equal(s.layout, 'chase_card');
  assert.deepEqual(
    s.rows.map((r) => r.amount),
    [400, 41230, 2000]
  );
  assert.equal(s.ignored.length, 2);
});

test('proposes software for "ADOBE *CREATIVE CLD"', () => {
  const c = categorize({ description: 'ADOBE *CREATIVE CLD' });
  assert.equal(c.proposed, 'other');
  assert.match(c.reason, /software/i);
  assert.equal(
    categorize({ description: 'STAPLES 00123' }).proposed,
    'supplies'
  );
  assert.equal(
    categorize({ description: 'WHOLE FOODS MKT' }).proposed,
    'personal'
  );
  assert.equal(
    categorize({ description: 'DELTA AIR LINES' }).proposed,
    'travel'
  );
  assert.equal(categorize({ description: 'ZZZ UNKNOWN' }).proposed, 'unsure');
});

test('refunds/credits are not expenses', async () => {
  await put('card.csv', CHASE_CARD);
  const r = await expensesImport(
    { workspace: ws, file: 'card.csv', owner: 'taxpayer', action: 'propose' },
    deps
  );
  assert.ok(r.ok, JSON.stringify(r));
  const p = r as any;
  assert.ok(p.rows.every((row: any) => row.amount > 0));
  assert.ok(
    !p.rows.some((row: any) => /Payment Thank You/.test(row.description))
  );
  assert.equal(p.ignored.length, 2);
  // card number in a description never reaches the model
  assert.ok(!JSON.stringify(r).includes('1111'));
});

test('confirm writes totals', async () => {
  await put('bank.csv', DEBIT_CREDIT);
  const prop = (await expensesImport(
    { workspace: ws, file: 'bank.csv', owner: 'taxpayer', action: 'propose' },
    deps
  )) as any;
  assert.ok(prop.ok);
  const decisions = prop.rows.map((row: any) => ({
    rowId: row.rowId,
    category: row.proposed === 'unsure' ? 'personal' : row.proposed,
  }));
  const r = (await expensesImport(
    {
      workspace: ws,
      file: 'bank.csv',
      owner: 'taxpayer',
      action: 'confirm',
      decisions,
    },
    deps
  )) as any;
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.byCategory, { other: 5999, supplies: 102450 });
  const d = await (await openStore(ws)).read();
  const biz = d.facts.businesses.find((b) => b.owner === 'taxpayer')!;
  assert.deepEqual(biz.expenses, { other: 5999, supplies: 102450 });
  const prov = d.provenance['businesses[taxpayer].expenses.supplies']!;
  assert.equal(prov.source, 'user');
  assert.equal(prov.note, 'expenses_import:bank.csv');
});

test('confirm twice does not double', async () => {
  await put('bank.csv', DEBIT_CREDIT);
  const store = await openStore(ws);
  // a manual amount entered before the import is kept
  await store.write((d) => {
    d.facts.businesses.push({
      owner: 'taxpayer',
      expenses: { supplies: 10000 },
    });
  });
  const prop = (await expensesImport(
    { workspace: ws, file: 'bank.csv', owner: 'taxpayer', action: 'propose' },
    deps
  )) as any;
  const staples = prop.rows.find((r: any) =>
    /STAPLES/.test(r.description)
  ).rowId;
  const adobe = prop.rows.find((r: any) => /ADOBE/.test(r.description)).rowId;
  const confirm = (decisions: unknown) =>
    expensesImport(
      {
        workspace: ws,
        file: 'bank.csv',
        owner: 'taxpayer',
        action: 'confirm',
        decisions,
      } as any,
      deps
    );
  await confirm([
    { rowId: staples, category: 'supplies' },
    { rowId: adobe, category: 'other' },
  ]);
  await confirm([
    { rowId: staples, category: 'supplies' },
    { rowId: adobe, category: 'other' },
  ]);
  let biz = (await store.read()).facts.businesses[0]!;
  assert.deepEqual(biz.expenses, { supplies: 112450, other: 5999 });
  // changing a decision replaces the earlier import
  await confirm([{ rowId: staples, category: 'office' }]);
  biz = (await store.read()).facts.businesses[0]!;
  assert.deepEqual(biz.expenses, { supplies: 10000, office: 102450 });
});

test('unknown rows and files outside the workspace are refused', async () => {
  await put('bank.csv', DEBIT_CREDIT);
  const bad = (await expensesImport(
    {
      workspace: ws,
      file: 'bank.csv',
      owner: 'taxpayer',
      action: 'confirm',
      decisions: [{ rowId: 'r999', category: 'supplies' }],
    },
    deps
  )) as any;
  assert.ok(bad.ok);
  assert.deepEqual(bad.rejected, [
    { rowId: 'r999', reason: 'no such expense row in this file' },
  ]);
  const outside = await expensesImport(
    { workspace: ws, file: '/etc/hosts', owner: 'taxpayer', action: 'propose' },
    deps
  );
  assert.equal(outside.ok, false);
  assert.equal(!outside.ok && outside.error.code, 'FILE_OUTSIDE_WORKSPACE');
  const escape = await expensesImport(
    {
      workspace: ws,
      file: '../../x.csv',
      owner: 'taxpayer',
      action: 'propose',
    },
    deps
  );
  assert.equal(!escape.ok && escape.error.code, 'FILE_OUTSIDE_WORKSPACE');
});
