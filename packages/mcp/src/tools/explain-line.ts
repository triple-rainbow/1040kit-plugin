import type { Explanation } from '@1040kit/engine';
import { z } from 'zod';

import { currentResult, engineCall } from '../calc.ts';
import { defineTool, ToolError } from '../envelope.ts';
import { describeSource, provenanceFor } from '../store/profile.ts';
import type { StoreData } from '../store/types.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  ref: z
    .string()
    .min(1)
    .describe(
      'A line id from calc_return (e.g. "agi") or "<form>:<line>" (e.g. "f1040:16").'
    ),
  depth: z.number().int().min(0).max(6).optional(),
};

function annotate(data: StoreData, e: Explanation): unknown {
  return {
    node: {
      ...e.node,
      trace: {
        ...e.node.trace,
        inputs: e.node.trace.inputs.map((i) => {
          if (i.kind !== 'fact') return i;
          const p = provenanceFor(data, i.ref);
          return {
            ...i,
            provenance: {
              source: p?.source ?? null,
              ...(p?.source === 'doc'
                ? {
                    file: data.docs.find((d) => d.docId === p.docId)?.file,
                    field: p.field,
                  }
                : {}),
              text: describeSource(data, p),
            },
          };
        }),
      },
    },
    children: e.children.map((c) => annotate(data, c)),
  };
}

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  let explanation: unknown;
  await store.write((data) => {
    const { result } = currentResult(deps, data);
    const e = engineCall(() =>
      deps.engine.explainLine(result, input.ref, input.depth)
    );
    if (!e)
      throw new ToolError(
        'UNKNOWN_LINE',
        `No line "${input.ref}" on this return. Use an id or form:line from calc_return.`
      );
    explanation = annotate(data, e);
  });
  return { explanation };
});

export const definition: ToolDefinition = {
  name: 'explain_line',
  title: 'Explain a line',
  description:
    'Why a line has its value: the formula, its inputs (with the document or answer each fact came from) and IRS citations. Quote it; cite the citations.',
  inputSchema,
  handler,
};
