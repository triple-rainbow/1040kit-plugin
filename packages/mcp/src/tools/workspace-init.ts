import { z } from 'zod';

import { defineTool } from '../envelope.ts';
import { initWorkspace } from '../store/workspace.ts';
import { taxYearSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  year: taxYearSchema,
  path: z
    .string()
    .optional()
    .describe('Folder for this tax year. Default: ~/Taxes/<year>.'),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const r = await initWorkspace(input.year, input.path, deps.now());
  return {
    workspace: r.workspace,
    inbox: r.inbox,
    outputs: r.outputs,
    taxYear: r.meta.taxYear,
    created: r.created,
  };
});

export const definition: ToolDefinition = {
  name: 'workspace_init',
  title: 'Create a tax-year workspace',
  description:
    'Create (or reopen) the local, encrypted workspace for a tax year. Returns the inbox folder: ask the user to put their tax documents (W-2, 1099s, last year’s return, bank CSVs) there instead of pasting them into chat. Safe to call again.',
  inputSchema,
  handler,
};
