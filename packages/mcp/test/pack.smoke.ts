/**
 * Packed-install smoke test: what `npx -y 1040kit` gets. Builds and packs the
 * package, installs the tarball into an empty temp folder (no workspace, no
 * tsx, dependencies from the npm registry), starts the installed bin over
 * stdio with the MCP SDK client, then drives it: initialize, tools/list, the
 * interview widget resource, OCR of a generated W-2 image, and forms_fill
 * (which loads the bundled IRS PDFs and field maps).
 *
 * Synthetic data only ("Pat Example", see fixtures/make-pdfs.ts).
 * Slow and needs the network for `npm install`, so it is not part of
 * `pnpm test`:
 *
 *   pnpm --filter 1040kit test:pack
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PDFDocument } from 'pdf-lib';

import { ACKNOWLEDGMENT_TEXT } from '../src/output/acknowledgment.ts';
import { SERVER_NAME, SERVER_VERSION } from '../src/server.ts';
import { TOOL_NAMES } from '../src/tool-names.ts';
import { INTERVIEW_WIDGET_URI } from '../src/ui/interview-widget.ts';
import { FAKE, w2Pdf } from './fixtures/make-pdfs.ts';
import { renderPng } from './fixtures/render.ts';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));

let work: string;
let client: Client;
let stderr = '';

// pnpm's own npm_config_* settings would make npm warn; run each tool clean.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k))
);
const sh = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, {
    cwd,
    env: cleanEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

before(async () => {
  work = await mkdtemp(join(tmpdir(), '1040kit-pack-'));
  const packDir = join(work, 'pack');
  const appDir = join(work, 'app');
  const home = join(work, 'home');
  const config = join(work, 'config');

  // The same artifact the release workflow publishes (pnpm pack rewrites
  // workspace: ranges; the engine is bundled, so none remain in dependencies).
  sh('pnpm', ['build'], pkgDir);
  sh('pnpm', ['pack', '--pack-destination', packDir], pkgDir);
  const tgz = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  assert.ok(tgz, 'pnpm pack produced a tarball');

  // An empty project outside the workspace, like npx's cache folder.
  sh('mkdir', ['-p', appDir, home, config], work);
  await writeFile(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'pack-smoke', private: true })
  );
  sh(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--omit=dev',
      '--no-package-lock',
      join(packDir, tgz),
    ],
    appDir
  );
  const installed = join(appDir, 'node_modules', '1040kit');
  const manifest = JSON.parse(
    await readFile(join(installed, 'package.json'), 'utf8')
  );
  assert.equal(manifest.private, undefined);
  for (const deps of [manifest.dependencies, manifest.peerDependencies])
    for (const [name, range] of Object.entries(deps ?? {}))
      assert.ok(!String(range).startsWith('workspace:'), `${name}: ${range}`);
  assert.ok(!existsSync(join(installed, 'src')), 'source is not shipped');
  assert.ok(!existsSync(join(installed, 'node_modules', '@1040kit')));

  // The bin itself (shebang + exec bit), with nothing from the workspace.
  const transport = new StdioClientTransport({
    command: join(appDir, 'node_modules', '.bin', '1040kit'),
    args: [],
    cwd: appDir,
    env: {
      PATH: process.env.PATH ?? '',
      KIT1040_HOME: home,
      KIT1040_CONFIG_DIR: config,
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  client = new Client({ name: 'pack-smoke', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  if (work) await rm(work, { recursive: true, force: true });
});

const call = async <T>(name: string, args: Record<string, unknown>) => {
  let res;
  try {
    res = await client.callTool({ name, arguments: args });
  } catch (e) {
    // The server died: its stderr says why.
    throw new Error(`${name} failed: ${String(e)}\n--- server stderr ---\n${stderr}`);
  }
  return res.structuredContent as T & {
    ok: boolean;
    error?: { code: string; message: string };
  };
};

test('initialize: server name and version match the package', () => {
  const info = client.getServerVersion();
  assert.equal(info?.name, SERVER_NAME);
  assert.equal(info?.version, SERVER_VERSION);
  assert.equal(SERVER_VERSION, pkg.version, 'SERVER_VERSION = package.json');
});

test('tools/list: exactly TOOL_NAMES', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
});

test('resources/read: interview widget with the ext-apps runtime inlined', async () => {
  const r = await client.readResource({ uri: INTERVIEW_WIDGET_URI });
  const c = r.contents[0] as { text?: string; mimeType?: string };
  assert.ok(c?.text, 'widget html');
  assert.match(c.text, /globalThis\.McpApps=\{/);
});

test(
  'OCR a W-2 image, then forms_fill loads the bundled IRS PDFs',
  { timeout: 300_000 },
  async () => {
    const first = await call<{
      acknowledgment: { agreed: boolean; text: string };
    }>('workspace_init', { year: 2025 });
    assert.equal(first.ok && first.acknowledgment.text, ACKNOWLEDGMENT_TEXT);
    const ws = await call<{ workspace: string; inbox: string }>(
      'workspace_init',
      { year: 2025, acknowledged: true }
    );
    assert.ok(ws.ok, JSON.stringify(ws));
    const { workspace } = ws;
    await writeFile(
      join(ws.inbox, 'w2-photo.png'),
      await renderPng(await w2Pdf())
    );

    const scan = await call<{ documents: { status: string }[] }>('docs_scan', {
      workspace,
    });
    assert.ok(scan.ok, JSON.stringify(scan));
    assert.equal(scan.documents[0]?.status, 'needs_ocr');
    const ex = await call<{
      extracted: { kind: string; fields: Record<string, unknown> }[];
    }>('docs_extract', { workspace });
    assert.ok(ex.ok, `${JSON.stringify(ex)}\n${stderr}`);
    assert.equal(ex.extracted[0]?.kind, 'w2', JSON.stringify(ex));
    assert.equal(ex.extracted[0]!.fields.wages, 5234567);
    assert.ok(!JSON.stringify(ex).includes(FAKE.ssn));

    const identity: [string, string][] = [
      ['identity.taxpayer.firstName', 'Pat'],
      ['identity.taxpayer.lastName', 'Example'],
      ['identity.taxpayer.occupation', 'Designer'],
      ['identity.address.street', '1 Main St'],
      ['identity.address.city', 'Austin'],
      ['identity.address.state', 'TX'],
      ['identity.address.zip', '78701'],
    ];
    const id = await call<{ rejected: unknown[] }>('profile_set', {
      workspace,
      set: identity.map(([path, value]) => ({ path, value, source: 'user' })),
    });
    assert.ok(id.ok && id.rejected.length === 0, JSON.stringify(id));

    for (let round = 0; round < 20; round++) {
      const next = await call<{
        done: boolean;
        questions: { path: string; blocking: boolean; answer?: any }[];
      }>('interview_next', { workspace, limit: 10 });
      assert.ok(next.ok, JSON.stringify(next));
      if (next.done) break;
      const set = next.questions.flatMap((q) => {
        if (q.answer?.kind === 'multiselect')
          return [
            ...q.answer.options.map((o: { path: string }) => ({
              path: o.path,
              value: answerFor(o.path),
              source: 'user',
            })),
            ...(q.answer.other
              ? [{ path: q.answer.other.path, value: [], source: 'user' }]
              : []),
          ];
        const value = answerFor(q.path);
        return value === undefined
          ? []
          : [{ path: q.path, value, source: 'user' }];
      });
      const stuck = next.questions.filter(
        (q) =>
          q.blocking &&
          q.answer?.kind !== 'multiselect' &&
          answerFor(q.path) === undefined
      );
      assert.deepEqual(
        stuck.map((q) => q.path),
        [],
        'unexpected question'
      );
      if (set.length === 0) break;
      const r = await call<{ rejected: unknown[] }>('profile_set', {
        workspace,
        set,
      });
      assert.ok(r.ok && r.rejected.length === 0, JSON.stringify(r));
    }

    const calc = await call<{ complete: boolean }>('calc_return', {
      workspace,
    });
    assert.ok(calc.ok && calc.complete, JSON.stringify(calc));

    const noReview = await call('forms_fill', { workspace });
    assert.equal(noReview.error?.code, 'REVIEW_REQUIRED');
    const review = await call<{ ready: boolean }>('return_review', {
      workspace,
    });
    assert.ok(review.ok && review.ready, JSON.stringify(review));
    const confirmed = await call<{ confirmed: boolean }>('return_review', {
      workspace,
      confirmed: true,
    });
    assert.ok(confirmed.ok && confirmed.confirmed, JSON.stringify(confirmed));
    const filled = await call<{ files: string[]; unmappedLines: string[] }>(
      'forms_fill',
      { workspace }
    );
    assert.ok(filled.ok, `${JSON.stringify(filled)}\n${stderr}`);
    assert.deepEqual(filled.unmappedLines, []);
    const pdfPath = filled.files.find((f) => f.endsWith('.pdf'));
    assert.ok(pdfPath);
    const pdf = await PDFDocument.load(await readFile(pdfPath));
    assert.ok(pdf.getPageCount() >= 2, 'Form 1040 pages filled');
  }
);

/** What a W-2-only filer answers, keyed by the fact path asked for. */
function answerFor(path: string): unknown {
  if (path.startsWith('outOfScope.other')) return [];
  if (path.startsWith('outOfScope.') || path.startsWith('screening.'))
    return false;
  const fixed: Record<string, unknown> = {
    'taxpayer.livedInUsOverHalfYear': true,
    'taxpayer.qualifyingChildOfAnother': false,
    'eitc.priorDisallowance': false,
    filingStatus: 'single',
    digitalAssetActivity: false,
    'taxpayer.dateOfBirth': '1990-04-01',
    'taxpayer.hasValidSsn': true,
    'taxpayer.canBeClaimedAsDependent': false,
    'taxpayer.blind': false,
    stateOfResidence: 'TX',
  };
  return fixed[path];
}
