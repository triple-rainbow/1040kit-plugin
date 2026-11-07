import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { getParams } from '../src/params/index.ts';
import { eicTableCredit } from '../src/tax/eic.ts';
import type { FilingStatus } from '../src/types.ts';

const p2025 = getParams(2025);

interface Fixture {
  rows: number[][];
  splits: {
    atLeast: number;
    lessThan: number;
    column: number;
    credit: number;
  }[];
}
const table = JSON.parse(
  readFileSync(
    new URL('./fixtures/eic-table-2025.json', import.meta.url),
    'utf8'
  )
) as Fixture;

const COLUMNS: [FilingStatus, number][] = [
  ['single', 0],
  ['single', 1],
  ['single', 2],
  ['single', 3],
  ['mfj', 0],
  ['mfj', 1],
  ['mfj', 2],
  ['mfj', 3],
];

test('EIC Table fixture covers 1 to 68,700 in $50 rows', () => {
  assert.equal(table.rows.length, 1374);
  assert.deepEqual(table.rows[0]!.slice(0, 2), [1, 50]);
  assert.deepEqual(table.rows.at(-1)!.slice(0, 2), [68650, 68700]);
  for (let i = 1; i < table.rows.length; i++)
    assert.equal(table.rows[i]![0], table.rows[i - 1]![1]);
  assert.equal(table.splits.length, 8);
});

test('the six "NaN" cells of the IRS EPUB are 0, as printed in i1040gi.pdf', () => {
  for (const atLeast of [24750, 31150, 56750, 61550, 66350, 68650]) {
    const row = table.rows.find((r) => r[0] === atLeast);
    assert.ok(row, `row ${atLeast}`);
    assert.equal(row[2], 0, `single/HoH, no children, row ${atLeast}`);
  }
});

test('engine reproduces every cell of the 2025 EIC Table, including the footnote rows', () => {
  const split = new Map(
    table.splits.map((s) => [`${s.atLeast}:${s.column}`, s])
  );
  const bad: string[] = [];
  let checked = 0;
  for (const row of table.rows) {
    const [lo, hi] = row as [number, number];
    COLUMNS.forEach(([status, kids], c) => {
      const s = split.get(`${lo}:${c}`);
      const cases: [number, number][] = s
        ? [
            [lo, s.credit],
            [s.lessThan - 1, s.credit],
            [s.lessThan, 0],
            [hi - 1, 0],
          ]
        : [
            [lo, row[2 + c]!],
            [hi - 1, row[2 + c]!],
          ];
      for (const [amount, expected] of cases) {
        checked++;
        const got = eicTableCredit(amount, status, kids, p2025);
        if (got !== expected)
          bad.push(
            `${status} ${kids} kids at ${amount}: ${got} != ${expected}`
          );
      }
    });
  }
  assert.deepEqual(bad.slice(0, 10), []);
  assert.ok(checked > 20000);
});

test('EIC Table edges: $0 and the head of household column', () => {
  assert.equal(eicTableCredit(0, 'single', 1, p2025), 0);
  // Table example: single, one child, 2,455 -> 842.
  assert.equal(eicTableCredit(2455, 'single', 1, p2025), 842);
  assert.equal(eicTableCredit(2455, 'hoh', 1, p2025), 842);
  // Completed phaseout: 50,434 or more with one child -> 0 (footnote).
  assert.equal(eicTableCredit(50433, 'single', 1, p2025), 3);
  assert.equal(eicTableCredit(50434, 'single', 1, p2025), 0);
  // Beyond the table.
  assert.equal(eicTableCredit(90000, 'mfj', 3, p2025), 0);
});

test('2026 EIC uses Rev. Proc. 2025-32 amounts (provisional table)', () => {
  const p2026 = getParams(2026);
  // Plateau: max credit 8,231 (3+ children) at earned income 20,000.
  assert.equal(eicTableCredit(20000, 'single', 3, p2026), 8231);
  // Completed phaseout 19,540 (no child, single).
  assert.equal(eicTableCredit(19540, 'single', 0, p2026), 0);
  assert.ok(eicTableCredit(19500, 'single', 0, p2026) <= 3);
  assert.ok(p2026.provisional.some((x) => x.key === 'eicTable'));
});
