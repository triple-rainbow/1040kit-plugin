/**
 * Builds a browser test host for the MCP Apps widgets into .widget-harness/
 * (gitignored): index.html plays the host side of the MCP Apps protocol,
 * widget.html is the real interview widget, result.json a real interview_next
 * result from a throwaway synthetic workspace. Serve the folder and open it:
 *
 *   node --import tsx scripts/widget-harness/build.ts
 *   python3 -m http.server 4310 -d .widget-harness
 */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = new URL('../../.widget-harness/', import.meta.url).pathname;
const scratch = await mkdtemp(join(tmpdir(), '1040kit-harness-'));
process.env.KIT1040_CONFIG_DIR = join(scratch, 'config');

const { defaultDeps } = await import('../../src/deps.ts');
const { toCallToolResult } = await import('../../src/envelope.ts');
const { handler: init } = await import('../../src/tools/workspace-init.ts');
const { handler: setFacts } = await import('../../src/tools/profile-set.ts');
const { handler: next } = await import('../../src/tools/interview-next.ts');
const { interviewWidgetHtml } =
  await import('../../src/ui/interview-widget.ts');

const deps = defaultDeps();
const ws = join(scratch, '2025');
const r = await init({ year: 2025, path: ws }, deps);
if (!r.ok) throw new Error(JSON.stringify(r));
await setFacts(
  {
    workspace: ws,
    set: [
      {
        path: 'dependents[dependent_1].dateOfBirth',
        value: '2019-06-01',
        source: 'user',
      },
    ],
  },
  deps
);
const result = toCallToolResult(await next({ workspace: ws, limit: 5 }, deps));

await mkdir(out, { recursive: true });
await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
await writeFile(join(out, 'widget.html'), interviewWidgetHtml());
await copyFile(
  new URL('./index.html', import.meta.url).pathname,
  join(out, 'index.html')
);
await rm(scratch, { recursive: true, force: true });
console.log(`Built ${out}`);
