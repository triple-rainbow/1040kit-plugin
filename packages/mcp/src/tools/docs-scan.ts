import { publicDoc, scanInbox } from '../docs/scan.ts';
import { defineTool } from '../envelope.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = { workspace: workspaceSchema };

export const handler = defineTool(inputSchema, async (input) => {
  const store = await openStore(input.workspace);
  const docs = await store.write((data) => scanInbox(store.workspace, data));
  return { documents: docs.map(publicDoc) };
});

export const definition: ToolDefinition = {
  name: 'docs_scan',
  title: 'Inventory the inbox',
  description:
    'List and classify every file in the workspace inbox (W-2, 1099-INT/DIV/NEC/MISC/K, prior-year 1040, bank CSV). Flags duplicates, scans that need OCR, password-protected PDFs, and forms 1040kit does not support yet (with the planned version). Runs locally; nothing is uploaded.',
  inputSchema,
  handler,
};
