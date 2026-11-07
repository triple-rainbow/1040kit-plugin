/**
 * Real engine × real field maps: every 2025 engine golden return must print
 * every computed line somewhere on the PDF (no `unmapped`). Catches label
 * drift between the engine's form/line labels and assets/maps/2025.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { engine, type TaxFacts } from '@1040kit/engine';

import { fillReturn } from '../src/output/fill.ts';
import { emptyStoreData } from '../src/store/workspace.ts';

const dir = new URL('../../engine/test/golden/', import.meta.url);
const cases = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    file: f,
    ...(JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as {
      name: string;
      facts: TaxFacts;
    }),
  }))
  .filter((c) => c.facts.taxYear === 2025);

for (const c of cases) {
  test(`forms for golden ${c.file}: every line has a PDF field`, async () => {
    const result = engine.computeReturn(c.facts);
    const data = { ...emptyStoreData(2025), facts: c.facts };
    const out = await fillReturn(data, result);
    assert.deepEqual(out.unmapped, [], c.name);
  });
}
