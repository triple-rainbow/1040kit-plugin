import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { initWorkspace, keyPath, openStore } from '../src/store/workspace.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { fakeDeps, freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeEach(async () => {
  env = await freshEnv();
});
afterEach(async () => {
  await env.cleanup();
});

async function init() {
  const res = await workspaceInit({ year: 2025 }, fakeDeps());
  assert.equal(res.ok, true, JSON.stringify(res));
  return res as Extract<typeof res, { ok: true }>;
}

test('init creates layout and key outside workspace', async () => {
  const res = await init();
  const ws = join(env.home, '2025');
  assert.equal(res.workspace, ws);
  assert.equal(res.inbox, join(ws, 'inbox'));
  assert.equal(res.created, true);
  assert.ok(existsSync(join(ws, 'inbox')));
  assert.ok(existsSync(join(ws, 'outputs')));
  assert.ok(existsSync(join(ws, '.1040kit', 'return.enc')));
  const meta = JSON.parse(
    await readFile(join(ws, '.1040kit', 'workspace.json'), 'utf8')
  );
  assert.equal(meta.taxYear, 2025);
  assert.equal(meta.version, 1);
  assert.ok(meta.id);
  const key = keyPath(meta.id);
  assert.ok(existsSync(key));
  assert.ok(key.startsWith(env.config));
  assert.ok(
    relative(ws, key).startsWith('..'),
    'key must be outside workspace'
  );
});

test('init is idempotent', async () => {
  const first = await init();
  const ws = first.workspace;
  const before = await readFile(join(ws, '.1040kit', 'workspace.json'), 'utf8');
  const enc = await readFile(join(ws, '.1040kit', 'return.enc'));
  const second = await init();
  assert.equal(second.created, false);
  assert.equal(
    await readFile(join(ws, '.1040kit', 'workspace.json'), 'utf8'),
    before
  );
  assert.deepEqual(await readFile(join(ws, '.1040kit', 'return.enc')), enc);
});

test('init refuses an existing non-empty non-1040kit dir', async () => {
  const dir = join(env.home, 'other');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'notes.txt'), 'hello');
  const res = await workspaceInit({ year: 2025, path: dir }, fakeDeps());
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.error.code, 'WORKSPACE_CONFLICT');
});

test('store round-trips', async () => {
  const { workspace } = await init();
  const store = await openStore(workspace);
  const empty = await store.read();
  assert.equal(empty.facts.taxYear, 2025);
  await store.write((d) => {
    d.facts.filingStatus = 'single';
    d.answers['x'] = 'y';
  });
  const again = await (await openStore(workspace)).read();
  assert.equal(again.facts.filingStatus, 'single');
  assert.equal(again.answers['x'], 'y');
});

test('refuses to overwrite unreadable store', async () => {
  const { workspace } = await init();
  const store = await openStore(workspace);
  const meta = JSON.parse(
    await readFile(join(workspace, '.1040kit', 'workspace.json'), 'utf8')
  );
  const encPath = join(workspace, '.1040kit', 'return.enc');
  const before = await readFile(encPath);
  await rm(keyPath(meta.id));
  await assert.rejects(store.read(), (e: any) => {
    assert.equal(e.code, 'STORE_UNREADABLE');
    assert.ok(e.message.includes(keyPath(meta.id)), e.message);
    return true;
  });
  await assert.rejects(
    store.write((d) => {
      d.facts.filingStatus = 'mfj';
    }),
    (e: any) => e.code === 'STORE_UNREADABLE'
  );
  assert.deepEqual(await readFile(encPath), before);
  // init must not "repair" it either
  const res = await workspaceInit({ year: 2025 }, fakeDeps());
  assert.deepEqual(await readFile(encPath), before);
  assert.equal(res.ok, false);
});

test('tampered ciphertext rejected', async () => {
  const { workspace } = await init();
  const encPath = join(workspace, '.1040kit', 'return.enc');
  const buf = await readFile(encPath);
  buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
  await writeFile(encPath, buf);
  await assert.rejects((await openStore(workspace)).read(), (e: any) => {
    return e.code === 'STORE_UNREADABLE';
  });
});

test('truncated store rejected', async () => {
  const { workspace } = await init();
  const encPath = join(workspace, '.1040kit', 'return.enc');
  const buf = await readFile(encPath);
  await writeFile(encPath, buf.subarray(0, 20));
  await assert.rejects((await openStore(workspace)).read(), (e: any) => {
    return e.code === 'STORE_UNREADABLE';
  });
});

test('key file mode 0600', async () => {
  const { workspace } = await init();
  const meta = JSON.parse(
    await readFile(join(workspace, '.1040kit', 'workspace.json'), 'utf8')
  );
  const st = await stat(keyPath(meta.id));
  assert.equal(st.mode & 0o777, 0o600);
  assert.equal(st.size, 32);
});

test('concurrent writes are serialized', async () => {
  const { workspace } = await init();
  const store = await openStore(workspace);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.write((d) => {
        d.answers[`k${i}`] = i;
      })
    )
  );
  const data = await store.read();
  assert.equal(Object.keys(data.answers).length, 10);
});

test('an older store loses its SSN and account tokens on read', async () => {
  const r = await initWorkspace(2025, undefined, new Date());
  const store = await openStore(r.workspace);
  await store.write((d) => {
    const legacy = d as unknown as {
      facts: Record<string, unknown> & {
        taxpayer: Record<string, unknown>;
        int1099s: Record<string, unknown>[];
      };
      vault: Record<string, string>;
      provenance: Record<string, unknown>;
    };
    legacy.facts.taxpayer.ssnToken = '{{SSN:taxpayer}}';
    legacy.facts.outOfScope = { rentalIncome: false, hsa: false };
    delete legacy.facts.e1098s;
    delete legacy.facts.rentals;
    legacy.facts.int1099s.push({
      id: 'int_1',
      owner: 'taxpayer',
      interest: 100,
      payerToken: '{{SSN:int_1}}',
    });
    legacy.vault['{{SSN:taxpayer}}'] = '123-45-6789';
    legacy.vault['{{SSN:int_1}}'] = '234-56-7890';
    legacy.vault['{{ACCT:int_1}}'] = '0000987654321';
    legacy.vault['{{EIN:w2_1}}'] = '12-3456789';
    legacy.provenance['taxpayer.ssnToken'] = { source: 'doc', at: 'x' };
  });
  const d = await store.read();
  assert.deepEqual(d.vault, { '{{EIN:w2_1}}': '12-3456789' });
  assert.equal('ssnToken' in d.facts.taxpayer, false);
  assert.equal(d.facts.int1099s[0]!.payerToken, undefined);
  assert.deepEqual(d.facts.outOfScope, { hsa: false });
  assert.deepEqual(d.facts.e1098s, []);
  assert.deepEqual(d.facts.rentals, []);
  assert.equal(d.provenance['taxpayer.ssnToken'], undefined);
  const text = JSON.stringify(d);
  for (const v of ['123-45-6789', '234-56-7890', '0000987654321'])
    assert.ok(!text.includes(v), v);
});
