import { z } from 'zod';

import { defineTool } from '../envelope.ts';
import { describeSource, getPath, parsePath } from '../store/profile.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  paths: z
    .array(z.string())
    .optional()
    .describe(
      'Only these fact paths (e.g. "taxpayer.dateOfBirth", "w2s[w2_1].wages").'
    ),
};

export const handler = defineTool(inputSchema, async (input) => {
  const store = await openStore(input.workspace);
  const data = await store.read();
  const provenance = Object.fromEntries(
    Object.entries(data.provenance)
      .filter(
        ([k]) =>
          !input.paths ||
          input.paths.some(
            (p) => k === p || k.startsWith(p + '.') || k.startsWith(p + '[')
          )
      )
      .map(([k, e]) => [k, { ...e, sourceText: describeSource(data, e) }])
  );
  const out: Record<string, unknown> = {
    facts: data.facts,
    identity: data.identity,
    payerNames: data.labels,
    provenance,
  };
  if (input.paths) {
    out.values = Object.fromEntries(
      input.paths.map((p) => {
        const segs = parsePath(p);
        if (!segs) return [p, null];
        const root = segs[0]!.key === 'identity' ? data : data.facts;
        return [p, getPath(root, segs) ?? null];
      })
    );
  }
  return out;
});

export const definition: ToolDefinition = {
  name: 'profile_get',
  title: 'Read the tax facts',
  description:
    'Read the structured tax facts (amounts in cents), names/address, and where each fact came from (a document, the user, or inferred). EINs appear only as tokens; SSNs and bank account numbers are never stored.',
  inputSchema,
  handler,
};
