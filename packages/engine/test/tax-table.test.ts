import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { getParams } from '../src/params/index.ts';
import { taxOnOrdinary } from '../src/tax/table.ts';
import type { FilingStatus } from '../src/types.ts';

const p2025 = getParams(2025);

test('tax table uses row midpoint (2025 Tax Table, single, 50,000-50,050 = 5,920)', () => {
  // i1040tt.pdf (2025 Tax Table), row "50,000 50,050": Single 5,920.
  assert.equal(taxOnOrdinary(50000, 'single', p2025), 5920);
  assert.equal(taxOnOrdinary(50049, 'single', p2025), 5920);
});

test('tax computation worksheet above 100k (2025, MFJ 150,000 = 22,828)', () => {
  // 2025 Tax Computation Worksheet, Section B: 150,000 x 22% - 10,172.00 = 22,828.
  assert.equal(taxOnOrdinary(150000, 'mfj', p2025), 22828);
  // Section A, single 300,000: 300,000 x 35% - 30,452.75 = 74,547.25 -> 74,547
  assert.equal(taxOnOrdinary(300000, 'single', p2025), 74547);
  // Section D, HoH 700,000: 700,000 x 37% - 44,718 = 214,282
  assert.equal(taxOnOrdinary(700000, 'hoh', p2025), 214282);
});

test('zero and tiny incomes', () => {
  assert.equal(taxOnOrdinary(0, 'single', p2025), 0);
  assert.equal(taxOnOrdinary(4, 'single', p2025), 0); // row 0-5
  assert.equal(taxOnOrdinary(10, 'single', p2025), 1); // row 5-15
  assert.equal(taxOnOrdinary(20, 'mfj', p2025), 2); // row 15-25
});

test('formula reproduces every row of the published 2025 Tax Table', () => {
  const table = JSON.parse(
    readFileSync(
      new URL('./fixtures/tax-table-2025.json', import.meta.url),
      'utf8'
    )
  ) as { rows: [number, number, number, number, number, number][] };
  assert.ok(table.rows.length > 2000);
  const statuses: [FilingStatus, number][] = [
    ['single', 2],
    ['mfj', 3],
    ['hoh', 5],
  ];
  const mismatches: string[] = [];
  for (const row of table.rows) {
    for (const [status, col] of statuses) {
      const lo = row[0];
      const hi = row[1] - 1;
      const expected = row[col];
      for (const ti of [lo, hi]) {
        const got = taxOnOrdinary(ti, status, p2025);
        if (got !== expected)
          mismatches.push(`${status} ${ti}: ${got} != ${expected}`);
      }
    }
  }
  assert.deepEqual(mismatches.slice(0, 10), []);
});
