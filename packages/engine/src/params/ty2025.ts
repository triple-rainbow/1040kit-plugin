/**
 * Tax year 2025 parameters.
 *
 * Primary sources:
 *  - Rev. Proc. 2024-40 (inflation adjustments for 2025), as amended by
 *    P.L. 119-21 ("One Big Beautiful Bill Act", OBBBA) §70102 (standard deduction).
 *  - 2025 Form 1040 and Instructions for Form 1040 (i1040gi, incl. the 2025
 *    Tax Table and Tax Computation Worksheet, i1040tt.pdf), checked 2026-11-04.
 */
import { pct } from '../money.ts';
import {
  formLines2025,
  lineAliases2025,
  lineAliasLabels,
  schEExpenseLines2025,
} from './lines.ts';
import type { YearParams } from './types.ts';

export const ty2025: YearParams = {
  year: 2025,
  provisional: [],

  // i1040gi 2025 line 12e chart / Form 1040 margin: 15,750 / 31,500 / 23,625.
  // Rev. Proc. 2024-40 §3.15 had 15,000 / 30,000 / 22,500; OBBBA §70102 raised them.
  standardDeduction: { single: 15750, mfj: 31500, hoh: 23625 },
  // Rev. Proc. 2024-40 §3.15(3); i1040gi Standard Deduction Worksheet for
  // Dependents line 4b: $1,600 ($2,000 if single or head of household).
  additionalStdDeduction: { unmarried: 2000, married: 1600 },
  // Rev. Proc. 2024-40 §3.15(2); i1040gi Standard Deduction Worksheet for Dependents lines 1-2.
  dependentStdDeduction: { minimum: 1350, earnedIncomeAddOn: 450 },
  // 2025 Form 1040 line 12d: "Were born before January 2, 1961".
  age65BornBefore: '1961-01-02',

  // Rev. Proc. 2024-40 §3.01 Tables 1-3 (rates 10/12/22/24/32/35/37%);
  // matches the 2025 Tax Computation Worksheet (i1040tt.pdf p.14) row boundaries.
  brackets: {
    single: [
      { over: 0, ratePpm: pct(10) },
      { over: 11925, ratePpm: pct(12) },
      { over: 48475, ratePpm: pct(22) },
      { over: 103350, ratePpm: pct(24) },
      { over: 197300, ratePpm: pct(32) },
      { over: 250525, ratePpm: pct(35) },
      { over: 626350, ratePpm: pct(37) },
    ],
    mfj: [
      { over: 0, ratePpm: pct(10) },
      { over: 23850, ratePpm: pct(12) },
      { over: 96950, ratePpm: pct(22) },
      { over: 206700, ratePpm: pct(24) },
      { over: 394600, ratePpm: pct(32) },
      { over: 501050, ratePpm: pct(35) },
      { over: 751600, ratePpm: pct(37) },
    ],
    hoh: [
      { over: 0, ratePpm: pct(10) },
      { over: 17000, ratePpm: pct(12) },
      { over: 64850, ratePpm: pct(22) },
      { over: 103350, ratePpm: pct(24) },
      { over: 197300, ratePpm: pct(32) },
      { over: 250500, ratePpm: pct(35) },
      { over: 626350, ratePpm: pct(37) },
    ],
  },
  // i1040gi 2025 Qualified Dividends and Capital Gain Tax Worksheet lines 6 and 13;
  // Rev. Proc. 2024-40 §3.03.
  qdcgThresholds: {
    single: { zeroMax: 48350, fifteenMax: 533400 },
    mfj: { zeroMax: 96700, fifteenMax: 600050 },
    hoh: { zeroMax: 64750, fifteenMax: 566700 },
  },
  // i1040gi line 16: Tax Table if taxable income is less than $100,000.
  taxTableMax: 100000,

  // 2025 Schedule SE line 7; SSA contribution and benefit base for 2025.
  ssWageBase: 176100,
  // Schedule B instructions: file if taxable interest or ordinary dividends are over $1,500.
  schBThresholdCents: 150000,

  // Notice 2025-5; i1040sc 2025 line 9: 70 cents per mile.
  mileageRateTenthCents: 700,
  // Rev. Proc. 2013-13; i1040sc 2025 line 30 Simplified Method Worksheet: $5 per sq ft, max 300 sq ft.
  homeOffice: { ratePerSqFt: 5, maxSqFt: 300 },
  // IRC §274(n); i1040sc 2025 line 24b: generally 50% of business meals.
  mealsPpm: pct(50),
  // 2025 Schedule SE lines 4a (92.35%), 4c ($400), 10 (12.4%), 11 (2.9%), 13 (50%).
  se: {
    netEarningsPpm: pct(92.35),
    ssRatePpm: pct(12.4),
    medicareRatePpm: pct(2.9),
    minimumNetEarnings: 400,
    deductionPpm: pct(50),
  },
  // Pub. 560 (2025) Rate Table for Self-Employed (25% plan -> 20%); Notice 2024-80: §415(c) $70,000.
  sep: { selfEmployedRatePpm: pct(20), annualLimit: 70000 },
  // 2025 Form 8995 lines 5, 9, 14: 20%. No minimum deduction before 2026 (§199A(i), P.L. 119-21 §70105).
  qbi: { ratePpm: pct(20) },

  // 2025 Schedule 1-A (created 11/4/25), the primary source for every value below;
  // enacted by P.L. 119-21 (tips IRC §224, overtime §225, car loan interest §163(h)(4),
  // senior deduction §151(d)(5)(C)), tax years 2025-2028.
  sch1a: {
    // Part II lines 7, 9, 11-12: $25,000; $150,000 ($300,000 MFJ); $100 per full $1,000 (rounded down).
    tips: {
      cap: 25000,
      threshold: { single: 150000, mfj: 300000, hoh: 150000 },
      reductionPer1000: 100,
    },
    // Part III lines 15, 17, 19-20: $12,500 ($25,000 MFJ); same phase-out as tips.
    overtime: {
      cap: { single: 12500, mfj: 25000, hoh: 12500 },
      threshold: { single: 150000, mfj: 300000, hoh: 150000 },
      reductionPer1000: 100,
    },
    // Part IV lines 24, 26, 28-29: $10,000; $100,000 ($200,000 MFJ); $200 per $1,000 or part (rounded up).
    // IRC §163(h)(4): indebtedness incurred after December 31, 2024.
    carLoan: {
      cap: 10000,
      threshold: { single: 100000, mfj: 200000, hoh: 100000 },
      reductionPer1000: 200,
      purchasedAfter: '2024-12-31',
    },
    // Part V lines 32-35: $6,000 less 6% of MAGI over $75,000 ($150,000 MFJ), per qualifying person.
    senior: {
      amount: 6000,
      threshold: { single: 75000, mfj: 150000, hoh: 75000 },
      reductionPpm: pct(6),
    },
  },

  // 2025 Schedule 8812 and i1040s8: $2,200 per child (P.L. 119-21 §70104), $500 ODC,
  // ACTC $1,700 (Rev. Proc. 2024-40 §3.05), phase-out 5% of MAGI over $200,000 ($400,000 MFJ)
  // rounded up to $1,000 (line 10), earned income over $2,500 x 15% (lines 19-20),
  // Part II-B when line 16b is $5,100 or more.
  ctc: {
    perChild: 2200,
    perOtherDependent: 500,
    refundablePerChild: 1700,
    ageLimit: 17,
    phaseoutThreshold: { single: 200000, mfj: 400000, hoh: 200000 },
    phaseoutPpm: pct(5),
    earnedIncomeThreshold: 2500,
    earnedIncomePpm: pct(15),
    partIIBMinimum: 5100,
  },

  // IRC §3101(b)(2) / Form 8959 instructions: $200,000 single and HoH, $250,000 MFJ (not indexed).
  additionalMedicareThreshold: { single: 200000, mfj: 250000, hoh: 200000 },
  // IRC §1411(b) / Form 8960 instructions: $200,000 single and HoH, $250,000 MFJ (not indexed).
  niitThreshold: { single: 200000, mfj: 250000, hoh: 200000 },
  // 2025 Form 8995 header / i8995: taxable income before QBI at or below $197,300
  // ($394,600 MFJ); Rev. Proc. 2024-40 §3.27.
  qbiThreshold: { single: 197300, mfj: 394600, hoh: 197300 },
  // i1040gi line 16, Form 8615: "more than $2,700 of unearned income".
  kiddieTaxUnearnedThreshold: 2700,
  // i1040gi Dependents, Step 1 qualifying relative test: gross income less than $5,200 in 2025.
  qualifyingRelativeGrossIncome: 5200,
  // IRC §3101(a): employee social security tax rate 6.2% (W-2 box 4 check, excess SS).
  ssTaxRatePpm: pct(6.2),

  // IRC §3101(b)(1) 1.45%; §3102(f) employer withholds 0.9% on wages over $200,000.
  medicareTaxRatePpm: pct(1.45),
  additionalMedicareRatePpm: pct(0.9),
  additionalMedicareWithholdingThreshold: 200000,

  // 2025 Instructions for Schedule A line 5e: $40,000 cap, reduced by 30% of MAGI over
  // $500,000, not below $10,000 (IRC §164(b)(7) as amended by P.L. 119-21).
  saltCap: {
    cap: 40000,
    magiThreshold: 500000,
    reductionPpm: pct(30),
    floor: 10000,
  },
  // Schedule A line 3: 7.5% of AGI.
  medicalAgiFloorPpm: pct(7.5),
  // Rev. Proc. 2024-40 §3.06: earned income amounts, maximum credits, threshold and completed
  // phaseout amounts; investment income limit $11,950 (§3.06(2)). Credit and phaseout rates are
  // IRC §32(b)(1) (7.65/34/40/45%; 7.65/15.98/21.06/21.06%). Matches the 2025 EIC Table (p1040,
  // i1040gi) row for row: test/fixtures/eic-table-2025.json. Age 25-64 for no child: i1040gi
  // 2025 line 27a Step 4 question 2 ("born after December 31, 1960, and before January 2, 2001").
  eitc: {
    investmentIncomeLimit: 11950,
    byChildren: [
      {
        creditPpm: pct(7.65),
        phaseoutPpm: pct(7.65),
        earnedIncomeAmount: 8490,
        maxCredit: 649,
        threshold: { mfj: 17730, other: 10620 },
        completed: { mfj: 26214, other: 19104 },
      },
      {
        creditPpm: pct(34),
        phaseoutPpm: pct(15.98),
        earnedIncomeAmount: 12730,
        maxCredit: 4328,
        threshold: { mfj: 30470, other: 23350 },
        completed: { mfj: 57554, other: 50434 },
      },
      {
        creditPpm: pct(40),
        phaseoutPpm: pct(21.06),
        earnedIncomeAmount: 17880,
        maxCredit: 7152,
        threshold: { mfj: 30470, other: 23350 },
        completed: { mfj: 64430, other: 57310 },
      },
      {
        creditPpm: pct(45),
        phaseoutPpm: pct(21.06),
        earnedIncomeAmount: 17880,
        maxCredit: 8046,
        threshold: { mfj: 30470, other: 23350 },
        completed: { mfj: 68675, other: 61555 },
      },
    ],
    noChildAge: { bornAfter: '1960-12-31', bornBefore: '2001-01-02' },
  },

  // i1040gi 2025 Schedule 1 line 21 worksheet: $2,500 cap; line 5 $85,000 ($170,000 MFJ);
  // line 7 divisor $15,000 ($30,000 MFJ). Rev. Proc. 2024-40 §3.30 (phase-out 85,000-100,000 /
  // 170,000-200,000).
  studentLoanInterest: {
    cap: 2500,
    phaseoutStart: { single: 85000, hoh: 85000, mfj: 170000 },
    phaseoutRange: { single: 15000, hoh: 15000, mfj: 30000 },
  },

  // 2025 Form 8960 line 17: 3.8% (IRC §1411(a)(1)).
  niitRatePpm: pct(3.8),

  // i1040se 2025 line 2 and Pub. 527 ch. 5 (IRC §280A(d)(1), (g)): used as a home when personal
  // use is more than the greater of 14 days or 10% of fair rental days; used as a home and rented
  // fewer than 15 days -> not reported.
  vacationHome: {
    minPersonalDays: 14,
    personalPpm: pct(10),
    minRentalDays: 15,
  },
  // i1040se 2025 "Exception for Certain Rental Real Estate Activities" and Pub. 925 (IRC §469(i)):
  // overall net loss $25,000 or less, MAGI $100,000 or less (not indexed).
  passiveLoss: { specialAllowance: 25000, magiLimit: 100000 },

  // i8829 2025 line 41 table (first used for business in 2025, by month), 2.564% if first used
  // after May 12, 1993 and before 2025; Pub. 946 Table A-7a (39-year, mid-month).
  homeDepreciation: {
    firstYearPpmByMonth: [
      2.461, 2.247, 2.033, 1.819, 1.605, 1.391, 1.177, 0.963, 0.749, 0.535,
      0.321, 0.107,
    ].map(pct),
    laterYearPpm: pct(2.564),
    earliestStart: '1993-05-13',
    recoveryYears: 39,
  },

  formLines: formLines2025,
  schEExpenseLines: schEExpenseLines2025,
  lineAliases: lineAliases2025,
  lineAliasLabels,
};
