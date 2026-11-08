import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { factsHash } from '../calc.ts';
import { defineTool, ToolError } from '../envelope.ts';
import { requireAcknowledgment } from '../output/acknowledgment.ts';
import { hasForms } from '../output/field-maps.ts';
import { fillReturn } from '../output/fill.ts';
import { assertNoVaultValues } from '../output/guard.ts';
import { missingIdentity, readyResult } from '../output/ready.ts';
import { summaryMarkdown } from '../output/summary.ts';
import { openStore, outputsPath } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = { workspace: workspaceSchema };

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  const data = await store.read();
  const ack = requireAcknowledgment(data);
  const result = readyResult(data);
  if (!hasForms(result.taxYear)) {
    throw new ToolError(
      'FORMS_NOT_AVAILABLE',
      `The official ${result.taxYear} IRS PDFs are not bundled in this version yet.`
    );
  }
  const missing = missingIdentity(data);
  if (missing.length > 0) {
    throw new ToolError(
      'IDENTITY_REQUIRED',
      `The forms print these, and only the user can give them: ${missing.join(', ')}. Ask for them and record them with profile_set (never SSNs), then call forms_fill again.`
    );
  }
  if (data.review?.factsHash !== factsHash(data.facts)) {
    throw new ToolError(
      'REVIEW_REQUIRED',
      data.review
        ? 'The facts changed since the last return_review. Run return_review again and go through it with the user.'
        : 'Run return_review first and go through it with the user.'
    );
  }

  const filled = await fillReturn(data, result);
  const dir = outputsPath(store.workspace);
  const pdfPath = join(dir, `${result.taxYear}-federal-return.pdf`);
  await writeFile(pdfPath, filled.merged, { mode: 0o600 });
  const summaryPath = join(dir, `${result.taxYear}-summary.md`);
  const summary = summaryMarkdown(data, result, deps.engine);
  assertNoVaultValues(summary, data.vault, summaryPath);
  await writeFile(summaryPath, summary);
  return {
    files: [pdfPath, summaryPath],
    forms: filled.forms.map((f) => f.formId),
    handwrite: filled.handwrite,
    unmappedLines: filled.unmapped,
    acknowledgedAt: ack.at,
    reviewedAt: data.review.at,
    note: 'Every SSN box and the direct-deposit boxes are blank: the user writes them in by hand (see handwrite). The PDF holds no SSNs and is not encrypted.',
  };
});

export const definition: ToolDefinition = {
  name: 'forms_fill',
  title: 'Fill the IRS forms',
  description:
    'After return_review is ready and the user confirmed it: fill the official IRS PDFs (1040 and every schedule needed) into outputs/<year>-federal-return.pdf, plus a plain-English summary. Refuses (RETURN_INCOMPLETE) unless the last calc_return was complete and nothing changed since, (IDENTITY_REQUIRED) while names or the home address are missing, (REVIEW_REQUIRED) until a ready return_review of the current facts, and (ACK_REQUIRED) if the start agreement from workspace_init was never given. SSN boxes are left blank: walk the user through every item in `handwrite`.',
  inputSchema,
  handler,
};
