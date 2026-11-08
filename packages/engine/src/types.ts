/**
 * The 1040kit engine contract.
 *
 * Both the engine (packages/engine) and the MCP server (packages/mcp) build
 * against this file. Changing it needs the coordinator's OK.
 *
 * Units: fields typed `Cents` are integer cents (facts as read from documents).
 * Fields typed `Dollars` are integer whole dollars (computed lines).
 */

export type TaxYear = 2025 | 2026;
export type FilingStatus = 'single' | 'mfj' | 'hoh';
export type PersonId = 'taxpayer' | 'spouse';
export type Cents = number;
export type Dollars = number;

// ---------------------------------------------------------------- facts

export interface Person {
  id: PersonId;
  /** YYYY-MM-DD */
  dateOfBirth?: string;
  blind?: boolean;
  /** Has an SSN valid for employment (CTC, Schedule 1-A). */
  hasValidSsn?: boolean;
  canBeClaimedAsDependent?: boolean;
  /** EITC: main home in the United States for more than half the year. */
  livedInUsOverHalfYear?: boolean;
  /**
   * EITC: could be claimed as the qualifying child of another taxpayer
   * (i1040gi line 27 rules). Answering true blocks the EITC.
   */
  qualifyingChildOfAnother?: boolean;
  // No SSN field: 1040kit never stores SSNs. The user writes or types every
  // SSN themselves (see docs/coverage.md, "Identifiers").
}

export interface Dependent {
  /** "dependent_1", "dependent_2", … */
  id: string;
  dateOfBirth?: string;
  /**
   * i1040gi qualifying child: son, daughter, stepchild, foster child,
   * brother, sister, half/step sibling, or a descendant of any of them.
   * `grandchild` covers any descendant of a child/stepchild/foster child;
   * `niece_nephew` any descendant of a sibling, half sibling or step sibling.
   */
  relationship?:
    | 'child'
    | 'stepchild'
    | 'foster_child'
    | 'sibling'
    | 'half_sibling'
    | 'step_sibling'
    | 'grandchild'
    | 'niece_nephew'
    | 'parent'
    | 'other';
  monthsLivedWithTaxpayer?: number;
  hasValidSsn?: boolean;
  fullTimeStudent?: boolean;
  permanentlyDisabled?: boolean;
  providedOverHalfOwnSupport?: boolean;
  /** For the qualifying-relative gross income test. */
  grossIncome?: Cents;
}

export interface W2 {
  /** "w2_1", … */
  id: string;
  owner: PersonId;
  employerEinToken?: string;
  wages: Cents; // box 1
  federalWithheld: Cents; // box 2
  ssWages: Cents; // box 3
  ssTax: Cents; // box 4
  medicareWages: Cents; // box 5
  medicareTax: Cents; // box 6
  ssTips?: Cents; // box 7
  allocatedTips?: Cents; // box 8
  box12?: { code: string; amount: Cents }[];
  statutoryEmployee?: boolean; // box 13
  retirementPlan?: boolean; // box 13
  corrected?: boolean; // W-2c / CORRECTED box
}

export interface Form1099Int {
  id: string;
  owner: PersonId;
  payerToken?: string;
  interest: Cents; // box 1
  earlyWithdrawalPenalty?: Cents; // box 2
  usSavingsBondInterest?: Cents; // box 3
  federalWithheld?: Cents; // box 4
  taxExemptInterest?: Cents; // box 8
}

export interface Form1099Div {
  id: string;
  owner: PersonId;
  payerToken?: string;
  ordinaryDividends: Cents; // box 1a
  qualifiedDividends: Cents; // box 1b
  capitalGainDistributions?: Cents; // box 2a
  federalWithheld?: Cents; // box 4
  section199aDividends?: Cents; // box 5
  exemptInterestDividends?: Cents; // box 12
}

export interface Form1099Nec {
  id: string;
  owner: PersonId;
  payerToken?: string;
  nonemployeeComp: Cents; // box 1
  federalWithheld?: Cents; // box 4
}

export interface Form1099Misc {
  id: string;
  owner: PersonId;
  payerToken?: string;
  rents?: Cents; // box 1
  royalties?: Cents; // box 2
  otherIncome?: Cents; // box 3
  federalWithheld?: Cents; // box 4
  /** User confirmed these amounts are receipts of their Schedule C business. */
  treatAsBusiness?: boolean;
}

/** Form 1098-E, Student Loan Interest Statement. */
export interface Form1098E {
  /** "e1098_1", … */
  id: string;
  owner: PersonId;
  lenderToken?: string;
  interest: Cents; // box 1
  /** Box 2 checked: box 1 excludes loan origination fees / capitalized interest. */
  box2Checked?: boolean;
}

export interface Form1099K {
  id: string;
  owner: PersonId;
  payerToken?: string;
  grossAmount: Cents; // box 1a
  federalWithheld?: Cents; // box 4
  /** User-confirmed part that is not business income (personal transfers, items sold at a loss). */
  personalPortion?: Cents;
}

export type ScheduleCExpense =
  | 'advertising'
  | 'car_truck'
  | 'commissions'
  | 'contract_labor'
  | 'depreciation_section179'
  | 'insurance'
  | 'interest_other'
  | 'legal_professional'
  | 'office'
  | 'rent_equipment'
  | 'rent_property'
  | 'repairs'
  | 'supplies'
  | 'taxes_licenses'
  | 'travel'
  | 'meals'
  | 'utilities'
  | 'wages'
  | 'other';

export interface Business {
  /** One Schedule C per person in v1. */
  owner: PersonId;
  name?: string;
  principalBusinessCode?: string;
  /** Receipts not reported on any 1099. */
  grossReceiptsOther?: Cents;
  returnsAllowances?: Cents;
  /** `meals` is the full amount paid; the engine applies the 50% limit. */
  expenses: Partial<Record<ScheduleCExpense, Cents>>;
  homeOffice?: { method: 'simplified'; squareFeet: number } | HomeOfficeActual;
  /** Standard mileage; when present, `expenses.car_truck` is ignored. */
  vehicle?: { businessMiles: number };
}

/**
 * Form 8829 (actual-expense home office). Whole-home amounts are for the
 * full year; the engine applies the business-use percentage
 * (officeSquareFeet / homeSquareFeet) and the gross income limit.
 */
export interface HomeOfficeActual {
  method: 'actual';
  officeSquareFeet: number;
  homeSquareFeet: number;
  /** Months in the year the office was used (1-12). Default 12. */
  monthsUsed?: number;
  ownership: 'rent' | 'own';
  /** Expenses only for the office itself (Form 8829 column (a)). */
  direct?: Partial<Record<HomeExpense, Cents>>;
  /** Whole-home expenses (Form 8829 column (b)). */
  indirect?: Partial<Record<HomeExpense, Cents>>;
  /** Owners only: Form 8829 Part III, 39-year nonresidential, mid-month. */
  home?: {
    /** Smaller of adjusted basis or fair market value, including land. */
    basisOrValue: Cents;
    landValue: Cents;
    /** Date the home office was first used for business, YYYY-MM-DD. */
    businessUseStart: string;
  };
  /** Prior-year Form 8829 lines 43 and 44. */
  carryover?: { operating?: Cents; casualtyAndDepreciation?: Cents };
}

export type HomeExpense =
  | 'casualty_losses'
  | 'mortgage_interest'
  | 'real_estate_taxes'
  | 'insurance'
  | 'rent'
  | 'repairs_maintenance'
  | 'utilities'
  | 'other';

/** Schedule E, Part I expense lines 5-19 (depreciation, line 18, is out of scope). */
export type ScheduleEExpense =
  | 'advertising'
  | 'auto_travel'
  | 'cleaning_maintenance'
  | 'commissions'
  | 'insurance'
  | 'legal_professional'
  | 'management_fees'
  | 'mortgage_interest'
  | 'other_interest'
  | 'repairs'
  | 'supplies'
  | 'taxes'
  | 'utilities'
  | 'other';

/**
 * One Schedule E, Part I column (property A, B or C). v1: at most 3.
 * Depreciation (Form 4562) and passive loss limits (Form 8582) are not
 * computed: see `ownsDepreciableProperty` and the engine's scope checks.
 */
export interface RentalProperty {
  /** "rental_1", … (column A, B, C in id order). */
  id: string;
  owner: PersonId | 'joint';
  /** Schedule E line 1b property type code: 1-8 (6 = royalties). */
  propertyType?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  fairRentalDays?: number;
  personalUseDays?: number;
  /** Rents not reported on a 1099-MISC (Schedule E line 3). */
  rentsOther?: Cents;
  /** Royalties not reported on a 1099-MISC (line 4). */
  royaltiesOther?: Cents;
  /** 1099-MISC ids whose box 1 / box 2 belong to this property. */
  misc1099Ids?: string[];
  expenses: Partial<Record<ScheduleEExpense, Cents>>;
  /** Owns the building or equipment being rented: depreciation applies → out of scope in v1. */
  ownsDepreciableProperty?: boolean;
  /** Actively participated (i1040se line 1/Pub 925): needed when there is a loss. */
  activeParticipation?: boolean;
  /** A prior-year unallowed passive loss exists → Form 8582 → out of scope. */
  priorYearUnallowedLoss?: boolean;
}

export interface Adjustments {
  selfEmployedHealthInsurance?: Partial<Record<PersonId, Cents>>;
  sepContributions?: Partial<Record<PersonId, Cents>>;
  /** Student loan interest paid with no 1098-E (lender paid < $600 interest). */
  studentLoanInterestOther?: Cents;
}

/** Facts for the student loan interest deduction (Schedule 1 line 21). */
export interface StudentLoanFacts {
  /** Legally obligated to pay the interest on a qualified student loan. */
  legallyObligated?: boolean;
  /** The loan was taken only to pay qualified higher education expenses. */
  qualifiedLoan?: boolean;
}

/** EITC facts beyond Person/Dependent fields. */
export interface EitcFacts {
  /** EITC was reduced or disallowed after 1996 for a reason other than math → Form 8862 → out of scope. */
  priorDisallowance?: boolean;
}

/** Yes/no screening answers that decide whether to ask about whole topics. */
export interface Screening {
  /** Someone (a child or relative) lives with the filer or depends on them: ask who. */
  hasDependents?: boolean;
  hasRentalOrRoyaltyIncome?: boolean;
  paidStudentLoanInterest?: boolean;
}

export interface ObbbaFacts {
  qualifiedTips?: Partial<Record<PersonId, Cents>>;
  qualifiedOvertime?: Partial<Record<PersonId, Cents>>;
  carLoanInterest?: Cents;
  carLoanVehicle?: {
    newVehicle: boolean;
    finalAssemblyInUS: boolean;
    personalUse: boolean;
    /** YYYY-MM-DD */
    purchaseDate?: string;
  };
}

export interface Payments {
  estimatedTaxPayments?: Cents;
  priorYearOverpaymentApplied?: Cents;
}

/** Situations the interview detects that v1 does not compute. */
export interface OutOfScopeFlags {
  retirementDistributions?: boolean; // 1099-R
  socialSecurityBenefits?: boolean; // SSA-1099
  stockOrCryptoSales?: boolean; // 1099-B, digital assets sold
  k1Income?: boolean;
  foreignIncomeOrAccounts?: boolean;
  unemploymentCompensation?: boolean; // 1099-G
  hsa?: boolean; // 8889
  educationExpenses?: boolean; // 8863
  wantsToItemize?: boolean; // Schedule A
  marriedFilingSeparately?: boolean;
  other?: string[];
}

/** Soft facts used only to flag opportunities (never computed into the return). */
export interface Hints {
  mortgageInterest?: Cents;
  stateLocalTaxes?: Cents;
  charitableGifts?: Cents;
  medicalExpenses?: Cents;
}

export interface TaxFacts {
  taxYear: TaxYear;
  filingStatus?: FilingStatus;
  taxpayer: Person;
  spouse?: Person;
  dependents: Dependent[];
  w2s: W2[];
  int1099s: Form1099Int[];
  div1099s: Form1099Div[];
  nec1099s: Form1099Nec[];
  misc1099s: Form1099Misc[];
  k1099s: Form1099K[];
  e1098s: Form1098E[];
  businesses: Business[];
  rentals: RentalProperty[];
  adjustments?: Adjustments;
  obbba?: ObbbaFacts;
  payments?: Payments;
  studentLoan?: StudentLoanFacts;
  eitc?: EitcFacts;
  screening?: Screening;
  outOfScope?: OutOfScopeFlags;
  hints?: Hints;
  /** Two-letter state of residence (mailing address lookup, state notes). */
  stateOfResidence?: string;
  digitalAssetActivity?: boolean;
}

// ---------------------------------------------------------------- results

export type FormId =
  | 'f1040'
  | 'sch1'
  | 'sch1a'
  | 'sch2'
  | 'schB'
  | 'schC.taxpayer'
  | 'schC.spouse'
  | 'schSE.taxpayer'
  | 'schSE.spouse'
  | 'sch8812'
  | 'f8995'
  | 'schE'
  | 'schEIC'
  | 'f8829.taxpayer'
  | 'f8829.spouse'
  | 'f8959'
  | 'f8960';

export interface Citation {
  /** KB document id, e.g. "i1040gi", "p334", "i1040s1a". */
  docId: string;
  section?: string;
  url: string;
}

export interface TraceInput {
  /** Another node id, or a fact path such as "w2s[w2_1].wages". */
  ref: string;
  kind: 'node' | 'fact' | 'param';
  value: number | string | boolean | null;
}

export interface Trace {
  /** Human-readable formula, e.g. "sum(W-2 box 1)". */
  formula: string;
  inputs: TraceInput[];
}

export interface LineNode {
  /** Semantic, year-stable id, e.g. "wages", "agi", "seTax.taxpayer". */
  id: string;
  label: string;
  value: Dollars;
  /** Where it prints for this tax year, if anywhere. */
  form?: FormId;
  /**
   * The form's own line label ("1a", "8z", "21"). Schedule E per-property
   * lines add the column: "3:A", "20:B". Schedule EIC child rows: "2:1"
   * (line 2, child 1).
   */
  line?: string;
  trace: Trace;
  citations: Citation[];
}

export interface UnsupportedItem {
  code: string;
  message: string;
  deferredTo: 'v1.1' | 'v1.2' | 'v2' | 'not_planned';
}

export interface MissingFact {
  /** Fact path, e.g. "taxpayer.dateOfBirth", "dependents[dependent_1].hasValidSsn". */
  path: string;
  /** Plain-English question, ≤ 140 chars. */
  question: string;
  why: string;
  blocking: boolean;
  /** Lower asks first. */
  priority: number;
}

export interface ReturnSummary {
  totalIncome: Dollars;
  agi: Dollars;
  deductions: Dollars;
  taxableIncome: Dollars;
  totalTax: Dollars;
  totalPayments: Dollars;
  /** Positive = refund, negative = amount owed. */
  refundOrOwed: Dollars;
}

export interface ReturnResult {
  taxYear: TaxYear;
  filingStatus?: FilingStatus;
  /** unsupported is empty and no blocking fact is missing. */
  complete: boolean;
  unsupported: UnsupportedItem[];
  missing: MissingFact[];
  forms: FormId[];
  nodes: Record<string, LineNode>;
  summary: ReturnSummary;
}

export interface Explanation {
  node: LineNode;
  children: Explanation[];
}

export interface DeductionOpportunity {
  id: string;
  title: string;
  /** The stated eligibility test (spec §4 integrity rule). */
  eligibility: string;
  /** What to ask the user. */
  question: string;
  docsNeeded: string[];
  /** From a recompute with the best-case patch; null when it can't be estimated. */
  estimatedSavings: Dollars | null;
  status: 'possible' | 'claimed' | 'flag_only';
  citations: Citation[];
  /**
   * Fact paths the agent sets (via profile_set) once the user confirms, e.g.
   * ["obbba.qualifiedTips.taxpayer"]. Placeholders like "<owner>" or "<id>"
   * mark parts the agent fills in.
   */
  factPaths?: string[];
  /** For Schedule C expense rules: the category the amount goes in. */
  scheduleCCategory?: ScheduleCExpense;
}

/**
 * Node ids every ReturnResult contains (stable across years), so tools and
 * skills can explain the headline numbers without guessing ids.
 */
export const SUMMARY_NODE_IDS = [
  'totalIncome',
  'agi',
  'deductions',
  'taxableIncome',
  'totalTax',
  'totalPayments',
  'refundOrOwed',
] as const;

export interface ReviewFinding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  nodeIds: string[];
}

export interface PriorYearSummary {
  taxYear: number;
  agi?: Dollars;
  totalTax?: Dollars;
  refundOrOwed?: Dollars;
  wages?: Dollars;
  filingStatus?: FilingStatus;
}

export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export interface ScenarioInput {
  name: string;
  /** Deep-merged into the facts; arrays replace. */
  patch: DeepPartial<TaxFacts>;
}

export interface ScenarioResult {
  name: string;
  summary: ReturnSummary;
  complete: boolean;
  delta: { refundOrOwed: Dollars; totalTax: Dollars };
}

export interface EngineApi {
  supportedYears: readonly TaxYear[];
  computeReturn(facts: TaxFacts): ReturnResult;
  /** ref = node id, or "<form>:<line>" such as "f1040:16". Null if unknown. */
  explainLine(
    result: ReturnResult,
    ref: string,
    depth?: number
  ): Explanation | null;
  requiredFacts(facts: TaxFacts): MissingFact[];
  checkScope(facts: TaxFacts): UnsupportedItem[];
  findDeductions(facts: TaxFacts, result: ReturnResult): DeductionOpportunity[];
  reviewChecks(
    facts: TaxFacts,
    result: ReturnResult,
    prior?: PriorYearSummary
  ): ReviewFinding[];
  compareScenarios(
    facts: TaxFacts,
    scenarios: ScenarioInput[]
  ): ScenarioResult[];
}

/** Empty facts for a year — the starting point of every workspace. */
export function emptyFacts(taxYear: TaxYear): TaxFacts {
  return {
    taxYear,
    taxpayer: { id: 'taxpayer' },
    dependents: [],
    w2s: [],
    int1099s: [],
    div1099s: [],
    nec1099s: [],
    misc1099s: [],
    k1099s: [],
    e1098s: [],
    businesses: [],
    rentals: [],
  };
}
