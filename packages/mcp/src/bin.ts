#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.ts';

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  // stdout is the MCP channel; diagnostics go to stderr only.
  process.stderr.write(
    `1040kit: ${e instanceof Error ? e.message : String(e)}\n`
  );
  process.exit(1);
});
