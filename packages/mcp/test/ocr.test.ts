import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { handler as docsExtract } from '../src/tools/docs-extract.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { w2Pdf } from './fixtures/make-pdfs.ts';
import { renderPng, scanPdf } from './fixtures/render.ts';
import { fakeDeps, freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let ws: string;
let inbox: string;
let png: Uint8Array;
const realFetch = globalThis.fetch;

before(async () => {
  png = await renderPng(await w2Pdf());
});

beforeEach(async () => {
  env = await freshEnv();
  const r = await workspaceInit({ year: 2025 }, fakeDeps());
  assert.ok(r.ok);
  ws = r.workspace;
  inbox = r.inbox;
  // Any network call during OCR fails the test.
  globalThis.fetch = (async (u: unknown) => {
    throw new Error(`network call attempted: ${String(u)}`);
  }) as typeof fetch;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await env.cleanup();
});

async function extractOne() {
  const docs = await docsScan({ workspace: ws }, fakeDeps());
  assert.ok(docs.ok);
  assert.equal(docs.documents[0]!.status, 'needs_ocr');
  const r = await docsExtract({ workspace: ws }, fakeDeps());
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

test(
  'ocr extracts W-2 box 1 from a rendered image',
  { timeout: 120_000 },
  async () => {
    await writeFile(join(inbox, 'w2-photo.png'), png);
    const r = await extractOne();
    assert.equal(r.extracted.length, 1, JSON.stringify(r));
    const e = r.extracted[0]!;
    assert.equal(e.kind, 'w2');
    assert.equal(e.fields.wages, 5234567);
    assert.equal(e.fields.employeeSsn, undefined, 'SSNs are discarded');
    // OCR fields are always low confidence
    assert.ok(
      e.lowConfidence.some((l) => l.field === 'wages' && /OCR/.test(l.reason))
    );
    assert.ok(!JSON.stringify(r).includes('6789'));
  }
);

test(
  'ocr reads an image-only (scanned) PDF',
  { timeout: 120_000 },
  async () => {
    await writeFile(join(inbox, 'w2-scan.pdf'), await scanPdf(png));
    const r = await extractOne();
    assert.equal(r.extracted[0]?.kind, 'w2', JSON.stringify(r));
    assert.equal(r.extracted[0]!.fields.wages, 5234567);
  }
);

let sandbox: string;
after(async () => {
  if (sandbox) await rm(sandbox, { recursive: true, force: true });
});

// Needs native TypeScript stripping and the permission model's network gate.
const nodeMajor = Number(process.versions.node.split('.')[0]);

test(
  'ocr makes no network calls',
  {
    timeout: 120_000,
    skip: nodeMajor < 25 ? 'needs Node >= 25 (--allow-net gate)' : false,
  },
  async () => {
    // Run OCR in a child process under Node's permission model with network
    // access denied, so a fetch from any thread (tesseract's worker included)
    // would fail.
    sandbox = await mkdtemp(join(tmpdir(), '1040kit-ocr-'));
    const img = join(sandbox, 'w2.png');
    await writeFile(img, png);
    const script = join(sandbox, 'run.mjs');
    const ocrModule = fileURLToPath(
      new URL('../src/docs/ocr.ts', import.meta.url)
    );
    await writeFile(
      script,
      `import { readFileSync } from 'node:fs';
const { ocrImage } = await import(${JSON.stringify(ocrModule)});
globalThis.fetch = () => { throw new Error('fetch called'); };
const text = await ocrImage(readFileSync(${JSON.stringify(img)}));
process.stdout.write(JSON.stringify({ ok: /Wage and Tax Statement/i.test(text) }));
`
    );
    const res = spawnSync(
      process.execPath,
      // Node >= 22.18 strips TypeScript types natively; no tsx (it spawns esbuild).
      ['--permission', '--allow-fs-read=*', '--allow-worker', script],
      { encoding: 'utf8', timeout: 110_000 }
    );
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout), { ok: true });

    // Control: the same flags really do deny network access.
    const probe = join(sandbox, 'probe.mjs');
    await writeFile(
      probe,
      `await fetch('https://example.invalid/').then(() => process.stdout.write('reached'), (e) => process.stdout.write(String(e.cause?.code ?? e.code)));`
    );
    const ctl = spawnSync(
      process.execPath,
      ['--permission', '--allow-fs-read=*', '--allow-worker', probe],
      {
        encoding: 'utf8',
        timeout: 30_000,
      }
    );
    assert.equal(ctl.stdout, 'ERR_ACCESS_DENIED');
  }
);
