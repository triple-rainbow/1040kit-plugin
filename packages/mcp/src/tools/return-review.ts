/**
 * return_review: one holistic look at the whole return before forms_fill.
 * It recomputes, then gathers in one place what is still blocking (missing
 * facts, unsupported items, review errors, documents that never made it onto
 * the return, identity), what deserves a second look (warnings, deductions
 * left unclaimed, answers that replaced a document value), the numbers to
 * show the user, and the questions only the user can confirm. When nothing
 * blocks, it records the review for these facts; forms_fill needs that.
 */
import { computeAndCache, drivers, engineCall, factsHash } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { requireAcknowledgment } from '../output/acknowledgment.ts';
import { missingIdentity } from '../output/ready.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = { workspace: workspaceSchema };

interface Item {
  code: string;
  message: string;
}

const DOC_NOT_ON_RETURN: Record<string, string> = {
  new: 'has not been read yet (run docs_extract)',
  needs_ocr: 'could not be read (a scan that needs a clearer copy)',
  encrypted_pdf: 'is password-protected and could not be read',
  unsupported_form: 'is a form 1040kit does not handle yet',
};

const STATUS_LABEL: Record<string, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  hoh: 'Head of household',
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  requireAcknowledgment(await store.read());
  return store.write((data) => {
    const result = computeAndCache(deps, data);
    const blockers: Item[] = [];
    const attention: Item[] = [];

    for (const u of result.unsupported)
      blockers.push({ code: `unsupported:${u.code}`, message: u.message });
    for (const m of result.missing) {
      (m.blocking ? blockers : attention).push({
        code: `missing:${m.path}`,
        message: m.question,
      });
    }
    for (const doc of data.docs) {
      const why = DOC_NOT_ON_RETURN[doc.status];
      if (why && !doc.supersededBy)
        blockers.push({
          code: `document:${doc.docId}`,
          message: `${doc.file} ${why}.`,
        });
    }
    for (const path of missingIdentity(data))
      blockers.push({
        code: `identity:${path}`,
        message: `The forms need ${path.replace(/^identity\./, '')}.`,
      });

    if (result.complete) {
      const findings = engineCall(() =>
        deps.engine.reviewChecks(data.facts, result, data.priorYear)
      );
      for (const f of findings) {
        (f.severity === 'error' ? blockers : attention).push({
          code: `check:${f.code}`,
          message: f.message,
        });
      }
      const unclaimed = engineCall(() =>
        deps.engine.findDeductions(data.facts, result)
      ).filter((o) => o.status === 'possible');
      for (const o of unclaimed)
        attention.push({
          code: `deduction:${o.id}`,
          message: `${o.title} is not claimed. Confirm the user doesn't qualify: ${o.question}`,
        });
    }
    for (const [path, p] of Object.entries(data.provenance)) {
      if (p.overrides === 'doc')
        attention.push({
          code: `override:${path}`,
          message: `${path} was changed from what the document says${p.note ? ` (${p.note})` : ''}. Make sure the user meant it.`,
        });
    }

    const ready = blockers.length === 0;
    if (ready)
      data.review = {
        at: deps.now().toISOString(),
        factsHash: factsHash(data.facts),
      };
    else delete data.review;

    const used = data.docs.filter((d) => d.status === 'extracted');
    return {
      ready,
      blockers,
      attention,
      return: {
        taxYear: result.taxYear,
        filingStatus: result.filingStatus
          ? STATUS_LABEL[result.filingStatus]
          : undefined,
        summary: result.summary,
        forms: result.forms,
        drivers: drivers(result),
        documentsUsed: used.map((d) => d.file),
        dependents: data.facts.dependents.length,
        priorYear: data.priorYear,
      },
      confirmWithUser: [
        `Every W-2, 1099 and 1098 you received for ${result.taxYear} is one of these: ${used.map((d) => d.file).join(', ') || '(none)'}.`,
        `Your filing status is ${result.filingStatus ? STATUS_LABEL[result.filingStatus] : '(not set)'} and you claim ${data.facts.dependents.length} dependent(s).`,
        'Your name(s) and home address are spelled the way they should print.',
        'Nothing in your tax year is missing: other income, a move, a marriage, a new child, or money you paid toward this year’s tax.',
      ],
      next: ready
        ? 'Walk the user through `return`, every `attention` item and every `confirmWithUser` line. When they confirm, call forms_fill.'
        : 'Resolve every `blockers` item with the user, then call return_review again.',
    };
  });
});

export const definition: ToolDefinition = {
  name: 'return_review',
  title: 'Review the whole return',
  description:
    'The final, holistic review before forms_fill. Recomputes the return and returns `blockers` (missing facts, unsupported items, review errors, documents not on the return, missing names or address), `attention` (warnings, deductions left unclaimed, answers that replaced a document value), the numbers to show (`return`) and `confirmWithUser` questions. `ready` is true when nothing blocks; forms_fill refuses (REVIEW_REQUIRED) until a ready review of the current facts.',
  inputSchema,
  handler,
};
