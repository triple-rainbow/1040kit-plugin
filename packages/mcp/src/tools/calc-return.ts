import { computeAndCache, drivers, printedLines } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = { workspace: workspaceSchema };

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  const result = await store.write((data) => computeAndCache(deps, data));
  return {
    taxYear: result.taxYear,
    filingStatus: result.filingStatus,
    complete: result.complete,
    summary: result.summary,
    unsupported: result.unsupported,
    missing: result.missing,
    forms: result.forms,
    lines: printedLines(result),
    drivers: drivers(result),
  };
});

export const definition: ToolDefinition = {
  name: 'calc_return',
  title: 'Compute the return',
  description:
    'Compute the federal return with the deterministic engine. Returns the summary (whole dollars; refundOrOwed > 0 is a refund), every printed line, the 3 biggest `drivers`, and anything unsupported or missing. Quote these numbers; never compute your own. Use explain_line for the why.',
  inputSchema,
  handler,
};
