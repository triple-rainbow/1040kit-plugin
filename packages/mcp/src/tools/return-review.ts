/**
 * return_review: one holistic look at the whole return before forms_fill.
 * It recomputes, then gathers in one place what is still blocking (missing
 * facts, unsupported items, review errors, documents that never made it onto
 * the return, identity), what deserves a second look (warnings, deductions
 * left unclaimed, answers that replaced a document value), the numbers to
 * show the user, and the questions only the user can confirm.
 *
 * Two calls: the first records a ready review (bound to reviewHash: facts,
 * documents, names and address) and gives the agent a short prompt for the
 * user. When the user says the numbers look good, the agent calls again with
 * confirmed: true, which records the confirmation for that same review.
 * forms_fill and filing_prepare need a confirmed review of the current return.
 */
import { z } from 'zod';

import { computeAndCache, drivers, engineCall, reviewHash } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { requireAcknowledgment } from '../output/acknowledgment.ts';
import { missingIdentity } from '../output/ready.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  confirmed: z
    .boolean()
    .optional()
    .describe(
      'true only after the user saw this review and said the numbers look good.'
    ),
};

/** Where the full terms of use live (the confirmation links here). */
export const TERMS_URL = 'https://1040kit.com/terms-of-service';

/** What the agent asks the user, short, after walking them through the review. */
export const CONFIRM_PROMPT = `If everything looks right, reply “looks good” and I’ll fill in your forms. By confirming, you agree that your return is correct and complete to the best of your knowledge (terms: ${TERMS_URL}).`;

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

/** Deductions that are choices to consider, not things the user may have missed. */
const WHAT_IFS = new Set(['sep_ira']);
/** A deduction that is the other method of one already claimed. */
const ALTERNATIVE_OF: Record<string, string> = {
  home_office_actual: 'home_office',
};

const STATUS_LABEL: Record<string, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  hoh: 'Head of household',
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  requireAcknowledgment(await store.read(), store.workspace);
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
      // One line for every deduction still open, not one item each: the
      // user already went through them in the deductions checklist. Skip
      // what-ifs, alternatives of something claimed, and anything a check
      // above already raised.
      const opps = engineCall(() =>
        deps.engine.findDeductions(data.facts, result)
      );
      const claimed = new Set(
        opps.filter((o) => o.status === 'claimed').map((o) => o.id)
      );
      // A check named after the deduction ("check:head_of_household_may_apply")
      // already raised it.
      const raisedBy = (id: string) =>
        attention.some(
          (a) => a.code === `check:${id}` || a.code.startsWith(`check:${id}_`)
        );
      const unclaimed = opps.filter(
        (o) =>
          o.status === 'possible' &&
          !WHAT_IFS.has(o.id) &&
          !(ALTERNATIVE_OF[o.id] && claimed.has(ALTERNATIVE_OF[o.id]!)) &&
          !raisedBy(o.id)
      );
      if (unclaimed.length)
        attention.push({
          code: 'deductions:unclaimed',
          message: `Not claimed: ${unclaimed.map((o) => o.title).join('; ')}. Fine if the user said no to these in the deductions checklist; otherwise ask about them now.`,
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
    const hash = reviewHash(data);
    const now = deps.now().toISOString();
    let confirmed = false;
    let notConfirmedBecause: string | undefined;
    if (!ready) {
      delete data.review;
    } else if (input.confirmed === true) {
      // Only the review the user actually saw can be confirmed.
      if (data.review?.hash === hash) {
        data.review.confirmedAt = now;
        confirmed = true;
      } else {
        data.review = { at: now, hash };
        notConfirmedBecause =
          'The return changed since the user last saw the review (or they never saw one). Show this review and ask again.';
      }
    } else if (data.review?.hash !== hash) {
      data.review = { at: now, hash };
    } else {
      confirmed = !!data.review.confirmedAt;
    }

    const used = data.docs.filter((d) => d.status === 'extracted');
    const f = data.facts;
    const count = (n: number, one: string) =>
      n === 0 ? [] : [`${n} ${one}${n === 1 ? '' : 's'}`];
    const formsOnReturn = [
      ...count(f.w2s.length, 'W-2'),
      ...count(f.int1099s.length, '1099-INT'),
      ...count(f.div1099s.length, '1099-DIV'),
      ...count(f.nec1099s.length, '1099-NEC'),
      ...count(f.misc1099s.length, '1099-MISC'),
      ...count(f.k1099s.length, '1099-K'),
      ...count(f.e1098s.length, '1098-E'),
    ];
    const dependents =
      f.dependents.length === 0
        ? 'no dependents'
        : f.dependents.length === 1
          ? 'one dependent'
          : `${f.dependents.length} dependents`;
    const node = (id: string) => result.nodes[id]?.value ?? 0;
    return {
      ready,
      confirmed,
      ...(notConfirmedBecause ? { notConfirmedBecause } : {}),
      blockers,
      attention,
      return: {
        taxYear: result.taxYear,
        filingStatus: result.filingStatus
          ? STATUS_LABEL[result.filingStatus]
          : undefined,
        summary: result.summary,
        // Form 1040 line 34 (overpaid) and line 37 (amount you owe).
        outcome:
          node('overpaid') > 0
            ? { kind: 'refund', amount: node('overpaid') }
            : node('amountOwed') > 0
              ? { kind: 'amount_owed', amount: node('amountOwed') }
              : { kind: 'even', amount: 0 },
        forms: result.forms,
        drivers: drivers(result),
        documentsUsed: used.map((d) => d.file),
        dependents: data.facts.dependents.length,
        priorYear: data.priorYear,
      },
      confirmWithUser: [
        `The return includes ${formsOnReturn.join(', ') || 'no W-2s or 1099s'}${used.length ? ` (from ${used.map((d) => d.file).join(', ')})` : ''}. That is every tax form you received for ${result.taxYear}.`,
        `Your filing status is ${result.filingStatus ? STATUS_LABEL[result.filingStatus] : '(not set)'}, with ${dependents}.`,
        'Your name(s) and home address are spelled the way they should print.',
        'Nothing in your tax year is missing: other income, a move, a marriage, a new child, or money you paid toward this year’s tax.',
      ],
      ...(ready && !confirmed ? { confirmPrompt: CONFIRM_PROMPT } : {}),
      next: !ready
        ? 'Resolve every `blockers` item with the user, then call return_review again.'
        : confirmed
          ? 'The user confirmed these numbers. Call forms_fill.'
          : 'Walk the user through `return`, every `attention` item and every `confirmWithUser` line, then ask `confirmPrompt` word for word. Only when they say it looks good, call return_review again with confirmed: true. Then call forms_fill.',
    };
  });
});

export const definition: ToolDefinition = {
  name: 'return_review',
  title: 'Review the whole return',
  description:
    'The final, holistic review before forms_fill. Recomputes the return and returns `blockers` (missing facts, unsupported items, review errors, documents not on the return, missing names or address), `attention` (warnings, deductions left unclaimed, answers that replaced a document value), the numbers to show (`return`) and `confirmWithUser` questions. `ready` is true when nothing blocks. Then show the user the review and ask `confirmPrompt`; when they say it looks good, call again with confirmed: true. forms_fill and filing_prepare refuse (REVIEW_REQUIRED) until the user confirmed a ready review of the current return (facts, documents, names and address).',
  inputSchema,
  handler,
};
