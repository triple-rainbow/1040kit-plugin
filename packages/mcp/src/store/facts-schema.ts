/**
 * zod mirror of the engine's `TaxFacts` (packages/engine/src/types.ts), strict
 * so an unknown path is rejected instead of silently stored. The type-level
 * check at the bottom fails to compile if the two drift apart.
 */
import type { TaxFacts } from '@1040kit/engine';
import { z } from 'zod';

import type { Identity } from './types.ts';

/** `answer` tells interview widgets which control to draw (src/ui/answers.ts). */
const cents = z
  .number()
  .int('amounts are integer cents')
  .meta({ answer: 'amount' });
const nonNegCents = cents
  .min(0, 'amounts can’t be negative')
  .meta({ answer: 'amount' });
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
  .meta({ answer: 'date' });
const personId = z.enum(['taxpayer', 'spouse']);
/** EINs only: 1040kit never stores SSNs (docs/coverage.md, "Identifiers"). */
const tinToken = z
  .string()
  .regex(
    /^\{\{EIN:[a-z0-9_]+\}\}$/,
    'must be a {{EIN:…}} token, never a real EIN'
  );
const byPerson = z.strictObject({
  taxpayer: nonNegCents.optional(),
  spouse: nonNegCents.optional(),
});

const person = z.strictObject({
  id: personId,
  dateOfBirth: date.optional(),
  blind: z.boolean().optional(),
  hasValidSsn: z.boolean().optional(),
  canBeClaimedAsDependent: z.boolean().optional(),
  livedInUsOverHalfYear: z.boolean().optional(),
  qualifyingChildOfAnother: z.boolean().optional(),
});

const dependent = z.strictObject({
  id: z
    .string()
    .regex(/^dependent_\d+$/, 'dependent ids look like dependent_1'),
  dateOfBirth: date.optional(),
  relationship: z
    .enum([
      'child',
      'stepchild',
      'foster_child',
      'sibling',
      'half_sibling',
      'step_sibling',
      'grandchild',
      'niece_nephew',
      'parent',
      'other',
    ])
    .optional(),
  monthsLivedWithTaxpayer: z.number().int().min(0).max(12).optional(),
  hasValidSsn: z.boolean().optional(),
  fullTimeStudent: z.boolean().optional(),
  permanentlyDisabled: z.boolean().optional(),
  providedOverHalfOwnSupport: z.boolean().optional(),
  grossIncome: nonNegCents.optional(),
});

const w2 = z.strictObject({
  id: z.string(),
  owner: personId,
  employerEinToken: tinToken.optional(),
  wages: nonNegCents,
  federalWithheld: nonNegCents,
  ssWages: nonNegCents,
  ssTax: nonNegCents,
  medicareWages: nonNegCents,
  medicareTax: nonNegCents,
  ssTips: nonNegCents.optional(),
  allocatedTips: nonNegCents.optional(),
  box12: z
    .array(z.strictObject({ code: z.string().max(2), amount: nonNegCents }))
    .optional(),
  statutoryEmployee: z.boolean().optional(),
  retirementPlan: z.boolean().optional(),
  corrected: z.boolean().optional(),
});

const int1099 = z.strictObject({
  id: z.string(),
  owner: personId,
  payerToken: tinToken.optional(),
  interest: nonNegCents,
  earlyWithdrawalPenalty: nonNegCents.optional(),
  usSavingsBondInterest: nonNegCents.optional(),
  federalWithheld: nonNegCents.optional(),
  taxExemptInterest: nonNegCents.optional(),
});

const div1099 = z.strictObject({
  id: z.string(),
  owner: personId,
  payerToken: tinToken.optional(),
  ordinaryDividends: nonNegCents,
  qualifiedDividends: nonNegCents,
  capitalGainDistributions: nonNegCents.optional(),
  federalWithheld: nonNegCents.optional(),
  section199aDividends: nonNegCents.optional(),
  exemptInterestDividends: nonNegCents.optional(),
});

const nec1099 = z.strictObject({
  id: z.string(),
  owner: personId,
  payerToken: tinToken.optional(),
  nonemployeeComp: nonNegCents,
  federalWithheld: nonNegCents.optional(),
});

const misc1099 = z.strictObject({
  id: z.string(),
  owner: personId,
  payerToken: tinToken.optional(),
  rents: nonNegCents.optional(),
  royalties: nonNegCents.optional(),
  otherIncome: nonNegCents.optional(),
  federalWithheld: nonNegCents.optional(),
  treatAsBusiness: z.boolean().optional(),
});

const e1098 = z.strictObject({
  id: z.string(),
  owner: personId,
  lenderToken: tinToken.optional(),
  interest: nonNegCents,
  box2Checked: z.boolean().optional(),
});

const k1099 = z.strictObject({
  id: z.string(),
  owner: personId,
  payerToken: tinToken.optional(),
  grossAmount: nonNegCents,
  federalWithheld: nonNegCents.optional(),
  personalPortion: nonNegCents.optional(),
});

export const SCHEDULE_C_EXPENSES = [
  'advertising',
  'car_truck',
  'commissions',
  'contract_labor',
  'depreciation_section179',
  'insurance',
  'interest_other',
  'legal_professional',
  'office',
  'rent_equipment',
  'rent_property',
  'repairs',
  'supplies',
  'taxes_licenses',
  'travel',
  'meals',
  'utilities',
  'wages',
  'other',
] as const;
export const scheduleCExpense = z.enum(SCHEDULE_C_EXPENSES);

export const HOME_EXPENSES = [
  'casualty_losses',
  'mortgage_interest',
  'real_estate_taxes',
  'insurance',
  'rent',
  'repairs_maintenance',
  'utilities',
  'other',
] as const;
const homeExpense = z.enum(HOME_EXPENSES);

const homeOfficeActual = z.strictObject({
  method: z.literal('actual'),
  officeSquareFeet: z.number().min(0),
  homeSquareFeet: z.number().positive(),
  monthsUsed: z.number().int().min(1).max(12).optional(),
  ownership: z.enum(['rent', 'own']),
  direct: z.partialRecord(homeExpense, nonNegCents).optional(),
  indirect: z.partialRecord(homeExpense, nonNegCents).optional(),
  home: z
    .strictObject({
      basisOrValue: nonNegCents,
      landValue: nonNegCents,
      businessUseStart: date,
    })
    .optional(),
  carryover: z
    .strictObject({
      operating: nonNegCents.optional(),
      casualtyAndDepreciation: nonNegCents.optional(),
    })
    .optional(),
});

export const SCHEDULE_E_EXPENSES = [
  'advertising',
  'auto_travel',
  'cleaning_maintenance',
  'commissions',
  'insurance',
  'legal_professional',
  'management_fees',
  'mortgage_interest',
  'other_interest',
  'repairs',
  'supplies',
  'taxes',
  'utilities',
  'other',
] as const;

const rental = z.strictObject({
  id: z.string().regex(/^rental_\d+$/, 'rental ids look like rental_1'),
  owner: z.enum(['taxpayer', 'spouse', 'joint']),
  propertyType: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
    ])
    .optional(),
  fairRentalDays: z.number().int().min(0).max(366).optional(),
  personalUseDays: z.number().int().min(0).max(366).optional(),
  rentsOther: nonNegCents.optional(),
  royaltiesOther: nonNegCents.optional(),
  misc1099Ids: z.array(z.string()).optional(),
  expenses: z.partialRecord(z.enum(SCHEDULE_E_EXPENSES), nonNegCents),
  ownsDepreciableProperty: z.boolean().optional(),
  activeParticipation: z.boolean().optional(),
  priorYearUnallowedLoss: z.boolean().optional(),
});

const business = z.strictObject({
  owner: personId,
  name: z.string().max(120).optional(),
  principalBusinessCode: z
    .string()
    .regex(/^\d{6}$/, 'a 6-digit NAICS code')
    .optional(),
  grossReceiptsOther: nonNegCents.optional(),
  returnsAllowances: nonNegCents.optional(),
  expenses: z.partialRecord(scheduleCExpense, nonNegCents),
  homeOffice: z
    .union([
      z.strictObject({
        method: z.literal('simplified'),
        squareFeet: z.number().min(0),
      }),
      homeOfficeActual,
    ])
    .optional(),
  vehicle: z.strictObject({ businessMiles: z.number().min(0) }).optional(),
});

export const taxFactsSchema = z.strictObject({
  taxYear: z.union([z.literal(2025), z.literal(2026)]),
  filingStatus: z.enum(['single', 'mfj', 'hoh']).optional(),
  taxpayer: person,
  spouse: person.optional(),
  dependents: z.array(dependent),
  w2s: z.array(w2),
  int1099s: z.array(int1099),
  div1099s: z.array(div1099),
  nec1099s: z.array(nec1099),
  misc1099s: z.array(misc1099),
  k1099s: z.array(k1099),
  e1098s: z.array(e1098),
  businesses: z.array(business),
  rentals: z.array(rental),
  adjustments: z
    .strictObject({
      selfEmployedHealthInsurance: byPerson.optional(),
      sepContributions: byPerson.optional(),
      studentLoanInterestOther: nonNegCents.optional(),
    })
    .optional(),
  obbba: z
    .strictObject({
      qualifiedTips: byPerson.optional(),
      qualifiedOvertime: byPerson.optional(),
      carLoanInterest: nonNegCents.optional(),
      carLoanVehicle: z
        .strictObject({
          newVehicle: z.boolean(),
          finalAssemblyInUS: z.boolean(),
          personalUse: z.boolean(),
          purchaseDate: date.optional(),
        })
        .optional(),
    })
    .optional(),
  payments: z
    .strictObject({
      estimatedTaxPayments: nonNegCents.optional(),
      priorYearOverpaymentApplied: nonNegCents.optional(),
    })
    .optional(),
  studentLoan: z
    .strictObject({
      legallyObligated: z.boolean().optional(),
      qualifiedLoan: z.boolean().optional(),
    })
    .optional(),
  eitc: z
    .strictObject({ priorDisallowance: z.boolean().optional() })
    .optional(),
  screening: z
    .strictObject({
      hasDependents: z.boolean().optional(),
      hasRentalOrRoyaltyIncome: z.boolean().optional(),
      paidStudentLoanInterest: z.boolean().optional(),
    })
    .optional(),
  outOfScope: z
    .strictObject({
      retirementDistributions: z.boolean().optional(),
      socialSecurityBenefits: z.boolean().optional(),
      stockOrCryptoSales: z.boolean().optional(),
      k1Income: z.boolean().optional(),
      foreignIncomeOrAccounts: z.boolean().optional(),
      unemploymentCompensation: z.boolean().optional(),
      hsa: z.boolean().optional(),
      educationExpenses: z.boolean().optional(),
      wantsToItemize: z.boolean().optional(),
      marriedFilingSeparately: z.boolean().optional(),
      other: z.array(z.string().max(200)).optional(),
    })
    .optional(),
  hints: z
    .strictObject({
      mortgageInterest: nonNegCents.optional(),
      stateLocalTaxes: nonNegCents.optional(),
      charitableGifts: nonNegCents.optional(),
      medicalExpenses: nonNegCents.optional(),
    })
    .optional(),
  stateOfResidence: z
    .string()
    .regex(/^[A-Z]{2}$/, 'two-letter state code')
    .optional(),
  digitalAssetActivity: z.boolean().optional(),
});

const nameParts = {
  firstName: z.string().max(60).optional(),
  lastName: z.string().max(60).optional(),
};

export const identitySchema = z.strictObject({
  taxpayer: z
    .strictObject({ ...nameParts, occupation: z.string().max(60).optional() })
    .optional(),
  spouse: z
    .strictObject({ ...nameParts, occupation: z.string().max(60).optional() })
    .optional(),
  dependents: z
    .record(z.string().regex(/^dependent_\d+$/), z.strictObject(nameParts))
    .optional(),
  address: z
    .strictObject({
      street: z.string().max(120).optional(),
      apt: z.string().max(20).optional(),
      city: z.string().max(60).optional(),
      state: z
        .string()
        .regex(/^[A-Z]{2}$/, 'two-letter state code')
        .optional(),
      zip: z
        .string()
        .regex(/^\d{5}(?:-\d{4})?$/, 'ZIP or ZIP+4')
        .optional(),
    })
    .optional(),
  phone: z.string().max(20).optional(),
  rentals: z
    .record(
      z.string().regex(/^rental_\d+$/),
      z.strictObject({
        address: z
          .strictObject({
            street: z.string().max(120).optional(),
            city: z.string().max(60).optional(),
            state: z
              .string()
              .regex(/^[A-Z]{2}$/, 'two-letter state code')
              .optional(),
            zip: z
              .string()
              .regex(/^\d{5}(?:-\d{4})?$/, 'ZIP or ZIP+4')
              .optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

// ---- compile-time drift checks
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const factsMatch: Same<z.output<typeof taxFactsSchema>, TaxFacts> = true;
const identityMatch: Same<z.output<typeof identitySchema>, Identity> = true;
void factsMatch;
void identityMatch;
