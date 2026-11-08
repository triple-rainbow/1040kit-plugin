/**
 * Real engine, end to end. Skipped while the engine's computeReturn still
 * throws "not implemented" (engine track E1); must pass once it lands.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { emptyFacts, engine } from '@1040kit/engine';

import { defaultDeps } from '../src/deps.ts';
import { handler as calcReturn } from '../src/tools/calc-return.ts';
import { handler as docsExtract } from '../src/tools/docs-extract.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { w2Pdf } from './fixtures/make-pdfs.ts';
import { freshEnv, type TestEnv } from './helpers.ts';

function engineReady(): boolean {
  try {
    engine.computeReturn(emptyFacts(2025));
    return true;
  } catch (e) {
    return !/not implemented/.test((e as Error).message);
  }
}

let env: TestEnv | undefined;
after(() => env?.cleanup());

test(
  'synthetic W-2 → calc_return',
  {
    skip: engineReady()
      ? false
      : 'engine computeReturn not implemented yet (E1)',
  },
  async () => {
    env = await freshEnv();
    const deps = {
      ...defaultDeps(),
      kbFetch: (async () => {
        throw new Error('no network');
      }) as typeof fetch,
    };
    const ws = await workspaceInit({ year: 2025, acknowledged: true }, deps);
    assert.ok(ws.ok);
    await writeFile(join(ws.inbox, 'w2.pdf'), await w2Pdf());
    assert.ok((await docsScan({ workspace: ws.workspace }, deps)).ok);
    assert.ok((await docsExtract({ workspace: ws.workspace }, deps)).ok);
    const set = await profileSet(
      {
        workspace: ws.workspace,
        set: [
          { path: 'filingStatus', value: 'single', source: 'user' },
          { path: 'taxpayer.dateOfBirth', value: '1990-04-01', source: 'user' },
          { path: 'taxpayer.hasValidSsn', value: true, source: 'user' },
          {
            path: 'taxpayer.canBeClaimedAsDependent',
            value: false,
            source: 'user',
          },
        ],
      },
      deps
    );
    assert.ok(set.ok && set.rejected.length === 0, JSON.stringify(set));
    const r = await calcReturn({ workspace: ws.workspace }, deps);
    assert.ok(r.ok, JSON.stringify(r));
    const wages = r.lines.find((l) => l.id === 'wages');
    assert.equal(wages?.value, 52346);
    assert.equal(wages?.line, '1a');
  }
);
