/**
 * Golden journey: every engine golden return, run through the MCP server the
 * way a user's assistant would, and checked end to end.
 *
 * For each `packages/engine/test/golden/*.json` it starts its own server
 * (own KIT1040_HOME), then:
 *
 *   1. workspace_init: the agreement is asked, gated tools refuse before it;
 *   2. writes the return's W-2 / 1099 / 1098-E documents into the inbox as
 *      PDFs, then docs_scan + docs_extract;
 *   3. answers interview_next questions from the golden facts, only when
 *      asked (situations multiselect, group forms, new-dependent forms);
 *   4. claims deductions_find items whose fact paths the golden has;
 *   5. "volunteers" any golden fact nobody asked about, and reports it;
 *   6. records names and address (skill step 5), then calc_return and checks
 *      every golden `expect` node, the forms list and the stored facts;
 *   7. review_checks, return_review, confirmation, forms_fill;
 *   8. checks every printed line in the flattened PDF: its value is on the
 *      right form, on the row whose IRS line label matches (read from the
 *      page text, independent of the field maps);
 *   9. filing_prepare for mail and Free File Fillable Forms, and checks the
 *      entry sheet has every line.
 *
 * Answers the golden doesn't record (business code, vehicle questions…) come
 * from DEFAULTS and are listed per case as `defaulted`. Synthetic people
 * only (see fixtures/make-pdfs.ts).
 *
 *   pnpm --filter 1040kit test:journey                  # this checkout (src)
 *   pnpm --filter 1040kit test:journey -- --server=dist # the built bundle
 *   pnpm --filter 1040kit test:journey -- --server=npm@0.1.2
 *   pnpm --filter 1040kit test:journey -- single-freelance   # name filter
 *
 * Options: --server=src|dist|npm[@version], --concurrency=N, --out=report.json,
 * --keep (keep the temporary workspaces). Exits 1 when any case fails.
 * See docs/golden-journey.md.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocumentProxy } from 'unpdf';

import { SERVER_VERSION } from '../src/version.ts';
import { FAKE } from './fixtures/make-pdfs.ts';

type Any = any;

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const goldenDir = fileURLToPath(
  new URL('../../engine/test/golden/', import.meta.url)
);

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const server = opt('server') ?? 'src';
const concurrency = Number(opt('concurrency') ?? 4);
const outPath = opt('out');
const keep = args.includes('--keep');
const filters = args.filter((a) => !a.startsWith('--'));

const files = readdirSync(goldenDir)
  .filter((f) => f.endsWith('.json'))
  .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x)));

/** The command that starts the server under test, and the version it must report. */
function serverCommand(): { command: string; args: string[]; version: string } {
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
  if (!m) throw new Error(`--server must be src, dist or npm[@version]`);
  const version = m[1] ?? 'latest';
  return {
    command: 'npx',
    args: ['-y', `1040kit@${version}`],
    version,
  };
}

// ---------------------------------------------------------------- documents

const money = (cents: number) =>
  (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dollars = (v: number) =>
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

const NAMES: Record<string, [string, string]> = {
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
function documentsFor(f: Any): [string, Promise<Uint8Array>][] {
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

// ----------------------------------------------------------------- answers

/** A fact path against the golden facts: `[x]` matches a list item's id, or a business's owner. */
function lookup(facts: Any, path: string): unknown {
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

/** What the forms print and the golden doesn't hold: names, occupation, addresses. */
function identityAnswer(path: string): unknown {
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
  const fixed: Record<string, string> = {
    'identity.address.street': '1 Main St',
    'identity.address.city': 'Austin',
    'identity.address.state': 'TX',
    'identity.address.zip': '78701',
    stateOfResidence: 'TX',
  };
  if (path in fixed) return fixed[path];
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
const DEFAULTS: Record<string, unknown> = {
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

// ------------------------------------------------------------------ the run

interface CaseReport {
  file: string;
  status: 'pass' | 'blocked' | 'fail';
  steps: string[];
  /** Something 1040kit did wrong. */
  failures: string[];
  /** Expected stops (out-of-scope items) and things worth a look. */
  notes: string[];
  /** Questions answered from DEFAULTS, not the golden. */
  defaulted: string[];
  /** Golden facts nobody asked about. */
  volunteered: string[];
  rounds: number;
  questions: number;
  pdf?: string;
}

async function runCase(file: string, home: string): Promise<CaseReport> {
  const g = JSON.parse(readFileSync(join(goldenDir, file), 'utf8'));
  const facts = g.facts;
  const rep: CaseReport = {
    file,
    status: 'pass',
    steps: [],
    failures: [],
    notes: [],
    defaulted: [],
    volunteered: [],
    rounds: 0,
    questions: 0,
  };
  const fail = (s: string) => rep.failures.push(s);
  const cmd = serverCommand();
  const transport = new StdioClientTransport({
    command: cmd.command,
    args: cmd.args,
    cwd: home,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      KIT1040_HOME: join(home, 'home'),
      KIT1040_CONFIG_DIR: join(home, 'config'),
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (d: Buffer) => (stderr += d));
  const client = new Client({ name: 'golden-journey', version: '0' });
  try {
    await client.connect(transport);
  } catch (e) {
    fail(`the server did not start: ${String(e)}\n${stderr.slice(-1500)}`);
    rep.status = 'fail';
    return rep;
  }
  const reported = client.getServerVersion()?.version;
  if (cmd.version !== 'latest' && reported !== cmd.version)
    fail(`server reports version ${reported}, expected ${cmd.version}`);
  const call = async (name: string, a: Any): Promise<Any> => {
    const r = await client.callTool({ name, arguments: a }, undefined, {
      timeout: 300_000,
    });
    const s = r.structuredContent as Any;
    if (!s)
      throw new Error(
        `${name}: ${JSON.stringify(r.content).slice(0, 300)}\n${stderr}`
      );
    return s;
  };

  try {
    // 1. Agreement
    const year = facts.taxYear;
    const first = await call('workspace_init', { year });
    if (first.acknowledgment?.agreed !== false)
      fail('the agreement was not asked on the first workspace_init');
    const early = await call('interview_next', { workspace: first.workspace });
    if (early.error?.code !== 'ACK_REQUIRED')
      fail('interview_next worked before the user agreed');
    const ws = await call('workspace_init', { year, acknowledged: true });
    if (!ws.ok) throw new Error(`workspace_init: ${JSON.stringify(ws.error)}`);
    const W = ws.workspace;
    rep.steps.push('agreement');

    // 2. Documents
    const docs = documentsFor(facts);
    for (const [name, bytes] of docs)
      await writeFile(join(ws.inbox, name), await bytes);
    const scan = await call('docs_scan', { workspace: W });
    if ((scan.documents ?? []).length !== docs.length)
      fail(
        `docs_scan found ${scan.documents?.length} of ${docs.length} documents`
      );
    if (docs.length) {
      const ex = await call('docs_extract', { workspace: W });
      if (!ex.ok) fail(`docs_extract: ${JSON.stringify(ex.error)}`);
      for (const e of ex.extracted ?? [])
        for (const l of e.lowConfidence ?? [])
          if (l.field !== 'owner')
            rep.notes.push(`lowConfidence ${e.kind}.${l.field}: ${l.reason}`);
    }
    rep.steps.push(`docs(${docs.length})`);

    // 3. Interview
    const sent = new Set<string>();
    const answer = (path: string, kind?: string): unknown => {
      const id = identityAnswer(path);
      if (id !== undefined) return id;
      const v = lookup(facts, path);
      if (v !== undefined) return v;
      if (path === 'screening.hasDependents')
        return facts.dependents.length > 0;
      if (path === 'screening.paidStudentLoanInterest')
        return facts.e1098s.length > 0;
      if (path === 'screening.hasRentalOrRoyaltyIncome')
        return (
          facts.rentals.length > 0 ||
          facts.misc1099s.some((m: Any) => m.rents || m.royalties)
        );
      if (path === 'outOfScope.other') return [];
      if (
        /^(outOfScope|screening)\./.test(path) ||
        path === 'digitalAssetActivity'
      )
        return false;
      const leaf = path.slice(path.lastIndexOf('.') + 1);
      if (leaf in DEFAULTS) {
        rep.defaulted.push(`${path} = ${JSON.stringify(DEFAULTS[leaf])}`);
        return DEFAULTS[leaf];
      }
      rep.defaulted.push(`${path} = (no answer, ${kind})`);
      return undefined;
    };
    const answersFor = (q: Any): { path: string; value: unknown }[] => {
      const set: { path: string; value: unknown }[] = [];
      const a = q.answer;
      if (a?.kind === 'multiselect') {
        for (const o of a.options)
          set.push({ path: o.path, value: answer(o.path) });
        if (a.other)
          set.push({ path: a.other.path, value: answer(a.other.path) });
      } else if (a?.kind === 'group' && a.addAnother) {
        // New dependents: the first person's fields, then addAnother per extra one.
        if (facts.dependents.length === 0)
          fail('the new-dependent form was asked with no dependents');
        const firstIndex = Number(
          /dependent_(\d+)/.exec(a.fields[0].path)?.[1]
        );
        facts.dependents.forEach((_: Any, i: number) => {
          const index = i === 0 ? firstIndex : a.addAnother.nextIndex + i - 1;
          for (const f of i === 0 ? a.fields : a.addAnother.fields) {
            const p = f.path.replace('{id}', `dependent_${index}`);
            const golden = p.replace(/dependent_\d+/, facts.dependents[i].id);
            const v = p.startsWith('identity.')
              ? identityAnswer(p)
              : (lookup(facts, golden) ?? answer(p, f.answer?.kind));
            if (v !== undefined) set.push({ path: p, value: v });
          }
        });
      } else if (a?.kind === 'group') {
        for (const f of a.fields) {
          const v = answer(f.path, f.answer?.kind);
          if (v !== undefined) set.push({ path: f.path, value: v });
        }
      } else if (q.path === 'rentals') {
        for (const r of facts.rentals) {
          for (const [k, v] of Object.entries(r))
            if (!['id', 'misc1099Ids', 'expenses'].includes(k))
              set.push({ path: `rentals[${r.id}].${k}`, value: v });
          for (const [k, v] of Object.entries(r.expenses ?? {}))
            set.push({ path: `rentals[${r.id}].expenses.${k}`, value: v });
        }
      } else if (q.path === 'rentals[<id>].misc1099Ids') {
        const r = facts.rentals[0];
        if (r) {
          set.push({
            path: `rentals[${r.id}].misc1099Ids`,
            value: r.misc1099Ids,
          });
          set.push({ path: `rentals[${r.id}].owner`, value: r.owner });
        }
      } else if (/^businesses\[\w+\]$/.test(q.path)) {
        // "What business is the 1099 income from?": the business's name.
        const b = lookup(facts, q.path) as Any;
        set.push({ path: `${q.path}.name`, value: b?.name ?? DEFAULTS.name });
      } else {
        const v = answer(q.path, a?.kind);
        if (v !== undefined) set.push({ path: q.path, value: v });
      }
      return set;
    };
    const interview = async () => {
      let lastPhase = '';
      for (let round = 0; round < 40; round++) {
        const n = await call('interview_next', { workspace: W, limit: 5 });
        if (!n.ok)
          throw new Error(`interview_next: ${JSON.stringify(n.error)}`);
        if (n.done) return;
        rep.rounds++;
        if (lastPhase === 'deductions' && n.phase === 'income')
          fail(
            `the interview went back to income after deductions started: ${n.questions.map((q: Any) => q.path).join(', ')}`
          );
        lastPhase = n.phase;
        const set = n.questions.flatMap((q: Any) => {
          rep.questions++;
          if (!q.why) fail(`question without a why: ${q.path}`);
          return answersFor(q);
        });
        const fresh = set.filter(
          (s: Any) => !sent.has(s.path + JSON.stringify(s.value))
        );
        if (fresh.length === 0) {
          fail(
            `the interview repeats answered questions: ${n.questions.map((q: Any) => q.path).join(', ')}`
          );
          return;
        }
        for (const s of fresh) sent.add(s.path + JSON.stringify(s.value));
        const r = await call('profile_set', {
          workspace: W,
          set: fresh.map((s: Any) => ({ ...s, source: 'user' })),
        });
        if (!r.ok || r.rejected?.length)
          fail(
            `profile_set rejected: ${JSON.stringify(r.rejected ?? r.error)}`
          );
      }
      fail('the interview did not finish in 40 rounds');
    };
    await interview();
    rep.steps.push(
      `interview(${rep.rounds} rounds, ${rep.questions} questions)`
    );

    // 4. Deductions: claim what the golden has at each item's fact paths.
    const found = await call('deductions_find', { workspace: W });
    const ids = Object.values(facts).flatMap((v: Any) =>
      Array.isArray(v) ? v.map((x: Any) => x.id).filter(Boolean) : []
    );
    const claims: Any[] = [];
    for (const o of found.opportunities ?? []) {
      const paths = (o.factPaths ?? []).flatMap((p: string) =>
        p.includes('<owner>')
          ? ['taxpayer', 'spouse'].map((w) => p.replace('<owner>', w))
          : p.includes('<id>')
            ? ids.map((i: string) => p.replace('<id>', i))
            : [p]
      );
      for (const p of paths) {
        const v = lookup(facts, p);
        if (v !== undefined && !Array.isArray(v))
          claims.push({ path: p, value: v, source: 'user' });
      }
    }
    if (claims.length) {
      const r = await call('profile_set', { workspace: W, set: claims });
      if (r.rejected?.length)
        fail(`deduction claims rejected: ${JSON.stringify(r.rejected)}`);
    }
    rep.steps.push(`deductions(${claims.length})`);

    // 5. Golden facts nobody asked about: volunteer them, then finish the interview.
    const leaves: [string, unknown][] = [];
    const walk = (v: Any, p: string) => {
      if (Array.isArray(v) && v.some((x) => x && typeof x === 'object'))
        v.forEach((x) => walk(x, `${p}[${x?.id ?? x?.owner}]`));
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
      else leaves.push([p, v]);
    };
    walk(facts, '');
    const skip = (p: string) =>
      p === 'taxYear' || /\.(id|employerEinToken|payerToken)$/.test(p);
    const stored = async () =>
      (await call('profile_get', { workspace: W })).facts;
    const before = await stored();
    const unasked = leaves.filter(
      ([p, v]) =>
        !skip(p) &&
        !p.endsWith('.owner') &&
        lookup(before, p) === undefined &&
        v !== false &&
        !(Array.isArray(v) && v.length === 0)
    );
    if (unasked.length) {
      rep.volunteered.push(
        ...unasked.map(([p, v]) => `${p} = ${JSON.stringify(v)}`)
      );
      const r = await call('profile_set', {
        workspace: W,
        set: unasked.map(([path, value]) => ({ path, value, source: 'user' })),
      });
      if (r.rejected?.length)
        rep.notes.push(
          `volunteered facts rejected: ${JSON.stringify(r.rejected)}`
        );
      await interview();
    }
    const after = await stored();
    for (const [p, v] of leaves) {
      if (skip(p)) continue;
      const h = lookup(after, p);
      if (h === undefined && (v === false || (Array.isArray(v) && !v.length)))
        continue;
      if (JSON.stringify(h) !== JSON.stringify(v))
        fail(
          `fact ${p}: golden ${JSON.stringify(v)}, stored ${JSON.stringify(h)}`
        );
    }

    // 6. Names and address (do-my-taxes step 5), then compute.
    const idPaths = [
      'identity.taxpayer.firstName',
      'identity.taxpayer.lastName',
      'identity.taxpayer.occupation',
      ...(facts.filingStatus === 'mfj'
        ? [
            'identity.spouse.firstName',
            'identity.spouse.lastName',
            'identity.spouse.occupation',
          ]
        : []),
      ...facts.dependents.flatMap((_: Any, i: number) => [
        `identity.dependents[dependent_${i + 1}].firstName`,
        `identity.dependents[dependent_${i + 1}].lastName`,
      ]),
      'identity.address.street',
      'identity.address.city',
      'identity.address.state',
      'identity.address.zip',
      ...facts.rentals.flatMap((r: Any) =>
        ['street', 'city', 'state', 'zip'].map(
          (k) => `identity.rentals[${r.id}].address.${k}`
        )
      ),
      ...facts.businesses
        .filter((b: Any) => b.operatedFromHome === false)
        .flatMap((b: Any) => [
          `identity.businesses[${b.owner}].address.street`,
          `identity.businesses[${b.owner}].address.cityStateZip`,
        ]),
    ];
    const idr = await call('profile_set', {
      workspace: W,
      set: idPaths.map((path) => ({
        path,
        value: identityAnswer(path),
        source: 'user',
      })),
    });
    if (idr.rejected?.length) {
      fail(`names/address rejected: ${JSON.stringify(idr.rejected)}`);
      // Keep going so the forms still get checked: the whole object is accepted.
      if (idr.rejected.some((x: Any) => x.path.startsWith('identity.spouse.')))
        await call('profile_set', {
          workspace: W,
          set: [
            {
              path: 'identity.spouse',
              value: {
                firstName: 'Sam',
                lastName: 'Example',
                occupation: 'Designer',
              },
              source: 'user',
            },
          ],
        });
    }

    const c = await call('calc_return', { workspace: W });
    if (!c.ok) throw new Error(`calc_return: ${JSON.stringify(c.error)}`);
    if (c.missing?.length)
      fail(
        `calc_return still missing: ${c.missing.map((m: Any) => m.path).join(', ')}`
      );
    const byId = new Map<string, Any>(
      (c.lines ?? []).map((l: Any) => [l.id, l])
    );
    for (const [id, want] of Object.entries(g.expect ?? {})) {
      if (id === 'complete') continue;
      let got: unknown;
      if (id.startsWith('summary.'))
        got = c.summary?.[id.slice('summary.'.length)];
      else if (byId.has(id)) got = byId.get(id).value;
      else {
        const e = await call('explain_line', {
          workspace: W,
          ref: id,
          depth: 0,
        });
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

    // 7. Review, confirmation, forms.
    const checks = await call('review_checks', { workspace: W });
    for (const x of checks.checks ?? [])
      if (x.severity === 'error')
        fail(`review_checks error ${x.code}: ${x.message}`);
    const unreviewed = await call('forms_fill', { workspace: W });
    if (unreviewed.ok) fail('forms_fill worked before return_review');
    const rv = await call('return_review', { workspace: W });
    if (!rv.ok) throw new Error(`return_review: ${JSON.stringify(rv.error)}`);
    if (!rv.ready) {
      const blockers: Any[] = rv.blockers ?? [];
      const unsupported = blockers.filter((b) =>
        b.code.startsWith('unsupported:')
      );
      for (const b of unsupported)
        rep.notes.push(`stops (out of scope): ${b.message}`);
      for (const b of blockers.filter(
        (b) => !b.code.startsWith('unsupported:')
      ))
        fail(`return_review blocker ${b.code}: ${b.message}`);
      if (unsupported.length && rep.failures.length === 0)
        rep.status = 'blocked';
      return rep;
    }
    const want = g.expect?.['summary.refundOrOwed'];
    if (want !== undefined && rv.return?.outcome?.amount !== Math.abs(want))
      fail(`outcome ${JSON.stringify(rv.return?.outcome)}; golden ${want}`);
    if (!String(rv.confirmPrompt).includes('terms-of-service'))
      fail('confirmPrompt has no link to the terms');
    const confirmed = await call('return_review', {
      workspace: W,
      confirmed: true,
    });
    if (!confirmed.confirmed)
      fail('return_review did not record the confirmation');
    rep.steps.push('review');

    const filled = await call('forms_fill', { workspace: W });
    if (!filled.ok) {
      fail(`forms_fill: ${JSON.stringify(filled.error)}`);
      return rep;
    }
    if (filled.unmappedLines?.length)
      fail(`lines with no PDF field: ${JSON.stringify(filled.unmappedLines)}`);
    rep.pdf = filled.files.find((p: string) => p.endsWith('.pdf'));
    await checkPdf(rep.pdf!, c, rep);
    rep.steps.push('forms');

    // 9. Filing paths; the Free File entry sheet must list every line.
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
  } catch (e) {
    fail(`crashed: ${String(e).slice(0, 500)}`);
  } finally {
    await client.close();
    if (rep.failures.length) rep.status = 'fail';
  }
  return rep;
}

// ---------------------------------------------------------------- PDF check

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
 * that also carries the line's IRS label left of it. Lines whose label sits
 * elsewhere on the form (Schedule 1 "top", Schedule EIC line 6) are notes.
 */
async function checkPdf(path: string, c: Any, rep: CaseReport) {
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
        const joined = sorted.map((it) => it.s).join('');
        const at = joined.indexOf(digits);
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

// ------------------------------------------------------------------- main

const work = await mkdtemp(join(tmpdir(), '1040kit-journey-'));
const reports: CaseReport[] = [];
let next = 0;
console.error(
  `golden journey: ${files.length} returns, server ${server}, in ${work}`
);
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < files.length) {
      const file = files[next++]!;
      const home = join(work, file.replace(/\.json$/, ''));
      await mkdir(home, { recursive: true });
      const r = await runCase(file, home);
      reports.push(r);
      console.error(`${r.status.padEnd(7)} ${file}  ${r.steps.join(' > ')}`);
      for (const f of r.failures)
        console.error(`          ✗ ${f.slice(0, 300)}`);
    }
  })
);
reports.sort((a, b) => a.file.localeCompare(b.file));
const summary = {
  server,
  pass: reports.filter((r) => r.status === 'pass').length,
  blocked: reports.filter((r) => r.status === 'blocked').length,
  fail: reports.filter((r) => r.status === 'fail').length,
};
const report = JSON.stringify({ summary, cases: reports }, null, 2);
const reportPath = resolvePath(outPath ?? join(work, 'report.json'));
await writeFile(reportPath, report);
if (!keep && !outPath?.startsWith(work)) {
  // Keep only the report; the workspaces hold synthetic returns, but tidy up.
  for (const f of files)
    await rm(join(work, f.replace(/\.json$/, '')), {
      recursive: true,
      force: true,
    });
}
console.error(
  `\n${summary.pass} pass, ${summary.blocked} blocked (out of scope), ${summary.fail} fail. Report: ${reportPath}`
);
process.exit(summary.fail ? 1 : 0);
