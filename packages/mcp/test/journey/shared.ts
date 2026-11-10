/**
 * Shared by the end-to-end journeys (see docs/e2e-testing.md): the golden
 * returns, the server under test, the synthetic documents, what a user
 * answers, and `verifyReturn`, the checks on a finished workspace.
 *
 * Synthetic people only: Pat and Sam Example, fake SSNs and EINs
 * (fixtures/make-pdfs.ts).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';

import { SERVER_VERSION } from '../../src/version.ts';
import { FAKE } from '../fixtures/make-pdfs.ts';

export type Any = any;

export const pkgDir = fileURLToPath(new URL('../..', import.meta.url));
export const repoDir = fileURLToPath(new URL('../../../..', import.meta.url));
export const goldenDir = join(repoDir, 'packages/engine/test/golden');

// ------------------------------------------------------------------ options

export const cliArgs = process.argv.slice(2).filter((a) => a !== '--');
export const opt = (name: string) =>
  cliArgs.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
export const flag = (name: string) => cliArgs.includes(`--${name}`);
export const filters = cliArgs.filter((a) => !a.startsWith('--'));

export interface Golden {
  file: string;
  name: string;
  facts: Any;
  expect?: Record<string, unknown>;
  forms?: string[];
}

/** Golden returns whose file name contains one of `filters` (all when none). */
export function goldens(only: string[] = filters): Golden[] {
  return readdirSync(goldenDir)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => only.length === 0 || only.some((x) => f.includes(x)))
    .map((file) => ({
      file,
      ...JSON.parse(readFileSync(join(goldenDir, file), 'utf8')),
    }));
}

// ------------------------------------------------------------------- server

/**
 * The server under test: `src` (this checkout), `dist` (the built bundle) or
 * `npm[@version]` (a published release, through npx), and the version it
 * must report.
 */
export function serverCommand(server: string): {
  command: string;
  args: string[];
  version: string;
} {
  if (server === 'src')
    return {
      command: process.execPath,
      args: [
        '--import',
        import.meta.resolve('tsx'),
        join(pkgDir, 'src/bin.ts'),
      ],
      version: SERVER_VERSION,
    };
  if (server === 'dist') {
    const bin = join(pkgDir, 'dist/bin.js');
    if (!existsSync(bin))
      throw new Error('No dist/bin.js: run `pnpm --filter 1040kit build`.');
    return { command: process.execPath, args: [bin], version: SERVER_VERSION };
  }
  const m = /^npm(?:@(.+))?$/.exec(server);
  if (!m) throw new Error('--server must be src, dist or npm[@version]');
  const version = m[1] ?? 'latest';
  return { command: 'npx', args: ['-y', `1040kit@${version}`], version };
}

/** Where the server keeps workspaces and settings, inside one case's folder. */
export const serverEnv = (dir: string) => ({
  KIT1040_HOME: join(dir, 'home'),
  KIT1040_CONFIG_DIR: join(dir, 'config'),
});

export type Call = (name: string, args: Any) => Promise<Any>;

/** Start the server for one case's folder and return a tool caller. */
export async function connect(
  server: string,
  dir: string
): Promise<{
  call: Call;
  close: () => Promise<void>;
  versionProblem?: string;
}> {
  const cmd = serverCommand(server);
  const transport = new StdioClientTransport({
    command: cmd.command,
    args: cmd.args,
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      ...serverEnv(dir),
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (d: Buffer) => (stderr += d));
  const client = new Client({ name: '1040kit-journey', version: '0' });
  try {
    await client.connect(transport);
  } catch (e) {
    throw new Error(`the server did not start: ${e}\n${stderr.slice(-1500)}`);
  }
  const reported = client.getServerVersion()?.version;
  const call: Call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 300_000,
    });
    const s = r.structuredContent as Any;
    if (!s)
      throw new Error(
        `${name}: ${JSON.stringify(r.content).slice(0, 300)}\n${stderr}`
      );
    return s;
  };
  return {
    call,
    close: () => client.close(),
    versionProblem:
      cmd.version !== 'latest' && reported !== cmd.version
        ? `server reports version ${reported}, expected ${cmd.version}`
        : undefined,
  };
}

// ---------------------------------------------------------------- documents

const money = (cents: number) =>
  (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const dollars = (v: number) =>
  v < 0 ? `-${Math.abs(v).toLocaleString('en-US')}` : v.toLocaleString('en-US');

async function textPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  let y = 760;
  for (const l of lines) {
    page.drawText(l, { x: 40, y, size: 10, font });
    y -= 16;
  }
  return doc.save();
}

export const NAMES: Record<string, [string, string]> = {
  taxpayer: ['Pat', 'Example'],
  spouse: ['Sam', 'Example'],
};
const fullName = (owner: string) => NAMES[owner]!.join(' ');
const ssnOf = (owner: string) =>
  owner === 'spouse' ? FAKE.spouseSsn : FAKE.ssn;

/**
 * One PDF per golden document. The taxpayer's sort first: the first name
 * docs_extract sees becomes the taxpayer's.
 */
export function documentsFor(f: Any): [string, Promise<Uint8Array>][] {
  const out: [string, Promise<Uint8Array>][] = [];
  const yr = f.taxYear;
  const add = (
    list: Any[],
    kind: string,
    lines: (x: Any, i: number) => string[]
  ) =>
    [...list]
      .sort(
        (a, b) => Number(a.owner === 'spouse') - Number(b.owner === 'spouse')
      )
      .forEach((x, i) =>
        out.push([
          `${x.owner === 'spouse' ? 'b' : 'a'}-${x.owner}-${kind}-${i}.pdf`,
          textPdf(lines(x, i)),
        ])
      );
  add(f.w2s, 'w2', (w, i) => [
    `Form W-2 Wage and Tax Statement ${yr}`,
    `a Employee's social security number ${ssnOf(w.owner)}`,
    `b Employer identification number (EIN) 12-345678${i}`,
    `c Employer's name, address, and ZIP code Example Widgets ${i} LLC`,
    `e Employee's first name and initial Last name ${fullName(w.owner)}`,
    `1 Wages, tips, other compensation ${money(w.wages)}`,
    `2 Federal income tax withheld ${money(w.federalWithheld ?? 0)}`,
    `3 Social security wages ${money(w.ssWages ?? w.wages)}`,
    `4 Social security tax withheld ${money(w.ssTax ?? 0)}`,
    `5 Medicare wages and tips ${money(w.medicareWages ?? w.wages)}`,
    `6 Medicare tax withheld ${money(w.medicareTax ?? 0)}`,
    ...(w.ssTips ? [`7 Social security tips ${money(w.ssTips)}`] : []),
    "Copy B To Be Filed With Employee's FEDERAL Tax Return",
  ]);
  add(f.nec1099s, 'nec', (n, i) => [
    `Form 1099-NEC Nonemployee Compensation ${yr}`,
    `PAYER'S name Acme Clients ${i} Inc`,
    `PAYER'S TIN 98-765432${i}`,
    `RECIPIENT'S TIN ${ssnOf(n.owner)}`,
    `RECIPIENT'S name ${fullName(n.owner)}`,
    `1 Nonemployee compensation $ ${money(n.nonemployeeComp)}`,
    `4 Federal income tax withheld $ ${money(n.federalWithheld ?? 0)}`,
    'Copy B For Recipient',
  ]);
  add(f.int1099s, 'int', (n, i) => [
    `Form 1099-INT Interest Income ${yr}`,
    `PAYER'S name Example Savings Bank ${i}`,
    `PAYER'S TIN 98-765431${i}`,
    `RECIPIENT'S TIN ${ssnOf(n.owner)}`,
    `RECIPIENT'S name ${fullName(n.owner)}`,
    `1 Interest income $ ${money(n.interest)}`,
    `4 Federal income tax withheld $ ${money(n.federalWithheld ?? 0)}`,
  ]);
  add(f.div1099s, 'div', (n, i) => [
    `Form 1099-DIV Dividends and Distributions ${yr}`,
    `PAYER'S name Example Brokerage ${i}`,
    `PAYER'S TIN 98-765430${i}`,
    `RECIPIENT'S TIN ${ssnOf(n.owner)}`,
    `RECIPIENT'S name ${fullName(n.owner)}`,
    `1a Total ordinary dividends $ ${money(n.ordinaryDividends)}`,
    `1b Qualified dividends $ ${money(n.qualifiedDividends ?? 0)}`,
    `2a Total capital gain distr. $ ${money(n.capitalGainDistributions ?? 0)}`,
    `4 Federal income tax withheld $ 0.00`,
  ]);
  add(f.e1098s, '1098e', (n, i) => [
    `Form 1098-E Student Loan Interest Statement ${yr}`,
    'Example Student Loans',
    `RECIPIENT'S TIN 98-765429${i}`,
    `BORROWER'S TIN ${ssnOf(n.owner)}`,
    `BORROWER'S name ${fullName(n.owner)}`,
    `1 Student loan interest received by lender $ ${money(n.interest)}`,
    'Copy B For Borrower',
  ]);
  add(f.misc1099s, 'misc', (n, i) => [
    `Form 1099-MISC Miscellaneous Information ${yr}`,
    `PAYER'S name Example Property Management`,
    `PAYER'S TIN 98-765428${i}`,
    `RECIPIENT'S TIN ${ssnOf(n.owner)}`,
    `RECIPIENT'S name ${fullName(n.owner)}`,
    `1 Rents $ ${money(n.rents ?? 0)}`,
    ...(n.royalties ? [`2 Royalties $ ${money(n.royalties)}`] : []),
    '4 Federal income tax withheld $ 0.00',
    'Copy B For Recipient',
  ]);
  add(f.k1099s, 'k', (n, i) => [
    `Form 1099-K Payment Card and Third Party Network Transactions ${yr}`,
    `FILER'S name Example Payments`,
    `FILER'S TIN 98-765427${i}`,
    `PAYEE'S TIN ${ssnOf(n.owner)}`,
    `PAYEE'S name ${fullName(n.owner)}`,
    `1a Gross amount of payment card/third party network transactions $ ${money(n.grossAmount)}`,
    '4 Federal income tax withheld $ 0.00',
  ]);
  return out;
}

/** Save the golden's documents into an inbox folder; returns how many. */
export async function saveDocuments(facts: Any, inbox: string) {
  const docs = documentsFor(facts);
  for (const [name, bytes] of docs)
    await writeFile(join(inbox, name), await bytes);
  return docs.length;
}

// ----------------------------------------------------------------- answers

/** A fact path against the golden facts: `[x]` matches a list item's id, or a business's owner. */
export function lookup(facts: Any, path: string): unknown {
  let cur: Any = facts;
  for (const seg of path.match(/[^.[\]]+|\[[^\]]+\]/g) ?? []) {
    if (cur == null) return undefined;
    if (seg.startsWith('[')) {
      const key = seg.slice(1, -1);
      cur = Array.isArray(cur)
        ? cur.find(
            (x: Any) => x.id === key || (x.id === undefined && x.owner === key)
          )
        : cur[key];
    } else cur = cur[seg];
  }
  return cur;
}

export const ADDRESS = {
  street: '1 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
};

/** What the forms print and the golden doesn't hold: names, occupation, addresses. */
export function identityAnswer(path: string): unknown {
  let m = /^identity\.(taxpayer|spouse)\.(firstName|lastName|occupation)$/.exec(
    path
  );
  if (m)
    return m[2] === 'occupation'
      ? 'Designer'
      : NAMES[m[1]!]![m[2] === 'firstName' ? 0 : 1];
  m = /^identity\.dependents\[dependent_(\d+)\]\.(firstName|lastName)$/.exec(
    path
  );
  if (m) return m[2] === 'firstName' ? `Kid${m[1]}` : 'Example';
  m = /^identity\.address\.(street|city|state|zip)$/.exec(path);
  if (m) return ADDRESS[m[1] as keyof typeof ADDRESS];
  if (path === 'stateOfResidence') return ADDRESS.state;
  if (/^identity\.businesses\[\w+\]\.address\.street$/.test(path))
    return '200 Market St';
  if (/^identity\.businesses\[\w+\]\.address\.cityStateZip$/.test(path))
    return 'Austin, TX 78701';
  m = /^identity\.rentals\[\w+\]\.address\.(street|city|state|zip)$/.exec(path);
  if (m)
    return { street: '9 Elm St', city: 'Austin', state: 'TX', zip: '78702' }[
      m[1]!
    ];
  return undefined;
}

/**
 * Answers to questions the golden facts don't record, by the last segment of
 * the path. Each use is reported as `defaulted`, so a golden that should hold
 * the answer shows up.
 */
export const DEFAULTS: Record<string, unknown> = {
  materiallyParticipated: true,
  startedOrAcquiredThisYear: false,
  madePaymentsRequiring1099: false,
  accountingMethod: 'cash',
  operatedFromHome: false,
  allInvestmentAtRisk: true,
  name: 'Example Design',
  principalBusinessCode: '541430',
  fullTimeStudent: false,
  blind: false,
  livedInUsOverHalfYear: true,
  qualifyingChildOfAnother: false,
  priorDisallowance: false,
  canBeClaimedAsDependent: false,
  providedOverHalfOwnSupport: false,
  permanentlyDisabled: false,
  legallyObligated: true,
  qualifiedLoan: true,
  homeSquareFeet: 1200,
  placedInService: '2023-03-01',
  commutingMiles: 0,
  otherMiles: 5000,
  availableOffDuty: true,
  anotherVehicle: true,
  hasEvidence: true,
  evidenceWritten: true,
};

// ------------------------------------------------------------------ reports

export interface CaseReport {
  file: string;
  status: 'pass' | 'blocked' | 'fail';
  steps: string[];
  /** Something 1040kit (or the assistant, in the assistant journey) did wrong. */
  failures: string[];
  /** Expected stops (out-of-scope items) and things worth a look. */
  notes: string[];
  /** Questions answered from DEFAULTS, not the golden. */
  defaulted: string[];
  /** Golden facts nobody asked about. */
  volunteered: string[];
  pdf?: string;
  [extra: string]: unknown;
}

export const newReport = (file: string): CaseReport => ({
  file,
  status: 'pass',
  steps: [],
  failures: [],
  notes: [],
  defaulted: [],
  volunteered: [],
});

/** Run `fn` over items with at most `n` at a time. */
export async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    })
  );
}

export function printCase(r: CaseReport) {
  console.error(`${r.status.padEnd(7)} ${r.file}  ${r.steps.join(' > ')}`);
  for (const f of r.failures) console.error(`          ✗ ${f.slice(0, 300)}`);
}

export function summarize<E extends Record<string, unknown>>(
  reports: CaseReport[],
  extra: E
) {
  reports.sort((a, b) => a.file.localeCompare(b.file));
  return {
    summary: {
      ...extra,
      pass: reports.filter((r) => r.status === 'pass').length,
      blocked: reports.filter((r) => r.status === 'blocked').length,
      fail: reports.filter((r) => r.status === 'fail').length,
    },
    cases: reports,
  };
}

// ------------------------------------------------------------ verification

/**
 * Check a finished return against its golden: every `expect` node, the forms
 * list, the review outcome, every printed line's place in the PDF, and the
 * Free File entry sheet. Needs the user's confirmation already recorded
 * (return_review confirmed) unless `confirm` is true, which records it.
 *
 * Returns false when the return stops on something out of scope (`blocked`).
 */
export async function verifyReturn(
  call: Call,
  W: string,
  g: Golden,
  rep: CaseReport,
  confirm: boolean
): Promise<boolean> {
  const fail = (s: string) => rep.failures.push(s);
  const c = await call('calc_return', { workspace: W });
  if (!c.ok) throw new Error(`calc_return: ${JSON.stringify(c.error)}`);
  if (c.missing?.length)
    fail(
      `calc_return still missing: ${c.missing.map((m: Any) => m.path).join(', ')}`
    );
  const byId = new Map<string, Any>((c.lines ?? []).map((l: Any) => [l.id, l]));
  for (const [id, want] of Object.entries(g.expect ?? {})) {
    if (id === 'complete') continue;
    let got: unknown;
    if (id.startsWith('summary.'))
      got = c.summary?.[id.slice('summary.'.length)];
    else if (byId.has(id)) got = byId.get(id).value;
    else {
      const e = await call('explain_line', { workspace: W, ref: id, depth: 0 });
      got = e.ok
        ? (e.explanation?.value ?? e.explanation?.node?.value)
        : `error ${e.error?.code}`;
    }
    if ((got ?? 0) !== want)
      fail(`${id}: golden ${want}, got ${JSON.stringify(got)}`);
  }
  if (g.forms && [...c.forms].sort().join() !== [...g.forms].sort().join())
    fail(`forms ${c.forms.join(', ')}; golden ${g.forms.join(', ')}`);
  rep.steps.push('calc');

  const checks = await call('review_checks', { workspace: W });
  for (const x of checks.checks ?? [])
    if (x.severity === 'error')
      fail(`review_checks error ${x.code}: ${x.message}`);
  const rv = await call('return_review', { workspace: W });
  if (!rv.ok) throw new Error(`return_review: ${JSON.stringify(rv.error)}`);
  if (!rv.ready) {
    const blockers: Any[] = rv.blockers ?? [];
    const unsupported = blockers.filter((b) =>
      b.code.startsWith('unsupported:')
    );
    for (const b of unsupported)
      rep.notes.push(`stops (out of scope): ${b.message}`);
    for (const b of blockers.filter((b) => !b.code.startsWith('unsupported:')))
      fail(`return_review blocker ${b.code}: ${b.message}`);
    if (unsupported.length && rep.failures.length === 0) rep.status = 'blocked';
    return false;
  }
  const want = g.expect?.['summary.refundOrOwed'];
  if (
    want !== undefined &&
    rv.return?.outcome?.amount !== Math.abs(Number(want))
  )
    fail(`outcome ${JSON.stringify(rv.return?.outcome)}; golden ${want}`);
  // Asked until the user confirms; after that the review just says so.
  if (
    rv.confirmed !== true &&
    !String(rv.confirmPrompt).includes('terms-of-service')
  )
    fail('confirmPrompt has no link to the terms');
  if (confirm) {
    const confirmed = await call('return_review', {
      workspace: W,
      confirmed: true,
    });
    if (!confirmed.confirmed)
      fail('return_review did not record the confirmation');
  }
  rep.steps.push('review');

  const filled = await call('forms_fill', { workspace: W });
  if (!filled.ok) {
    fail(`forms_fill: ${JSON.stringify(filled.error)}`);
    return true;
  }
  if (filled.unmappedLines?.length)
    fail(`lines with no PDF field: ${JSON.stringify(filled.unmappedLines)}`);
  rep.pdf = filled.files.find((p: string) => p.endsWith('.pdf'));
  await checkPdf(rep.pdf!, c, rep);
  rep.steps.push('forms');

  for (const path of ['mail', 'fillable_forms']) {
    const fp = await call('filing_prepare', { workspace: W, path });
    if (!fp.ok) {
      fail(`filing_prepare ${path}: ${JSON.stringify(fp.error)}`);
      continue;
    }
    if (path !== 'fillable_forms') continue;
    const text = (
      await Promise.all(
        (fp.files ?? []).map((f: Any) => readFile(f.path ?? f, 'utf8'))
      )
    ).join('\n');
    for (const l of c.lines ?? [])
      if (!text.includes(dollars(l.value)) && !text.includes(String(l.value)))
        fail(
          `entry sheet lacks ${l.form} line ${l.line} = ${dollars(l.value)}`
        );
  }
  rep.steps.push('filing');
  return true;
}

/** Header text that starts each form (checked in this order). */
const FORM_MARKS: [string, RegExp][] = [
  ['f8829', /Form\s*8829/i],
  ['f8959', /Form\s*8959/i],
  ['f8960', /Form\s*8960/i],
  ['f8995', /Form\s*8995\b/i],
  ['sch1a', /SCHEDULE 1-A/i],
  ['sch8812', /SCHEDULE 8812/i],
  ['schEIC', /SCHEDULE EIC/i],
  ['schSE', /SCHEDULE SE\b/i],
  ['schB', /SCHEDULE B\b/i],
  ['schC', /SCHEDULE C\b/i],
  ['schE', /SCHEDULE E\b/i],
  ['sch1', /SCHEDULE 1\b/i],
  ['sch2', /SCHEDULE 2\b/i],
  ['sch3', /SCHEDULE 3\b/i],
  ['f1040', /Form\s*1040\b/],
];

interface Item {
  s: string;
  x: number;
  y: number;
}

/**
 * Every printed line: the value is on one of its form's pages, on a row (±7pt)
 * that also carries the line's IRS label left of it. The label comes from the
 * page text, so this doesn't trust the field maps. Lines whose label sits
 * elsewhere on the form (Schedule 1 "top", Schedule EIC line 6) are notes.
 */
export async function checkPdf(path: string, c: Any, rep: CaseReport) {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const pages: { form: string; items: Item[] }[] = [];
  let form = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    const items: Item[] = (tc.items as Any[])
      .map((it) => ({
        s: String(it.str).trim(),
        x: it.transform[4],
        y: it.transform[5],
      }))
      .filter((it) => it.s);
    const head = items
      .filter((it) => it.y > 690)
      .map((it) => it.s)
      .join(' ');
    // A form's first page names the Treasury; later pages keep the form.
    if (
      !form ||
      /Department of the Treasury|Internal Revenue Service/.test(head)
    )
      form = FORM_MARKS.find(([, re]) => re.test(head))?.[0] ?? form;
    pages.push({ form, items });
  }
  // Two owners' copies of a form (schC.taxpayer, schC.spouse) print in order.
  const copies = new Map<string, string[]>();
  for (const f of c.forms as string[]) {
    const base = f.split('.')[0]!;
    copies.set(base, [...(copies.get(base) ?? []), f]);
  }
  for (const l of c.lines ?? []) {
    const base = l.form.split('.')[0];
    let idx = pages.flatMap((p, i) => (p.form === base ? [i] : []));
    const list = copies.get(base) ?? [l.form];
    if (list.length > 1) {
      const per = idx.length / list.length;
      const k = list.indexOf(l.form);
      idx = idx.slice(k * per, (k + 1) * per);
    }
    if (!idx.length) {
      rep.failures.push(`PDF: no pages for ${l.form}`);
      continue;
    }
    const v = dollars(l.value);
    const digits = String(l.value);
    const hits: (Item & { page: number })[] = [];
    for (const i of idx) {
      const items = pages[i]!.items;
      for (const it of items)
        if (it.s === v || it.s === `(${v.replace('-', '')})`)
          hits.push({ ...it, page: i });
      // Comb fields (one box per digit, e.g. Schedule EIC birth years).
      const rows = new Map<number, Item[]>();
      for (const it of items.filter(
        (it) => it.s.length === 1 && /\d/.test(it.s)
      ))
        rows.set(Math.round(it.y), [...(rows.get(Math.round(it.y)) ?? []), it]);
      for (const row of rows.values()) {
        const sorted = row.sort((a, b) => a.x - b.x);
        const at = sorted
          .map((it) => it.s)
          .join('')
          .indexOf(digits);
        if (at >= 0) hits.push({ ...sorted[at]!, s: digits, page: i });
      }
    }
    if (!hits.length) {
      rep.failures.push(`PDF: ${l.form} line ${l.line} (${v}) is not printed`);
      continue;
    }
    // "16:b" (column b), "2.fair:A", "1i" (printed as "i"): the label to find.
    const label = String(l.line).split(/[:.]/)[0]!;
    const sub = /^\d+([a-z]+)$/.exec(label)?.[1];
    const isLabel = (s: string) =>
      s === label ||
      s === `${label}.` ||
      s.startsWith(`${label} `) ||
      s === sub;
    const onRow = hits.some((h) =>
      pages[h.page]!.items.some(
        (it) => Math.abs(it.y - h.y) < 7 && it.x < h.x && isLabel(it.s)
      )
    );
    if (!onRow)
      rep.notes.push(
        `PDF: ${l.form} line ${l.line} (${v}) printed, its row label not found`
      );
  }
}
