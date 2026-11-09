import type { ReturnResult } from '@1040kit/engine';

import { factsHash, reviewHash } from '../calc.ts';
import { SERVER_VERSION } from '../version.ts';
import { ToolError } from '../envelope.ts';
import type { StoreData } from '../store/types.ts';

/** The last calc_return, provided it was complete and the facts haven't changed since. */
export function readyResult(data: StoreData): ReturnResult {
  const last = data.lastCalc;
  if (!last) {
    throw new ToolError('RETURN_INCOMPLETE', 'Run calc_return first.');
  }
  // Computed by an older 1040kit: newer versions may ask more questions
  // (Schedule C items, for example) or compute differently.
  if (last.version !== SERVER_VERSION) {
    throw new ToolError(
      'RETURN_INCOMPLETE',
      '1040kit was updated since this return was last computed. Run calc_return again: it may have new questions, then return_review again with the user.'
    );
  }
  if (last.factsHash !== factsHash(data.facts)) {
    throw new ToolError(
      'RETURN_INCOMPLETE',
      'The facts changed since the last calc_return. Run calc_return again and review the result with the user.'
    );
  }
  if (!last.result.complete) {
    const why = [
      ...last.result.unsupported.map((u) => u.message),
      ...last.result.missing
        .filter((m) => m.blocking)
        .map((m) => `missing: ${m.question}`),
    ];
    throw new ToolError(
      'RETURN_INCOMPLETE',
      `The return is not complete: ${why.join('; ') || 'see calc_return'}.`
    );
  }
  return last.result;
}

/**
 * Identity fields the forms print and that only the user can give: names and
 * the home address. (A missing rental address goes on the handwrite list
 * instead.) SSNs are never asked: the user writes them.
 */
export function missingIdentity(data: StoreData): string[] {
  const id = data.identity;
  const out: string[] = [];
  const need = (path: string, value: string | undefined) => {
    if (!value?.trim()) out.push(`identity.${path}`);
  };
  need('taxpayer.firstName', id.taxpayer?.firstName);
  need('taxpayer.lastName', id.taxpayer?.lastName);
  if (data.facts.filingStatus === 'mfj') {
    need('spouse.firstName', id.spouse?.firstName);
    need('spouse.lastName', id.spouse?.lastName);
  }
  for (const d of data.facts.dependents) {
    need(`dependents[${d.id}].firstName`, id.dependents?.[d.id]?.firstName);
    need(`dependents[${d.id}].lastName`, id.dependents?.[d.id]?.lastName);
  }
  need('address.street', id.address?.street);
  need('address.city', id.address?.city);
  need('address.state', id.address?.state);
  need('address.zip', id.address?.zip);
  return out;
}

/**
 * Refuse (REVIEW_REQUIRED) unless the user confirmed a ready return_review of
 * exactly the current return (facts, documents, names and address).
 */
export function requireReview(data: StoreData): void {
  const r = data.review;
  if (r && r.hash === reviewHash(data) && r.confirmedAt) return;
  throw new ToolError(
    'REVIEW_REQUIRED',
    !r
      ? 'Run return_review, go through it with the user, and when they say it looks good call return_review again with confirmed: true.'
      : r.hash !== reviewHash(data)
        ? 'The return changed since the last return_review (facts, documents, or names and address). Run return_review again and go through it with the user.'
        : 'The user has not confirmed the review yet. Show it to them; when they say it looks good, call return_review again with confirmed: true.'
  );
}
