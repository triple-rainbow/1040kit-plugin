/**
 * Lint for the 1040kit plugins: skill frontmatter, tool names, reference
 * links, install manifests. Run with `pnpm test:plugins`.
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

const SERVER_NAME = '1040kit';
const SERVER_ARGS = ['-y', '1040kit'];
const PLAYBOOK_ORDER = [
  'workspace_init',
  'docs_scan',
  'docs_extract',
  'interview_next',
  'calc_return',
  'deductions_find',
  'expenses_import',
  'review_checks',
  'explain_line',
  'forms_fill',
  'filing_prepare',
];
/** Site copy rule: the promise is about documents and the return, not "nothing". */
const BANNED_PHRASES = [/nothing ever leaves/i, /nothing leaves your/i];

export function parseFrontmatter(text: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return out;
}

/**
 * Backticked identifiers that look like MCP tool names: snake_case whose
 * first word is the first word of some tool (docs_, calc_, forms_, …).
 */
export function toolMentions(
  text: string,
  tools: readonly string[] = TOOL_PREFIX_SOURCE
): string[] {
  const prefixes = new Set(tools.map((t) => t.split('_')[0]));
  const found: string[] = [];
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const id = /^([a-z]+(?:_[a-z]+)+)\b/.exec(m[1])?.[1];
    if (id && prefixes.has(id.split('_')[0])) found.push(id);
  }
  return found;
}
const TOOL_PREFIX_SOURCE = [
  'workspace_',
  'docs_',
  'profile_',
  'interview_',
  'calc_',
  'explain_',
  'deductions_',
  'expenses_',
  'scenario_',
  'review_',
  'forms_',
  'filing_',
  'kb_',
];

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMarkdown(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Checks one skill folder (SKILL.md plus every .md under it). */
export function checkSkillDir(
  skillDir: string,
  tools: readonly string[]
): string[] {
  const problems: string[] = [];
  const skillFile = join(skillDir, 'SKILL.md');
  const label = basename(skillDir);
  if (!existsSync(skillFile)) return [`${label}: SKILL.md missing`];

  const fm = parseFrontmatter(readFileSync(skillFile, 'utf8'));
  if (!fm) problems.push(`${label}: SKILL.md has no frontmatter`);
  else {
    if (!fm.name) problems.push(`${label}: frontmatter has no name`);
    else if (fm.name !== label)
      problems.push(
        `${label}: name "${fm.name}" does not match its folder "${label}"`
      );
    if (!fm.description)
      problems.push(`${label}: frontmatter has no description`);
    else {
      if (!fm.description.startsWith('Use when'))
        problems.push(`${label}: description must start with "Use when"`);
      if (fm.description.length > 1024)
        problems.push(
          `${label}: description is ${fm.description.length} chars (max 1024)`
        );
    }
  }

  for (const file of walkMarkdown(skillDir)) {
    const rel = relative(skillDir, file);
    const text = readFileSync(file, 'utf8');
    for (const id of toolMentions(text, tools)) {
      if (!tools.includes(id))
        problems.push(`${label}/${rel}: unknown tool \`${id}\``);
    }
    const refs = [
      ...[...text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)].map(
        (m) => m[1]
      ),
      // Backticked file names (`references/x.md`, `errors.md`); skips templates like `<year>-x.md`.
      ...[...text.matchAll(/`([^`\s<>]+\.md)`/g)].map((m) => m[1]),
    ];
    for (const ref of refs) {
      if (/^[a-z]+:\/\//.test(ref)) continue;
      // Links inside references/ are written relative to the skill root or to the file.
      const candidates = [join(dirname(file), ref), join(skillDir, ref)];
      if (!candidates.some((c) => existsSync(c)))
        problems.push(`${label}/${rel}: broken link ${ref}`);
    }
    for (const re of BANNED_PHRASES) {
      if (re.test(text))
        problems.push(`${label}/${rel}: banned phrase ${re.source}`);
    }
  }
  return problems;
}

function readJson(path: string, problems: string[]): any {
  const shown = relative(process.cwd(), path);
  if (!existsSync(path)) {
    problems.push(`${shown}: missing`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    problems.push(`${shown}: invalid JSON (${(e as Error).message})`);
    return null;
  }
}

function sameArgs(args: unknown): boolean {
  return JSON.stringify(args) === JSON.stringify(SERVER_ARGS);
}

function checkPlaybookOrder(skillFile: string): string[] {
  const full = readFileSync(skillFile, 'utf8');
  const start = full.indexOf('## Playbook');
  if (start < 0) return ['do-my-taxes: no "## Playbook" section'];
  const end = full.indexOf('\n## ', start + 1);
  const text = full.slice(start, end < 0 ? undefined : end);
  const problems: string[] = [];
  let last = -1;
  for (const tool of PLAYBOOK_ORDER) {
    const at = text.indexOf('`' + tool);
    if (at < 0) problems.push(`do-my-taxes: playbook never names \`${tool}\``);
    else if (at < last)
      problems.push(`do-my-taxes: \`${tool}\` is out of playbook order`);
    else last = at;
  }
  return problems;
}

export function checkClaudeCodePlugin(
  repo: string,
  tools: readonly string[]
): string[] {
  const problems: string[] = [];
  const root = join(repo, 'plugins/claude-code');

  const manifest = readJson(join(root, '.claude-plugin/plugin.json'), problems);
  if (manifest && manifest.name !== SERVER_NAME)
    problems.push(`plugin.json name must be "${SERVER_NAME}"`);

  const mcp = readJson(join(root, '.mcp.json'), problems);
  if (mcp) {
    const names = Object.keys(mcp.mcpServers ?? {});
    if (names.length !== 1 || names[0] !== SERVER_NAME)
      problems.push(
        `.mcp.json must define exactly one server "${SERVER_NAME}"`
      );
    const s = mcp.mcpServers?.[SERVER_NAME];
    if (s && (s.command !== 'npx' || !sameArgs(s.args)))
      problems.push('.mcp.json server must run `npx -y 1040kit`');
  }

  const market = readJson(
    join(repo, '.claude-plugin/marketplace.json'),
    problems
  );
  if (market) {
    if (!market.name || !market.owner?.name)
      problems.push('marketplace.json needs name and owner.name');
    const entry = (market.plugins ?? []).find(
      (p: any) => p.name === SERVER_NAME
    );
    if (!entry)
      problems.push(`marketplace.json lists no "${SERVER_NAME}" plugin`);
    else if (entry.source !== './plugins/claude-code')
      problems.push('marketplace.json source must be "./plugins/claude-code"');
  }

  const skillsDir = join(root, 'skills');
  const skills = existsSync(skillsDir) ? readdirSync(skillsDir) : [];
  for (const required of ['do-my-taxes', 'explain-my-return']) {
    if (!skills.includes(required)) problems.push(`skill ${required} missing`);
  }
  for (const name of skills) {
    problems.push(...checkSkillDir(join(skillsDir, name), tools));
  }
  const dmt = join(skillsDir, 'do-my-taxes/SKILL.md');
  if (existsSync(dmt)) problems.push(...checkPlaybookOrder(dmt));
  return problems;
}

/** Minimal TOML read: the `command` and `args` of `[mcp_servers.<name>]`. */
export function parseCodexServer(
  toml: string,
  name: string
): { command?: string; args?: string[] } | null {
  const lines = toml.split('\n').map((l) => l.replace(/#.*$/, '').trim());
  const start = lines.findIndex(
    (l) => l === `[mcp_servers.${name}]` || l === `[mcp_servers."${name}"]`
  );
  if (start < 0) return null;
  const out: { command?: string; args?: string[] } = {};
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('[')) break;
    const kv = /^(\w+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    if (kv[1] === 'command') out.command = JSON.parse(kv[2]);
    if (kv[1] === 'args') out.args = JSON.parse(kv[2]);
  }
  return out;
}

/** Codex: each skill is a symlink to the Claude Code skill; config names the server. */
export function checkCodex(repo: string): string[] {
  const problems: string[] = [];
  const canonicalDir = join(repo, 'plugins/claude-code/skills');
  const codexDir = join(repo, 'plugins/codex/skills');
  const skills = existsSync(canonicalDir) ? readdirSync(canonicalDir) : [];
  for (const name of skills) {
    const link = join(codexDir, name);
    if (!existsSync(link)) {
      problems.push(`codex skill ${name} missing`);
      continue;
    }
    if (!lstatSync(link).isSymbolicLink())
      problems.push(`codex skill ${name} must be a symlink, not a copy`);
    else if (isAbsolute(readlinkSync(link)))
      problems.push(`codex skill ${name} symlink must be relative`);
    if (realpathSync(link) !== realpathSync(join(canonicalDir, name)))
      problems.push(
        `codex skill ${name} does not resolve to the canonical skill`
      );
  }

  const configPath = join(repo, 'plugins/codex/config.toml.example');
  if (!existsSync(configPath))
    problems.push('codex config.toml.example missing');
  else {
    const server = parseCodexServer(
      readFileSync(configPath, 'utf8'),
      SERVER_NAME
    );
    if (!server)
      problems.push(`codex config has no [mcp_servers.${SERVER_NAME}]`);
    else if (server.command !== 'npx' || !sameArgs(server.args))
      problems.push('codex config server must run `npx -y 1040kit`');
  }
  if (!existsSync(join(repo, 'plugins/codex/AGENTS.md.example')))
    problems.push('codex AGENTS.md.example missing');
  return problems;
}

/** Plain docs outside skills: tool names, links, site copy rules. */
function checkDoc(
  repo: string,
  rel: string,
  tools: readonly string[]
): string[] {
  const path = join(repo, rel);
  if (!existsSync(path)) return [`${rel}: missing`];
  const text = readFileSync(path, 'utf8');
  const problems: string[] = [];
  for (const id of toolMentions(text, tools))
    if (!tools.includes(id)) problems.push(`${rel}: unknown tool \`${id}\``);
  for (const re of BANNED_PHRASES)
    if (re.test(text)) problems.push(`${rel}: banned phrase ${re.source}`);
  return problems;
}

/** Every check, for the whole repo. Empty array = pass. */
export function checkRepo(repo: string, tools: readonly string[]): string[] {
  return [
    ...checkClaudeCodePlugin(repo, tools),
    ...checkCodex(repo),
    ...checkDoc(repo, 'plugins/codex/AGENTS.md.example', tools),
    ...checkDoc(repo, 'docs/install.md', tools),
  ];
}
