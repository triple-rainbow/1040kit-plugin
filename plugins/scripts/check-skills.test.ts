import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

import { TOOL_NAMES } from '../../packages/mcp/src/tool-names.ts';
import {
  checkCodex,
  checkRepo,
  checkSkillDir,
  parseCodexServer,
  parseFrontmatter,
  toolMentions,
} from './check-skills.ts';

const REPO = resolve(import.meta.dirname, '../..');

describe('checker logic', () => {
  test('parses frontmatter', () => {
    const fm = parseFrontmatter(
      '---\nname: x\ndescription: Use when y\n---\n# body'
    );
    assert.deepEqual(fm, { name: 'x', description: 'Use when y' });
    assert.equal(parseFrontmatter('# no frontmatter'), null);
  });

  test('finds tool-like identifiers in backticks', () => {
    const found = toolMentions(
      'Call `docs_scan`, then `calc_return({ workspace })`, not `flag_only` or `STORE_UNREADABLE`.'
    );
    assert.deepEqual(found, ['docs_scan', 'calc_return']);
  });

  test('flags an unknown tool name, a bad description and a broken reference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-'));
    const skill = join(dir, 'bad-skill');
    mkdirSync(skill);
    writeFileSync(
      join(skill, 'SKILL.md'),
      '---\nname: bad-skill\ndescription: Does things\n---\nRun `docs_scann`. See [x](references/missing.md).\n'
    );
    const problems = checkSkillDir(skill, TOOL_NAMES);
    assert.ok(
      problems.some((p) => p.includes('Use when')),
      problems.join('\n')
    );
    assert.ok(
      problems.some((p) => p.includes('docs_scann')),
      problems.join('\n')
    );
    assert.ok(
      problems.some((p) => p.includes('references/missing.md')),
      problems.join('\n')
    );
  });

  test('flags a name that does not match its folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-'));
    const skill = join(dir, 'folder-name');
    mkdirSync(skill);
    writeFileSync(
      join(skill, 'SKILL.md'),
      '---\nname: other-name\ndescription: Use when testing\n---\nok\n'
    );
    const problems = checkSkillDir(skill, TOOL_NAMES);
    assert.ok(
      problems.some((p) => p.includes('folder')),
      problems.join('\n')
    );
  });
});

describe('codex', () => {
  test('codex skill resolves to canonical', () => {
    assert.deepEqual(checkCodex(REPO), []);
  });

  test('reads the server from a codex config', () => {
    const toml =
      '# comment\n[mcp_servers.1040kit]\ncommand = "npx"\nargs = ["-y", "1040kit"]\n';
    assert.deepEqual(parseCodexServer(toml, '1040kit'), {
      command: 'npx',
      args: ['-y', '1040kit'],
    });
    assert.equal(parseCodexServer(toml, 'other'), null);
  });
});

describe('repo plugins', () => {
  test('all plugin, skill and install files pass the checks', () => {
    const problems = checkRepo(REPO, TOOL_NAMES);
    assert.deepEqual(problems, []);
  });
});
