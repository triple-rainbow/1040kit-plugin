import type {
  FilingStatus,
  FormId,
  ScheduleEExpense,
  TaxYear,
} from '../types.ts';

/** One bracket: income over `over` (dollars) is taxed at `ratePpm`. */
export interface Bracket {
  over: number;
  ratePpm: number;
}

export interface FormLine {
  form: FormId;
  line: string;
}

/** One EIC Table column group (number of qualifying children), Rev. Proc. §.06 and §32(b). */
export interface EitcColumn {
  creditPpm: number;
  phaseoutPpm: number;
  earnedIncomeAmount: number;
  maxCredit: number;
  threshold: { mfj: number; other: number };
  completed: { mfj: number; other: number };
}

/** A parameter that is not final yet (draft form, unpublished table). */
export interface ProvisionalItem {
  key: string;
  note: string;
}

/**
 * Per-year tax parameters. Dollar amounts are whole dollars unless the
 * name says Cents. Every value in ty20xx.ts carries its source.
 */
export interface YearParams {
  year: TaxYear;
  /** Non-empty => computeReturn reports `provisional_params` (complete = false). */
  provisional: ProvisionalItem[];

  standardDeduction: Record<FilingStatus, number>;
  /** Additional amount per box (65+ or blind). */
  additionalStdDeduction: { unmarried: number; married: number };
  /** Dependent filer: greater of `minimum` or earned income + `earnedIncomeAddOn`. */
  dependentStdDeduction: { minimum: number; earnedIncomeAddOn: number };
  /** Born before this date (YYYY-MM-DD) => 65 or older at year end. */
  age65BornBefore: string;

  brackets: Record<FilingStatus, Bracket[]>;
  /** QDCG worksheet line 6 (0% max) and line 13 (15% max). */
  qdcgThresholds: Record<FilingStatus, { zeroMax: number; fifteenMax: number }>;
  /** Tax Table applies below this taxable income. */
  taxTableMax: number;

  ssWageBase: number;
  /** Schedule B required when interest or ordinary dividends exceed this (cents). */
  schBThresholdCents: number;

  // ---- self-employment (Schedule C, SE, Schedule 1, Form 8995)
  /** Business standard mileage rate in tenths of a cent per mile (70¢ = 700). */
  mileageRateTenthCents: number;
  /** Simplified home office method: $ per sq ft, max sq ft. */
  homeOffice: { ratePerSqFt: number; maxSqFt: number };
  /** Deductible share of business meals. */
  mealsPpm: number;
  se: {
    netEarningsPpm: number;
    ssRatePpm: number;
    medicareRatePpm: number;
    /** No SE tax when net earnings are below this. */
    minimumNetEarnings: number;
    deductionPpm: number;
  };
  sep: {
    /** Self-employed rate for a 25% plan (Pub. 560 Rate Table): 20%. */
    selfEmployedRatePpm: number;
    /** §415(c)(1)(A) annual additions limit. */
    annualLimit: number;
  };
  qbi: {
    ratePpm: number;
    /** §199A(i) minimum deduction (tax years after 2025). */
    minimum?: { deduction: number; activeQbi: number };
  };

  // ---- Schedule 1-A (P.L. 119-21, tax years 2025-2028)
  sch1a: {
    tips: {
      cap: number;
      threshold: Record<FilingStatus, number>;
      reductionPer1000: number;
    };
    overtime: {
      cap: Record<FilingStatus, number>;
      threshold: Record<FilingStatus, number>;
      reductionPer1000: number;
    };
    carLoan: {
      cap: number;
      threshold: Record<FilingStatus, number>;
      reductionPer1000: number;
      /** Loan must originate after this date (YYYY-MM-DD). */
      purchasedAfter: string;
    };
    senior: {
      amount: number;
      threshold: Record<FilingStatus, number>;
      reductionPpm: number;
    };
  };

  // ---- Schedule 8812
  ctc: {
    perChild: number;
    perOtherDependent: number;
    refundablePerChild: number;
    /** Children must be under this age at year end. */
    ageLimit: number;
    phaseoutThreshold: Record<FilingStatus, number>;
    phaseoutPpm: number;
    earnedIncomeThreshold: number;
    earnedIncomePpm: number;
    /** Part II-B applies when line 16b is at least this. */
    partIIBMinimum: number;
  };

  // ---- scope thresholds (situations v1 flags instead of computing)
  /** Form 8959: Medicare wages + SE earnings above this owe Additional Medicare Tax. */
  additionalMedicareThreshold: Record<FilingStatus, number>;
  /** Form 8960: MAGI above this with investment income owes NIIT. */
  niitThreshold: Record<FilingStatus, number>;
  /** Form 8995 may be used at or below this taxable income before QBI; above it needs 8995-A. */
  qbiThreshold: Record<FilingStatus, number>;
  /** Form 8615: a dependent with unearned income above this owes kiddie tax. */
  kiddieTaxUnearnedThreshold: number;
  /** Qualifying relative gross income limit (§152(d)(1)(B) exemption amount). */
  qualifyingRelativeGrossIncome: number;
  /** Employee social security tax rate (W-2 box 4 = rate x box 3 + box 7). */
  ssTaxRatePpm: number;

  /** Employee Medicare tax 1.45%, plus 0.9% withheld on wages over $200,000 (W-2 box 6 check). */
  medicareTaxRatePpm: number;
  additionalMedicareRatePpm: number;
  additionalMedicareWithholdingThreshold: number;
  /** Set when the mileage rate changed mid-year (review warning; the engine uses mileageRateTenthCents). */
  mileageRateNote?: string;

  // ---- deduction screening (flag-only rules)
  /** Schedule A SALT cap and its phase-down (IRC §164(b)(7) as amended by P.L. 119-21). */
  saltCap: {
    cap: number;
    magiThreshold: number;
    reductionPpm: number;
    floor: number;
  };
  /** Medical expenses deductible above this share of AGI (Schedule A line 3). */
  medicalAgiFloorPpm: number;

  // ---- Earned income credit (1040 line 27a, Schedule EIC)
  eitc: {
    /** No credit when investment income is more than this (§32(i)). */
    investmentIncomeLimit: number;
    /** Index = qualifying children with a valid SSN: 0, 1, 2, 3 or more. */
    byChildren: [EitcColumn, EitcColumn, EitcColumn, EitcColumn];
    /** No qualifying child: you (or your spouse, MFJ) at least 25 and under 65 = born after `bornAfter` and before `bornBefore`. */
    noChildAge: { bornAfter: string; bornBefore: string };
  };

  // ---- Student loan interest (Schedule 1 line 21 worksheet)
  studentLoanInterest: {
    cap: number;
    /** Worksheet line 5. */
    phaseoutStart: Record<FilingStatus, number>;
    /** Worksheet line 7 divisor. */
    phaseoutRange: Record<FilingStatus, number>;
  };

  // ---- Form 8960
  niitRatePpm: number;

  // ---- Schedule E (Pub. 527 / IRC §280A, Pub. 925 / IRC §469(i))
  vacationHome: {
    /** Used as a home when personal days > max(minPersonalDays, personalPpm x fair rental days). */
    minPersonalDays: number;
    personalPpm: number;
    /** Used as a home and rented fewer than this many days: not reported (§280A(g)). */
    minRentalDays: number;
  };
  passiveLoss: {
    /** Special allowance for actively managed rental real estate; Form 8582 exception limit. */
    specialAllowance: number;
    /** Form 8582 exception: MAGI at or below this. */
    magiLimit: number;
  };

  // ---- Form 8829 Part III (39-year nonresidential real property, mid-month)
  homeDepreciation: {
    /** i8829 line 41 table / Pub. 946 Table A-7a year 1, by month first used (Jan..Dec), in ppm. */
    firstYearPpmByMonth: number[];
    /** Years 2-39 (first used after May 12, 1993 and before this year). */
    laterYearPpm: number;
    /** Business use starting before this date needs Pub. 946/534 rules (flagged). */
    earliestStart: string;
    recoveryYears: number;
  };

  formLines: Record<string, FormLine>;
  /** Schedule E Part I expense line per category (per-property nodes add ":A", ":B", …). */
  schEExpenseLines: Record<ScheduleEExpense, string>;
  /** Extra "<form>:<line>" -> node id lookups for lines that repeat a node's value. */
  lineAliases: Record<string, string>;
}
