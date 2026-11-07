/** Small helpers over TaxFacts shared by forms, scope and rules. */
import type {
  FilingStatus,
  Person,
  PersonId,
  TaxFacts,
  TaxYear,
} from './types.ts';

/** Filing status used for computation. Missing status computes as single; requiredFacts blocks completion. */
export function statusOf(facts: TaxFacts): FilingStatus {
  return facts.filingStatus ?? 'single';
}

/** People on the return: the taxpayer, plus the spouse when filing jointly. */
export function peopleOnReturn(facts: TaxFacts): Person[] {
  const out: Person[] = [facts.taxpayer];
  if (statusOf(facts) === 'mfj' && facts.spouse) out.push(facts.spouse);
  return out;
}

export function ownersOnReturn(facts: TaxFacts): PersonId[] {
  return statusOf(facts) === 'mfj' ? ['taxpayer', 'spouse'] : ['taxpayer'];
}

/** Items whose owner is on this return (a spouse's W-2 doesn't count on a single return). */
export function ownedOnReturn<T extends { owner: PersonId }>(
  facts: TaxFacts,
  items: T[]
): T[] {
  const owners = ownersOnReturn(facts);
  return items.filter((i) => owners.includes(i.owner));
}

/**
 * Age on December 31 of the tax year (calendar birthdays, no "day before
 * birthday" rule — Rev. Rul. 2003-72 for the child tax credit age test).
 * The 65+ tests use `bornBefore` with the form's cutoff date instead.
 */
export function ageAtYearEnd(
  dob: string | undefined,
  year: TaxYear
): number | undefined {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return undefined;
  return year - Number(dob.slice(0, 4));
}

/** Born before `cutoff` (YYYY-MM-DD). Undefined DOB => false. */
export function bornBefore(dob: string | undefined, cutoff: string): boolean {
  return !!dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) && dob < cutoff;
}
