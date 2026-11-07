/**
 * Dependent classification for Schedule 8812 (i1040gi "Who Qualifies as Your
 * Dependent"; i1040s8 "Credits for Qualifying Children", "Credit for Other
 * Dependents"). Unknown answers are treated favorably here; requiredFacts asks
 * for them as blocking questions, so the return can't be complete until answered.
 */
import { ageAtYearEnd, statusOf } from './facts.ts';
import type { YearParams } from './params/index.ts';
import type { Dependent, TaxFacts } from './types.ts';

export const CHILD_RELATIONSHIPS: ReadonlySet<string> = new Set([
  'child',
  'stepchild',
  'foster_child',
  'sibling',
  'half_sibling',
  'step_sibling',
  'grandchild',
  'niece_nephew',
]);

export type DependentCredit = 'ctc' | 'odc' | 'none';

export interface DependentClass {
  credit: DependentCredit;
  reason: string;
}

/** Filer SSN rule for the CTC/ACTC from 2025: the taxpayer, or either spouse on a joint return. */
export function filerHasSsnForCtc(facts: TaxFacts): boolean {
  if (facts.taxpayer.hasValidSsn !== false) return true;
  return statusOf(facts) === 'mfj' && facts.spouse?.hasValidSsn !== false;
}

export function classifyDependent(
  d: Dependent,
  facts: TaxFacts,
  params: YearParams
): DependentClass {
  const age = ageAtYearEnd(d.dateOfBirth, facts.taxYear);
  const livedWith = (d.monthsLivedWithTaxpayer ?? 12) > 6;
  const childRel =
    d.relationship === undefined || CHILD_RELATIONSHIPS.has(d.relationship);
  const ageTest =
    age === undefined ||
    age < 19 ||
    (age < 24 && d.fullTimeStudent !== false) ||
    d.permanentlyDisabled === true;
  const qualifyingChild =
    childRel && livedWith && ageTest && d.providedOverHalfOwnSupport !== true;

  if (qualifyingChild) {
    const under17 = age === undefined || age < params.ctc.ageLimit;
    if (!under17)
      return {
        credit: 'odc',
        reason: `age ${params.ctc.ageLimit} or older at year end`,
      };
    if (d.hasValidSsn === false)
      return { credit: 'odc', reason: 'no SSN valid for employment' };
    if (!filerHasSsnForCtc(facts))
      return { credit: 'odc', reason: 'filer has no valid SSN' };
    return {
      credit: 'ctc',
      reason: 'qualifying child under 17 with a valid SSN',
    };
  }

  // Qualifying relative: gross income under the limit, and (approximately) support
  // from the taxpayer. Relatives other than parents must live with the taxpayer all year
  // unless closely related; v1 accepts the listed relationships.
  const income = (d.grossIncome ?? 0) / 100;
  if (
    income < params.qualifyingRelativeGrossIncome &&
    d.providedOverHalfOwnSupport !== true
  ) {
    return { credit: 'odc', reason: 'qualifying relative' };
  }
  return {
    credit: 'none',
    reason: 'does not meet the qualifying child or qualifying relative tests',
  };
}

/**
 * Head of household qualifying person (Pub 501, "Head of Household",
 * Table 4): a qualifying child or a dependent relative who lived with you more
 * than half the year, or a dependent parent (who need not live with you).
 * An unrelated member of the household never qualifies.
 */
export function hohQualifyingPerson(
  d: Dependent,
  facts: TaxFacts,
  params: YearParams
): boolean {
  if (classifyDependent(d, facts, params).credit === 'none') return false;
  if (d.relationship === 'parent') return true;
  if (d.relationship === 'other' || d.relationship === undefined) return false;
  return (d.monthsLivedWithTaxpayer ?? 0) > 6;
}
