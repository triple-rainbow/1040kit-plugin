/**
 * Golden cases: test/golden/*.json (committed, synthetic people) and
 * test/private/*.json (owner's real returns; gitignored, loaded when present).
 *
 * Shape: { name, facts: TaxFacts, expect: Record<nodeId | "summary.<field>" | "complete", number|boolean>, source }
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import type { TaxFacts } from '../src/types.ts';

interface GoldenCase {
  name: string;
  facts: TaxFacts;
  expect: Record<string, number | boolean>;
  forms?: string[];
  source: string;
}

function load(dir: URL): { file: string; c: GoldenCase }[] {
  const path = dir.pathname;
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      c: JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as GoldenCase,
    }));
}

const cases = [
  ...load(new URL('./golden/', import.meta.url)),
  ...load(new URL('./private/', import.meta.url)),
];

for (const { file, c } of cases) {
  test(`golden ${file}: ${c.name}`, () => {
    assert.ok(
      c.source && c.source.length > 0,
      'every golden case cites its source'
    );
    const r = computeReturn(c.facts);
    for (const [key, expected] of Object.entries(c.expect)) {
      let got: unknown;
      if (key === 'complete') got = r.complete;
      else if (key.startsWith('summary.'))
        got = r.summary[key.slice('summary.'.length) as keyof typeof r.summary];
      else {
        const node = r.nodes[key];
        assert.ok(node, `${key}: no such node`);
        got = node.value;
      }
      assert.equal(got, expected, `${key}`);
    }
    if (c.forms)
      assert.deepEqual([...r.forms].sort(), [...c.forms].sort(), 'forms');
  });
}

test('golden suite is not empty', () => {
  assert.ok(cases.length >= 3);
});
