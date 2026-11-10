/** Test helpers. Synthetic people only ("Pat Example"); no real identifiers. */
import {
  emptyFacts,
  type Form1099Div,
  type Form1099Int,
  type Form1099K,
  type Form1099Nec,
  type PersonId,
  type Screening,
  type TaxFacts,
  type TaxYear,
  type W2,
} from '../src/types.ts';

export function makeFacts(
  patch: Partial<TaxFacts> = {},
  year: TaxYear = 2025
): TaxFacts {
  const base = emptyFacts(year);
  return {
    ...base,
    filingStatus: 'single',
    taxpayer: {
      id: 'taxpayer',
      dateOfBirth: '1990-05-01',
      hasValidSsn: true,
      canBeClaimedAsDependent: false,
      blind: false,
    },
    ...patch,
  };
}

/** A W-2 whose FICA boxes are consistent with box 1 (no pre-tax deferrals). */
export function w2(
  id: string,
  wagesCents: number,
  withheldCents = 0,
  owner: PersonId = 'taxpayer',
  extra: Partial<W2> = {}
): W2 {
  return {
    id,
    owner,
    employerEinToken: `{{EIN:${id}}}`,
    wages: wagesCents,
    federalWithheld: withheldCents,
    ssWages: wagesCents,
    ssTax: Math.round(wagesCents * 0.062),
    medicareWages: wagesCents,
    medicareTax: Math.round(wagesCents * 0.0145),
    ...extra,
  };
}

export function int1099(
  id: string,
  interestCents: number,
  extra: Partial<Form1099Int> = {}
): Form1099Int {
  return { id, owner: 'taxpayer', interest: interestCents, ...extra };
}

export function div1099(
  id: string,
  ordinaryCents: number,
  qualifiedCents: number,
  extra: Partial<Form1099Div> = {}
): Form1099Div {
  return {
    id,
    owner: 'taxpayer',
    ordinaryDividends: ordinaryCents,
    qualifiedDividends: qualifiedCents,
    ...extra,
  };
}

export function nec(
  id: string,
  cents: number,
  owner: PersonId = 'taxpayer'
): Form1099Nec {
  return { id, owner, nonemployeeComp: cents };
}

export function k1099(
  id: string,
  cents: number,
  extra: Partial<Form1099K> = {}
): Form1099K {
  return { id, owner: 'taxpayer', grossAmount: cents, ...extra };
}

/** Every topic screening question answered "no". */
export const screeningNo: Screening = {
  hasDependents: false,
  hasRentalOrRoyaltyIncome: false,
  paidStudentLoanInterest: false,
  paidEstimatedTax: false,
};
