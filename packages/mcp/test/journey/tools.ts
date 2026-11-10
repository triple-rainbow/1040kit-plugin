/**
 * Tool journey (layer 2 in docs/e2e-testing.md): a script plays both the
 * user and the assistant, calling the MCP tools in do-my-taxes playbook order
 * for every engine golden return. Deterministic, no model, a few minutes.
 *
 * For each golden, with its own server and KIT1040_HOME:
 *
 *   1. workspace_init: the agreement is asked, gated tools refuse before it;
 *   2. the golden's W-2 / 1099 / 1098-E PDFs go into the inbox, then
 *      docs_scan + docs_extract;
 *   3. interview_next questions are answered from the golden facts, only when
 *      asked (situations multiselect, group forms, new-dependent forms);
 *   4. deductions_find items are claimed where the golden has their facts;
 *   5. golden facts nobody asked about are volunteered, and listed;
 *   6. names and address, then verifyReturn (shared.ts): numbers, review,
 *      confirmation, PDF placement, both filing paths.
 *
 *   pnpm --filter 1040kit test:journey                         # this checkout
 *   pnpm --filter 1040kit test:journey -- --server=npm@0.1.2   # a release
 *   pnpm --filter 1040kit test:journey -- single-freelance     # name filter
 *
 * Options: --server=src|dist|npm[@version], --concurrency=N, --out=<file>,
 * --keep. Exits 1 when any case fails.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  connect,
  DEFAULTS,
  flag,
  goldens,
  identityAnswer,
  lookup,
  newReport,
  opt,
  pool,
  printCase,
  saveDocuments,
  summarize,
  verifyReturn,
  type Any,
  type CaseReport,
  type Golden,
} from './shared.ts';

const server = opt('server') ?? 'src';

async function runCase(g: Golden, dir: string): Promise<CaseReport> {
  const facts = g.facts;
  const rep = newReport(g.file);
  const fail = (s: string) => rep.failures.push(s);
  let conn;
  try {
    conn = await connect(server, dir);
  } catch (e) {
    fail(String(e));
    rep.status = 'fail';
    return rep;
  }
  const { call } = conn;
  if (conn.versionProblem) fail(conn.versionProblem);
  let rounds = 0;
  let questions = 0;

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
    const count = await saveDocuments(facts, ws.inbox);
    const scan = await call('docs_scan', { workspace: W });
    if ((scan.documents ?? []).length !== count)
      fail(`docs_scan found ${scan.documents?.length} of ${count} documents`);
    if (count) {
      const ex = await call('docs_extract', { workspace: W });
      if (!ex.ok) fail(`docs_extract: ${JSON.stringify(ex.error)}`);
      for (const e of ex.extracted ?? [])
        for (const l of e.lowConfidence ?? [])
          if (l.field !== 'owner')
            rep.notes.push(`lowConfidence ${e.kind}.${l.field}: ${l.reason}`);
    }
    rep.steps.push(`docs(${count})`);

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
        rounds++;
        if (lastPhase === 'deductions' && n.phase === 'income')
          fail(
            `the interview went back to income after deductions started: ${n.questions.map((q: Any) => q.path).join(', ')}`
          );
        lastPhase = n.phase;
        const set = n.questions.flatMap((q: Any) => {
          questions++;
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
    rep.steps.push(`interview(${rounds} rounds, ${questions} questions)`);

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

    // 6. Names and address (do-my-taxes step 5).
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

    // Numbers, review and confirmation, forms, filing.
    const unreviewed = await call('forms_fill', { workspace: W });
    if (unreviewed.ok) fail('forms_fill worked before return_review');
    await verifyReturn(call, W, g, rep, true);
  } catch (e) {
    fail(`crashed: ${String(e).slice(0, 500)}`);
  } finally {
    await conn.close();
    if (rep.failures.length) rep.status = 'fail';
    else if (rep.status !== 'blocked') rep.status = 'pass';
  }
  return rep;
}

const cases = goldens();
const work = await mkdtemp(join(tmpdir(), '1040kit-journey-'));
console.error(
  `tool journey: ${cases.length} returns, server ${server}, in ${work}`
);
const reports: CaseReport[] = [];
await pool(cases, Number(opt('concurrency') ?? 4), async (g) => {
  const dir = join(work, g.file.replace(/\.json$/, ''));
  await mkdir(dir, { recursive: true });
  const r = await runCase(g, dir);
  reports.push(r);
  printCase(r);
});
const result = summarize(reports, { journey: 'tools', server });
const reportPath = resolve(opt('out') ?? join(work, 'report.json'));
await writeFile(reportPath, JSON.stringify(result, null, 2));
if (!flag('keep'))
  for (const g of cases)
    await rm(join(work, g.file.replace(/\.json$/, '')), {
      recursive: true,
      force: true,
    });
const s = result.summary;
console.error(
  `\n${s.pass} pass, ${s.blocked} blocked (out of scope), ${s.fail} fail. Report: ${reportPath}`
);
process.exit(s.fail ? 1 : 0);
