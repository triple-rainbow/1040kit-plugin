import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { ATTACHMENT_SEQUENCE, FORM_ORDER } from '../calc.ts';
import { defineTool, ToolError } from '../envelope.ts';
import { entrySheetMarkdown } from '../output/entry-sheet.ts';
import { FORM_TITLES } from '../output/field-maps.ts';
import { assertNoVaultValues } from '../output/guard.ts';
import { handwriteText, identifierBoxes } from '../output/identifiers.ts';
import { mailingAddress, mailingMarkdown } from '../output/mail.ts';
import { requireAcknowledgment } from '../output/acknowledgment.ts';
import {
  missingIdentity,
  readyResult,
  requireReview,
} from '../output/ready.ts';
import { summaryMarkdown } from '../output/summary.ts';
import { openStore, outputsPath } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  path: z
    .enum(['mail', 'fillable_forms'])
    .describe(
      '"mail": print, sign and mail. "fillable_forms": e-file free with IRS Free File Fillable Forms.'
    ),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  const data = await store.read();
  requireAcknowledgment(data, store.workspace);
  const result = readyResult(data);
  const missing = missingIdentity(data);
  if (missing.length > 0)
    throw new ToolError(
      'IDENTITY_REQUIRED',
      `The filing package prints these, and only the user can give them: ${missing.join(', ')}. Ask for them and record them with profile_set (never SSNs), then run return_review again.`
    );
  requireReview(data);
  const dir = outputsPath(store.workspace);
  const y = result.taxYear;
  const files: { path: string; text: string }[] = [];

  if (input.path === 'mail') {
    const state = data.identity.address?.state ?? data.facts.stateOfResidence;
    if (!state) {
      throw new ToolError(
        'STATE_REQUIRED',
        'Ask which state the user lives in and record it (identity.address.state) with profile_set.'
      );
    }
    files.push({
      path: join(dir, `${y}-mailing-instructions.md`),
      text: mailingMarkdown({
        taxYear: y,
        state,
        refundOrOwed: result.summary.refundOrOwed,
        mfj: data.facts.filingStatus === 'mfj',
        w2Count: data.facts.w2s.length,
        now: deps.now(),
        attachments: FORM_ORDER.filter(
          (f) => f !== 'f1040' && result.forms.includes(f)
        ).map((f) => ({
          title: FORM_TITLES[f],
          sequence: ATTACHMENT_SEQUENCE[f],
        })),
        identifiers: identifierBoxes(data, result).map(handwriteText),
      }),
    });
  } else {
    files.push({
      path: join(dir, `${y}-free-file-fillable-forms.md`),
      text: entrySheetMarkdown(data, result),
    });
  }
  files.push({
    path: join(dir, `${y}-summary.md`),
    text: summaryMarkdown(data, result, deps.engine),
  });

  for (const f of files) assertNoVaultValues(f.text, data.vault, f.path);
  for (const f of files) await writeFile(f.path, f.text);

  const state = data.identity.address?.state ?? data.facts.stateOfResidence;
  return {
    path: input.path,
    files: files.map((f) => f.path),
    ...(input.path === 'mail' && state && !mailingAddress(state)
      ? {
          warning: `No mailing address on file for "${state}"; the instructions point to the IRS page.`,
        }
      : {}),
  };
});

export const definition: ToolDefinition = {
  name: 'filing_prepare',
  title: 'Prepare the filing package',
  description:
    'Write the filing package to the outputs folder: "mail" → mailing instructions (where to sign, what to attach, the IRS address for the user’s state, payment options, deadline); "fillable_forms" → a line-by-line entry sheet for IRS Free File Fillable Forms. Also writes a plain-English summary. 1040kit never stores SSNs or bank account numbers: the mailing instructions list every box to write them in, and the entry sheet marks each field "type this yourself". Requires a complete, current calc_return, the names and home address, the start agreement (ACK_REQUIRED) and a review the user confirmed for the current return (REVIEW_REQUIRED).',
  inputSchema,
  handler,
};
