import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { TOOL_NAMES } from '../src/tool-names.ts';
import { freshEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
let client: Client;

before(async () => {
  env = await freshEnv();
  const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', bin],
    env: {
      PATH: process.env.PATH ?? '',
      KIT1040_HOME: env.home,
      KIT1040_CONFIG_DIR: env.config,
    },
    stderr: 'pipe',
  });
  client = new Client({ name: 'smoke', version: '0.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  await env.cleanup();
});

test('smoke: stdio client lists exactly TOOL_NAMES', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOL_NAMES].sort());
  for (const t of tools)
    assert.ok(t.description, `${t.name} has a description`);
});

test('smoke: workspace_init over stdio', async () => {
  const res = await client.callTool({
    name: 'workspace_init',
    arguments: { year: 2025 },
  });
  const sc = res.structuredContent as { ok: boolean; created: boolean };
  assert.equal(sc.ok, true);
  assert.equal(sc.created, true);
  const text = (res.content as { type: string; text: string }[])[0]!.text;
  assert.deepEqual(JSON.parse(text), sc);
});
