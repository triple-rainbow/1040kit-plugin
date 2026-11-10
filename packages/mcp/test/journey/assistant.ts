/**
 * Assistant journey (layer 3 in docs/e2e-testing.md): Claude Code, with the
 * 1040kit plugin's skills, prepares a golden return in a real multi-turn
 * conversation, while a second model plays the taxpayer from the golden
 * facts. Then the finished workspace goes through the same verifyReturn
 * checks as the tool journey, plus checks on how the assistant used the
 * tools (playbook order, agreement and confirmation left to the user).
 *
 * It uses `claude -p … --resume` for both sides, so it needs a signed-in
 * Claude Code (`claude auth login`) or CLAUDE_CODE_OAUTH_TOKEN /
 * ANTHROPIC_API_KEY, and it costs model usage: run it before a release, not
 * on every change.
 *
 *   pnpm --filter 1040kit test:journey:assistant                    # 3 goldens
 *   pnpm --filter 1040kit test:journey:assistant -- w2-hoh --server=npm@0.1.2
 *   pnpm --filter 1040kit test:journey:assistant -- --all --concurrency=2
 *
 * Options:
 *   --server=src|dist|npm[@version]  server the assistant talks to (default src)
 *   --plugin-dir=<dir>    skills to load (default plugins/claude-code)
 *   --model=<m>           the assistant's model (default: Claude Code's)
 *   --user-model=<m>      the simulated taxpayer's model (default sonnet)
 *   --turns=N             most user replies per case (default 40)
 *   --budget=<usd>        cost ceiling per assistant turn (default 2)
 *   --concurrency=N       cases at once (default 1)
 *   --all                 every golden (default: a representative three)
 *   --out=<file>          JSON report path
 * Each case's folder keeps conversation.md, the full exchange.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  ADDRESS,
  connect,
  DEFAULTS,
  filters,
  flag,
  goldens,
  NAMES,
  newReport,
  opt,
  pool,
  printCase,
  repoDir,
  saveDocuments,
  serverCommand,
  serverEnv,
  summarize,
  verifyReturn,
  type Any,
  type CaseReport,
  type Golden,
} from './shared.ts';

const run = promisify(execFile);

const server = opt('server') ?? 'src';
const pluginDir = resolve(
  opt('plugin-dir') ?? join(repoDir, 'plugins/claude-code')
);
const model = opt('model');
const userModel = opt('user-model') ?? 'sonnet';
const maxTurns = Number(opt('turns') ?? 40);
const budget = opt('budget') ?? '2';

/** A taxpayer each, with income, a business, dependents and a joint return between them. */
const REPRESENTATIVE = [
  'single-freelance-sli-odc',
  'w2-mfj-two-earners',
  'ctc-hoh-actc',
];

/** Playbook order (do-my-taxes): each tool's first use must come after the previous one's. */
const PLAYBOOK = [
  'workspace_init',
  'docs_scan',
  'docs_extract',
  'interview_next',
  'calc_return',
  'deductions_find',
  'review_checks',
  'return_review',
  'forms_fill',
  'filing_prepare',
];

interface ToolUse {
  turn: number;
  name: string;
  input: Any;
}

interface Turn {
  text: string;
  sessionId: string;
  cost: number;
  tools: ToolUse[];
  denied: string[];
  error?: string;
}

/** One `claude -p` turn; stream-json gives the tool calls as well as the reply. */
async function claude(
  argv: string[],
  env: Record<string, string>,
  cwd: string,
  turn: number
): Promise<Turn> {
  const { stdout } = await run('claude', argv, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60_000,
  }).catch((e) => ({ stdout: String(e.stdout ?? ''), stderr: String(e) }));
  const out: Turn = { text: '', sessionId: '', cost: 0, tools: [], denied: [] };
  for (const line of stdout.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let ev: Any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === 'assistant')
      for (const c of ev.message?.content ?? [])
        if (c.type === 'tool_use')
          out.tools.push({
            turn,
            name: String(c.name).replace(/^mcp__.*?__/, ''),
            input: c.input,
          });
    if (ev.type === 'result') {
      out.text = String(ev.result ?? '');
      out.sessionId = ev.session_id ?? '';
      out.cost = Number(ev.total_cost_usd ?? 0);
      out.denied = (ev.permission_denials ?? []).map(
        (d: Any) =>
          `${d.tool_name} ${JSON.stringify(d.tool_input).slice(0, 120)}`
      );
      if (ev.is_error || /not logged in|failed to authenticate/i.test(out.text))
        out.error = out.text || 'error';
    }
  }
  if (!out.sessionId && !out.error)
    out.error = `no result: ${stdout.slice(-500)}`;
  return out;
}

/** Everything the simulated taxpayer knows, and how to behave. */
function persona(g: Golden): string {
  const f = g.facts;
  const people = [
    `You are ${NAMES.taxpayer!.join(' ')}${f.filingStatus === 'mfj' ? `, filing jointly with your spouse ${NAMES.spouse!.join(' ')}` : ''}.`,
    `Your address: ${ADDRESS.street}, ${ADDRESS.city}, ${ADDRESS.state} ${ADDRESS.zip}. Occupation: Designer.`,
    f.dependents.length
      ? `Your dependents' first names, in order: ${f.dependents.map((_: Any, i: number) => `Kid${i + 1}`).join(', ')} (last name Example).`
      : '',
  ];
  return [
    `You are role-playing a US taxpayer talking to an AI assistant that prepares your ${f.taxYear} federal return with the 1040kit tools. Reply as the taxpayer only, in short plain sentences, the way a normal person types in a chat.`,
    ...people,
    `These are the true facts of your tax year (money in cents in this data; say dollars when you answer; ids like w2_1 are only labels):`,
    JSON.stringify(f, null, 1),
    `When a question isn't covered by those facts, answer from these defaults (by the last part of the field name), or say "no" / "none": ${JSON.stringify(DEFAULTS)}.`,
    'Rules:',
    '- Answer only what you are asked. Do not volunteer numbers unless asked, except: if the assistant asks whether there is anything else, mention any fact above it has not asked about yet.',
    '- Your W-2s, 1099s and 1098-E are PDFs on your computer. When the assistant tells you a folder to save them in, reply that you saved them there and that those are all your documents.',
    '- Never give a Social Security number, ITIN or bank account number. Say you will write them on the forms yourself.',
    '- When the assistant shows you the terms or an agreement, agree ("I agree").',
    '- When it shows the review of the whole return and asks you to confirm, reply "looks good".',
    '- When it asks how you will file, choose to print and mail.',
    '- When it lists possible deductions, pick only the ones your facts support.',
    '- When the forms are done and the assistant has explained how to file, or it says it cannot go on, reply with exactly: DONE',
  ]
    .filter(Boolean)
    .join('\n');
}

async function runCase(g: Golden, dir: string): Promise<CaseReport> {
  const rep = newReport(g.file);
  const fail = (s: string) => rep.failures.push(s);
  const year = g.facts.taxYear;
  const cwd = join(dir, 'chat');
  await mkdir(cwd, { recursive: true });
  const log = join(dir, 'conversation.md');
  await writeFile(log, `# ${g.file}\n\n${g.name}\n`);

  // The assistant's server: the same one the tool journey would start.
  const cmd = serverCommand(server);
  const mcpConfig = join(dir, 'mcp.json');
  await writeFile(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        '1040kit': {
          command: cmd.command,
          args: cmd.args,
          env: serverEnv(dir),
        },
      },
    })
  );
  const common = [
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
  ];
  const assistantArgs = (msg: string, sid: string) => [
    '-p',
    msg,
    ...common,
    '--plugin-dir',
    pluginDir,
    '--mcp-config',
    mcpConfig,
    '--allowedTools',
    'mcp__1040kit__*',
    'Skill',
    // The skill's reference pages, and the filing instructions it writes.
    `Read(/${pluginDir}/**)`,
    `Read(/${serverEnv(dir).KIT1040_HOME}/*/outputs/**)`,
    '--max-budget-usd',
    budget,
    ...(model ? ['--model', model] : []),
    ...(sid ? ['--resume', sid] : []),
  ];
  const userArgs = (msg: string, sid: string) => [
    '-p',
    msg,
    ...common,
    '--tools',
    '',
    '--model',
    userModel,
    '--system-prompt',
    persona(g),
    ...(sid ? ['--resume', sid] : []),
  ];

  const tools: ToolUse[] = [];
  const said: { turn: number; text: string }[] = [];
  let cost = 0;
  let aSid = '';
  let uSid = '';
  let message = `Hi, I'd like to do my ${year} taxes.`;
  let docsSaved = false;
  let done = false;
  for (let turn = 1; turn <= maxTurns && !done; turn++) {
    await appendFile(log, `\n## Taxpayer (${turn})\n\n${message}\n`);
    const a = await claude(assistantArgs(message, aSid), {}, cwd, turn);
    cost += a.cost;
    tools.push(...a.tools);
    for (const d of a.denied) rep.notes.push(`turn ${turn}: denied ${d}`);
    await appendFile(
      log,
      `\n## Assistant (${turn})\n\n_tools: ${a.tools.map((t) => t.name).join(', ') || 'none'}_\n\n${a.text}\n`
    );
    if (a.error) {
      fail(`assistant turn ${turn}: ${a.error.slice(0, 300)}`);
      break;
    }
    aSid = a.sessionId;
    said.push({ turn, text: a.text });
    // The user saves the documents once the workspace (and its inbox) exists.
    const inbox = join(serverEnv(dir).KIT1040_HOME, String(year), 'inbox');
    if (!docsSaved && existsSync(inbox)) {
      await saveDocuments(g.facts, inbox);
      docsSaved = true;
    }
    const u = await claude(
      userArgs(a.text || '(no reply)', uSid),
      {},
      cwd,
      turn
    );
    cost += u.cost;
    if (u.error) {
      fail(`simulated user turn ${turn}: ${u.error.slice(0, 300)}`);
      break;
    }
    uSid = u.sessionId;
    message = u.text.trim();
    done = message === 'DONE' || message.endsWith('DONE');
  }
  rep.steps.push(`conversation(${tools.length} tool calls)`);
  rep.cost = Number(cost.toFixed(2));
  rep.toolCalls = tools.map((t) => `${t.turn}:${t.name}`);
  if (!done) fail(`the conversation did not finish in ${maxTurns} turns`);

  // How the assistant used the tools.
  const firstAt = (name: string, pred: (t: ToolUse) => boolean = () => true) =>
    tools.findIndex((t) => t.name === name && pred(t));
  let prev = -1;
  for (const name of PLAYBOOK) {
    const at = firstAt(name);
    if (at < 0) {
      if (name !== 'docs_extract' || docsSaved) fail(`never called ${name}`);
      continue;
    }
    if (at < prev) fail(`${name} came before an earlier playbook step`);
    prev = Math.max(prev, at);
  }
  const init = tools.find((t) => t.name === 'workspace_init');
  const agreed = tools.find(
    (t) => t.name === 'workspace_init' && t.input?.acknowledged === true
  );
  if (agreed && init && agreed.turn === init.turn && init.input?.acknowledged)
    fail('agreed to the terms before showing them to the user');
  else if (agreed && init && agreed.turn === init.turn)
    fail('agreed to the terms in the same turn it showed them');
  const review = tools.find((t) => t.name === 'return_review');
  const confirmed = tools.find(
    (t) => t.name === 'return_review' && t.input?.confirmed === true
  );
  if (!confirmed) fail('never recorded the user’s confirmation of the return');
  else if (review && confirmed.turn === review.turn)
    fail('confirmed the return in the same turn it showed the review');
  // What the user must have been shown before agreeing and confirming.
  const shownBefore = (turn: number, re: RegExp) =>
    said.some((m) => m.turn < turn && re.test(m.text));
  if (agreed && !shownBefore(agreed.turn, /not tax advice/i))
    fail('agreed to the terms without showing the agreement text');
  if (confirmed && !shownBefore(confirmed.turn, /terms-of-service/))
    fail(
      'confirmed the return without showing the confirmation prompt and terms link'
    );

  // The finished workspace, checked like the tool journey.
  let conn;
  try {
    conn = await connect(server, dir);
    const ws = await conn.call('workspace_init', { year });
    if (!ws.ok) throw new Error(`workspace_init: ${JSON.stringify(ws.error)}`);
    await verifyReturn(conn.call, ws.workspace, g, rep, false);
  } catch (e) {
    fail(`verify: ${String(e).slice(0, 400)}`);
  } finally {
    await conn?.close();
  }
  rep.status = rep.failures.length ? 'fail' : rep.status;
  return rep;
}

// Signed in? One cheap call before spending on a whole run.
const probe = await claude(
  [
    '-p',
    'Reply with OK.',
    '--output-format',
    'stream-json',
    '--verbose',
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--tools',
    '',
  ],
  {},
  tmpdir(),
  0
);
if (probe.error) {
  console.error(
    `Claude Code can't run headless here: ${probe.error}\nSign in with \`claude auth login\`, or set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) or ANTHROPIC_API_KEY.`
  );
  process.exit(2);
}

const cases = goldens(
  flag('all') ? [] : filters.length ? filters : REPRESENTATIVE
);
const work = await mkdtemp(join(tmpdir(), '1040kit-assistant-'));
console.error(
  `assistant journey: ${cases.length} returns, server ${server}, plugin ${pluginDir}, in ${work}`
);
const reports: CaseReport[] = [];
await pool(cases, Number(opt('concurrency') ?? 1), async (g) => {
  const dir = join(work, g.file.replace(/\.json$/, ''));
  await mkdir(dir, { recursive: true });
  const r = await runCase(g, dir);
  reports.push(r);
  printCase(r);
});
const result = summarize(reports, {
  journey: 'assistant',
  server,
  pluginDir,
  cost: Number(reports.reduce((s, r) => s + Number(r.cost ?? 0), 0).toFixed(2)),
});
const reportPath = resolve(opt('out') ?? join(work, 'report.json'));
await writeFile(reportPath, JSON.stringify(result, null, 2));
const s = result.summary;
console.error(
  `\n${s.pass} pass, ${s.blocked} blocked, ${s.fail} fail, $${s.cost}. Conversations and report: ${work}`
);
process.exit(s.fail ? 1 : 0);
