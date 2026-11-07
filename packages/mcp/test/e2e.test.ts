/**
 * End to end, real engine, the way the do-my-taxes skill drives the tools:
 * W-2 + 1099-NEC PDFs → scan → extract → interview loop → calc (complete)
 * → deductions/review → forms_fill → filing_prepare (both paths).
 * Also asserts the SSN never appears anywhere (tool responses, the encrypted
 * store, text outputs, the PDF) and no EIN reaches a response or text output.
 */
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

import { defaultDeps } from '../src/deps.ts';
import { ACKNOWLEDGMENT_TEXT } from '../src/output/acknowledgment.ts';
import { openStore } from '../src/store/workspace.ts';
import { handler as calcReturn } from '../src/tools/calc-return.ts';
import { handler as deductionsFind } from '../src/tools/deductions-find.ts';
import { handler as docsExtract } from '../src/tools/docs-extract.ts';
import { handler as docsScan } from '../src/tools/docs-scan.ts';
import { handler as filingPrepare } from '../src/tools/filing-prepare.ts';
import { handler as formsFill } from '../src/tools/forms-fill.ts';
import { handler as interviewNext } from '../src/tools/interview-next.ts';
import { handler as profileSet } from '../src/tools/profile-set.ts';
import { handler as reviewChecks } from '../src/tools/review-checks.ts';
import { handler as workspaceInit } from '../src/tools/workspace-init.ts';
import { FAKE, necPdf, w2Pdf } from './fixtures/make-pdfs.ts';
import { freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv | undefined;
after(() => env?.cleanup());

const RAW = [FAKE.ssn, FAKE.ein, FAKE.ein2];
const RAW_DIGITS = RAW.map((v) => v.replace(/\D/g, ''));

function assertNoPii(label: string, value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const v of [...RAW, ...RAW_DIGITS]) {
    assert.ok(!text.includes(v), `${label} leaks ${v}`);
  }
}

/** What a user would answer, keyed by the fact path interview_next asks for. */
type Answer =
  | string
  | number
  | boolean
  | unknown[]
  | Record<string, unknown>
  | null
  | undefined;
function answerFor(path: string): Answer {
  if (path.startsWith('outOfScope.other')) return [];
  if (path.startsWith('outOfScope.')) return false;
  if (path.startsWith('screening.')) return false;
  const fixed: Record<string, Answer> = {
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
  if (path in fixed) return fixed[path];
  if (/^businesses\[taxpayer\]$/.test(path))
    return { owner: 'taxpayer', name: 'Pat Example Design', expenses: {} };
  if (/^businesses\[taxpayer\]\./.test(path)) return undefined;
  return undefined;
}

test('W-2 + 1099-NEC → complete return → forms and both filing packages', async () => {
  env = await freshEnv();
  const deps = {
    ...defaultDeps(),
    kbFetch: (async () => {
      throw new Error('no network in e2e');
    }) as typeof fetch,
  };
  const responses: unknown[] = [];
  const call = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    responses.push(r);
    return r;
  };

  const ws = await call(workspaceInit({ year: 2025 }, deps));
  assert.ok(ws.ok, JSON.stringify(ws));
  const workspace = ws.workspace;
  await writeFile(join(ws.inbox, 'w2.pdf'), await w2Pdf());
  await writeFile(join(ws.inbox, 'nec.pdf'), await necPdf());

  const scan = await call(docsScan({ workspace }, deps));
  assert.ok(scan.ok, JSON.stringify(scan));
  const kinds = scan.documents.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ['1099nec', 'w2']);

  const ex = await call(docsExtract({ workspace }, deps));
  assert.ok(ex.ok, JSON.stringify(ex));
  assert.equal(ex.extracted.length, 2, JSON.stringify(ex.skipped));

  // Names and address for the forms (the skill collects these in the interview).
  const identity = await call(
    profileSet(
      {
        workspace,
        set: [
          { path: 'identity.taxpayer.firstName', value: 'Pat', source: 'user' },
          {
            path: 'identity.taxpayer.lastName',
            value: 'Example',
            source: 'user',
          },
          {
            path: 'identity.taxpayer.occupation',
            value: 'Designer',
            source: 'user',
          },
          {
            path: 'identity.address.street',
            value: '1 Main St',
            source: 'user',
          },
          { path: 'identity.address.city', value: 'Austin', source: 'user' },
          { path: 'identity.address.state', value: 'TX', source: 'user' },
          { path: 'identity.address.zip', value: '78701', source: 'user' },
        ],
      },
      deps
    )
  );
  assert.ok(
    identity.ok && identity.rejected.length === 0,
    JSON.stringify(identity)
  );

  // Interview loop: answer what's asked; fail on anything we can't answer.
  for (let round = 0; round < 20; round++) {
    const next = await call(interviewNext({ workspace, limit: 10 }, deps));
    assert.ok(next.ok, JSON.stringify(next));
    if (next.done) break;
    const blocking = next.questions.filter((q) => q.blocking);
    const set = next.questions.flatMap((q) => {
      const value = answerFor(q.path);
      return value === undefined
        ? []
        : [{ path: q.path, value, source: 'user' as const }];
    });
    const unanswerable = blocking.filter(
      (q) => answerFor(q.path) === undefined
    );
    assert.deepEqual(
      unanswerable.map((q) => q.path),
      [],
      'interview asked something unexpected'
    );
    if (set.length === 0) break; // only non-blocking questions left
    const r = await call(profileSet({ workspace, set }, deps));
    assert.ok(r.ok && r.rejected.length === 0, JSON.stringify(r));
    assert.ok(round < 19, 'interview did not converge');
  }

  const calc = await call(calcReturn({ workspace }, deps));
  assert.ok(calc.ok, JSON.stringify(calc));
  assert.equal(
    calc.complete,
    true,
    JSON.stringify({ u: calc.unsupported, m: calc.missing })
  );
  assert.ok(
    calc.forms.includes('schC.taxpayer') &&
      calc.forms.includes('schSE.taxpayer')
  );
  const line = (id: string) => calc.lines.find((l) => l.id === id)?.value;
  assert.equal(line('wages'), 52346);
  assert.ok(
    (line('seTax.taxpayer') ?? 0) > 0,
    'SE tax computed on the 1099-NEC'
  );
  assert.equal(calc.drivers.length, 3);

  const ded = await call(deductionsFind({ workspace }, deps));
  assert.ok(ded.ok && Array.isArray(ded.opportunities), JSON.stringify(ded));
  assert.ok(
    ded.opportunities.some((o) => o.id === 'qbi'),
    'QBI considered for a freelancer'
  );
  const rev = await call(reviewChecks({ workspace }, deps));
  assert.ok(rev.ok && Array.isArray(rev.findings), JSON.stringify(rev));

  // The sign-off acknowledgment comes first.
  const noAck = await call(formsFill({ workspace }, deps));
  assert.equal(!noAck.ok && noAck.error.code, 'ACK_REQUIRED');
  assert.ok(!noAck.ok && noAck.error.message.includes(ACKNOWLEDGMENT_TEXT));
  const filled = await call(formsFill({ workspace, acknowledged: true }, deps));
  assert.ok(filled.ok, JSON.stringify(filled));
  assert.ok(
    filled.handwrite.includes(
      'Form 1040, page 1, "Your social security number" box (top right): write your SSN.'
    ),
    JSON.stringify(filled.handwrite)
  );
  assert.deepEqual(
    filled.unmappedLines,
    [],
    'every computed line has a PDF field'
  );
  const pdfPath = filled.files.find((f) => f.endsWith('.pdf'));
  assert.ok(pdfPath);
  const bytes = new Uint8Array(await readFile(pdfPath));
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 4, '1040 + Sch 1, 2, C, SE pages');
  // The output is flattened: read its text. 1040kit never stores the SSN, so
  // it can't be in the PDF.
  const { text: pdfText } = await extractText(await getDocumentProxy(bytes), {
    mergePages: true,
  });
  assert.ok(
    !pdfText.includes(FAKE.ssn) && !pdfText.includes(RAW_DIGITS[0]!),
    'no SSN in the PDF'
  );
  assert.doesNotMatch(pdfText, /\b\d{3}-\d{2}-\d{4}\b/);
  assert.ok(pdfText.includes('52,346'), 'wages printed on the 1040');

  for (const path of ['mail', 'fillable_forms'] as const) {
    const fp = await call(filingPrepare({ workspace, path }, deps));
    assert.ok(fp.ok, JSON.stringify(fp));
  }

  // No raw identifiers in any tool response or any text output file.
  responses.forEach((r, i) => assertNoPii(`response #${i}`, r));
  const outDir = join(workspace, 'outputs');
  const textFiles = (await readdir(outDir)).filter((f) => !f.endsWith('.pdf'));
  assert.ok(
    textFiles.length >= 3,
    `expected summary + 2 filing files, got ${textFiles}`
  );
  for (const f of textFiles)
    assertNoPii(f, await readFile(join(outDir, f), 'utf8'));
  // …nor in the decrypted store: the SSN was discarded at extraction.
  const stored = JSON.stringify(await (await openStore(workspace)).read());
  assert.ok(!stored.includes(FAKE.ssn) && !stored.includes(RAW_DIGITS[0]!));
  assert.doesNotMatch(stored, /\{\{(SSN|ACCT):/);
  const summary = textFiles.find((f) => f.includes('summary'))!;
  assert.ok(
    (await readFile(join(outDir, summary), 'utf8')).includes(
      ACKNOWLEDGMENT_TEXT
    )
  );
  const sheet = textFiles.find((f) => f.includes('fillable'));
  assert.ok(sheet);
  assert.match(await readFile(join(outDir, sheet), 'utf8'), /52,?346/);
});
