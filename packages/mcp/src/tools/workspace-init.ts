import { z } from 'zod';

import { defineTool } from '../envelope.ts';
import {
  ACKNOWLEDGMENT_TEXT,
  currentAcknowledgment,
} from '../output/acknowledgment.ts';
import { initWorkspace, openStore } from '../store/workspace.ts';
import { taxYearSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  year: taxYearSchema,
  path: z
    .string()
    .optional()
    .describe('Folder for this tax year. Default: ~/Taxes/<year>.'),
  acknowledged: z
    .boolean()
    .optional()
    .describe(
      'true only after the user read the `acknowledgment.text` from the first call and agreed to it.'
    ),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const r = await initWorkspace(input.year, input.path, deps.now());
  const store = await openStore(r.workspace);
  let data = await store.read();
  if (input.acknowledged === true && !currentAcknowledgment(data)) {
    data = await store.write((d) => {
      d.acknowledgment = {
        text: ACKNOWLEDGMENT_TEXT,
        at: deps.now().toISOString(),
      };
      return d;
    });
  }
  const ack = currentAcknowledgment(data);
  return {
    workspace: r.workspace,
    inbox: r.inbox,
    outputs: r.outputs,
    taxYear: r.meta.taxYear,
    created: r.created,
    acknowledgment: ack
      ? { agreed: true, at: ack.at }
      : {
          agreed: false,
          text: ACKNOWLEDGMENT_TEXT,
          ask: 'Show this to the user word for word, once, before anything else, and ask whether they agree. If they do, call workspace_init again with the same year and path and acknowledged: true. Reading documents, the interview, the review, the forms and the filing package refuse (ACK_REQUIRED) until then.',
        },
  };
});

export const definition: ToolDefinition = {
  name: 'workspace_init',
  title: 'Create a tax-year workspace',
  description:
    'Create (or reopen) the local, encrypted workspace for a tax year. Returns the inbox folder: ask the user to put their tax documents (W-2, 1099s, last year’s return, bank CSVs) there instead of pasting them into chat. The first time, it also returns a short `acknowledgment` to show the user word for word; when they agree, call again with acknowledged: true. Safe to call again.',
  inputSchema,
  handler,
};
