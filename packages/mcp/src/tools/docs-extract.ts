import { z } from 'zod';

import { extractDocs } from '../docs/extract.ts';
import { readDocTextWithOcr } from '../docs/ocr.ts';
import { defineTool } from '../envelope.ts';
import { requireAcknowledgment } from '../output/acknowledgment.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  docIds: z
    .array(z.string())
    .optional()
    .describe(
      'Documents to (re-)extract. Default: every document not extracted yet.'
    ),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  requireAcknowledgment(await store.read());
  const at = deps.now().toISOString();
  return store.write((data) =>
    extractDocs(store.workspace, data, input.docIds, at, readDocTextWithOcr)
  );
});

export const definition: ToolDefinition = {
  name: 'docs_extract',
  title: 'Read the numbers from documents',
  description:
    'Extract the boxes of each W-2 / 1099 / 1098-E / prior-year 1040 into the tax facts, locally. Amounts are in cents. SSNs and account numbers are discarded, never stored; the owner (taxpayer or spouse) is matched by the name on the document. Employer/payer/lender EINs come back only as tokens like {{EIN:w2_1}}. Review every `lowConfidence` field with the user before relying on it. A CORRECTED form replaces the original from the same payer. Safe to re-run.',
  inputSchema,
  handler,
};
