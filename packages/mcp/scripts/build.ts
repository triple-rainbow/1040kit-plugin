/**
 * Bundle the MCP server into dist/bin.js for npm. The private workspace
 * package @1040kit/engine (and the server's own source) is inlined; every
 * runtime `dependencies` entry stays external and is installed by npm, since
 * tesseract.js, its language data and the ext-apps browser bundle are read
 * from node_modules at run time.
 *
 *   node --import tsx scripts/build.ts
 */
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as {
  dependencies: Record<string, string>;
};

rmSync(`${root}dist`, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/bin.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Subpath imports (e.g. @modelcontextprotocol/sdk/server/stdio.js) too.
  external: Object.keys(pkg.dependencies).flatMap((d) => [d, `${d}/*`]),
  // src/bin.ts carries its own `#!/usr/bin/env node`; esbuild keeps it.
  legalComments: 'none',
  logLevel: 'warning',
});
