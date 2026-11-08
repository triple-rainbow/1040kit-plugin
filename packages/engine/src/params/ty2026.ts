/**
 * Tax year 2026 parameters.
 *
 * Primary sources:
 *  - Rev. Proc. 2025-32 (inflation adjustments for 2026, incl. P.L. 119-21 changes).
 *  - SSA 2026 contribution and benefit base ($184,500); final 2026 Schedule SE line 7.
 *  - Notice 2026-10 and Announcement 2026-11 (standard mileage rates).
 *  - Notice 2025-67 (retirement plan limits).
 *  - IRS 2026 drafts: Form 1040 (created 8/19/26), Schedule 1-A (6/16/26),
 *    Schedules 1, 2, 8812 (4/2026), Form 8995 (5/1/26). Final 2026 Schedules C and SE.
 *
 * Anything not final is listed in `provisional`; computeReturn then reports
 * `provisional_params` and the return is not complete.
 */
import { pct } from '../money.ts';
import {
  formLines2026,
  lineAliases2026,
  lineAliasLabels,
  schEExpenseLines2026,
} from './lines.ts';
import { ty2025 } from './ty2025.ts';
import type { YearParams } from './types.ts';

export const ty2026: YearParams = {
  year: 2026,
  provisional: [
    {
      key: 'formLines',
      note: 'Line numbers come from IRS drafts of the 2026 Form 1040 (8/19/26), Schedules 1, 1-A, 2, 8812, E, EIC and Forms 8829, 8959, 8960, 8995; they may change when the forms are final.',
    },
    {
      key: 'eicTable',
      note: 'The 2026 EIC Table is not published yet; the earned income credit uses the 2025 table’s $50 bands on the Rev. Proc. 2025-32 amounts.',
    },
    {
      key: 'taxTable',
      note: 'The 2026 Tax Table is not published yet; tax under $100,000 uses the 2025 row structure (midpoint of $50 rows) on the Rev. Proc. 2025-32 brackets.',
    },
    {
      key: 'qbi.minimum',
      note: 'The $400 minimum QBI deduction (Form 8995 draft line 16, IRC §199A(i)) assumes material participation in the business; the 2026 Form 8995 instructions are not final.',
    },
    {
      key: 'mileageRateTenthCents',
      note: 'Business mileage is 72.5 cents through June 30 and 76 cents from July 1, 2026 (Announcement 2026-11). Facts do not split miles by date, so the engine uses 72.5 cents for all miles.',
    },
  ],

  // Rev. Proc. 2025-32 §4.14(1).
  standardDeduction: { single: 16100, mfj: 32200, hoh: 24150 },
  // Rev. Proc. 2025-32 §4.14(3): $1,650; $2,050 if unmarried and not a surviving spouse.
  additionalStdDeduction: { unmarried: 2050, married: 1650 },
  // Rev. Proc. 2025-32 §4.14(2).
  dependentStdDeduction: { minimum: 1350, earnedIncomeAddOn: 450 },
  // 2026 draft Form 1040 line 12d: "Were born before January 2, 1962".
  age65BornBefore: '1962-01-02',

  // Rev. Proc. 2025-32 §4.01 Tables 1-3.
  brackets: {
    single: [
      { over: 0, ratePpm: pct(10) },
      { over: 12400, ratePpm: pct(12) },
      { over: 50400, ratePpm: pct(22) },
      { over: 105700, ratePpm: pct(24) },
      { over: 201775, ratePpm: pct(32) },
      { over: 256225, ratePpm: pct(35) },
      { over: 640600, ratePpm: pct(37) },
    ],
    mfj: [
      { over: 0, ratePpm: pct(10) },
      { over: 24800, ratePpm: pct(12) },
      { over: 100800, ratePpm: pct(22) },
      { over: 211400, ratePpm: pct(24) },
      { over: 403550, ratePpm: pct(32) },
      { over: 512450, ratePpm: pct(35) },
      { over: 768700, ratePpm: pct(37) },
    ],
    hoh: [
      { over: 0, ratePpm: pct(10) },
      { over: 17700, ratePpm: pct(12) },
      { over: 67450, ratePpm: pct(22) },
      { over: 105700, ratePpm: pct(24) },
      { over: 201750, ratePpm: pct(32) },
      { over: 256200, ratePpm: pct(35) },
      { over: 640600, ratePpm: pct(37) },
    ],
  },
  // Rev. Proc. 2025-32 §4.03.
  qdcgThresholds: {
    single: { zeroMax: 49450, fifteenMax: 545500 },
    mfj: { zeroMax: 98900, fifteenMax: 613700 },
    hoh: { zeroMax: 66200, fifteenMax: 579600 },
  },
  // i1040gi line 16 rule ($100,000); 2026 Tax Table provisional (see above).
  taxTableMax: 100000,

  // SSA: 2026 contribution and benefit base; final 2026 Schedule SE line 7.
  ssWageBase: 184500,
  // Schedule B: over $1,500 (statutory, unchanged).
  schBThresholdCents: 150000,

  // Notice 2026-10: 72.5 cents (Jan 1-Jun 30); Announcement 2026-11: 76 cents from July 1 (provisional, see above).
  mileageRateTenthCents: 725,
  mileageRateNote:
    'The 2026 business mileage rate is 72.5 cents for miles through June 30 and 76 cents from July 1 (Announcement 2026-11). The engine used 72.5 cents for all miles; miles driven after June 30 may be worth more.',
  // Rev. Proc. 2013-13 (unchanged).
  homeOffice: { ratePerSqFt: 5, maxSqFt: 300 },
  // IRC §274(n).
  mealsPpm: pct(50),
  // Final 2026 Schedule SE (created 4/27/26): same rates.
  se: {
    netEarningsPpm: pct(92.35),
    ssRatePpm: pct(12.4),
    medicareRatePpm: pct(2.9),
    minimumNetEarnings: 400,
    deductionPpm: pct(50),
  },
  // Notice 2025-67: §415(c)(1)(A) $72,000.
  sep: { selfEmployedRatePpm: pct(20), annualLimit: 72000 },
  // 2026 Form 8995 draft lines 5, 14, 16; Rev. Proc. 2025-32 §2.12 (§199A(i) minimum: $400 with
  // at least $1,000 of active QBI, indexed after 2026).
  qbi: { ratePpm: pct(20), minimum: { deduction: 400, activeQbi: 1000 } },

  // 2026 Schedule 1-A draft: same amounts and phase-outs as 2025 (not indexed).
  sch1a: ty2025.sch1a,
  // Rev. Proc. 2025-32 §4.05: $2,200 and $1,700; 2026 Schedule 8812 draft: same lines and thresholds.
  ctc: ty2025.ctc,

  // Statutory, not indexed.
  additionalMedicareThreshold: ty2025.additionalMedicareThreshold,
  niitThreshold: ty2025.niitThreshold,
  // Rev. Proc. 2025-32 §4.26: threshold $201,750 ($403,500 MFJ); 2026 Form 8995 draft header.
  qbiThreshold: { single: 201750, mfj: 403500, hoh: 201750 },
  // Form 8615 applies above twice the $1,350 amount of Rev. Proc. 2025-32 §4.02 (§1(g)(4)(A)(ii)).
  kiddieTaxUnearnedThreshold: 2700,
  // Rev. Proc. 2025-32 §4.23: §152(d)(1)(B) exemption amount $5,300.
  qualifyingRelativeGrossIncome: 5300,
  ssTaxRatePpm: pct(6.2),
  medicareTaxRatePpm: pct(1.45),
  additionalMedicareRatePpm: pct(0.9),
  additionalMedicareWithholdingThreshold: 200000,

  // IRC §164(b)(7) as amended by P.L. 119-21: cap $40,400 and threshold $505,000 for 2026
  // (101% of the 2025 amounts), 30% phase-down, floor $10,000.
  saltCap: {
    cap: 40400,
    magiThreshold: 505000,
    reductionPpm: pct(30),
    floor: 10000,
  },
  medicalAgiFloorPpm: pct(7.5),
  // Rev. Proc. 2025-32 §4.06(1) amounts and §4.06(2) investment income limit $12,200; rates
  // IRC §32(b)(1). The 2026 EIC Table is not published: the engine applies the 2025 table's band
  // rules (see tax/eic.ts) to these amounts (provisional 'eicTable'). Age test: IRC
  // §32(c)(1)(A)(ii)(II), age 25-64 at the end of 2026.
  eitc: {
    investmentIncomeLimit: 12200,
    byChildren: [
      {
        creditPpm: pct(7.65),
        phaseoutPpm: pct(7.65),
        earnedIncomeAmount: 8680,
        maxCredit: 664,
        threshold: { mfj: 18140, other: 10860 },
        completed: { mfj: 26820, other: 19540 },
      },
      {
        creditPpm: pct(34),
        phaseoutPpm: pct(15.98),
        earnedIncomeAmount: 13020,
        maxCredit: 4427,
        threshold: { mfj: 31160, other: 23890 },
        completed: { mfj: 58863, other: 51593 },
      },
      {
        creditPpm: pct(40),
        phaseoutPpm: pct(21.06),
        earnedIncomeAmount: 18290,
        maxCredit: 7316,
        threshold: { mfj: 31160, other: 23890 },
        completed: { mfj: 65899, other: 58629 },
      },
      {
        creditPpm: pct(45),
        phaseoutPpm: pct(21.06),
        earnedIncomeAmount: 18290,
        maxCredit: 8231,
        threshold: { mfj: 31160, other: 23890 },
        completed: { mfj: 70244, other: 62974 },
      },
    ],
    noChildAge: { bornAfter: '1961-12-31', bornBefore: '2002-01-02' },
  },

  // Rev. Proc. 2025-32 §4.29: phase-out from $85,000 to $100,000 ($175,000 to $205,000 MFJ).
  studentLoanInterest: {
    cap: 2500,
    phaseoutStart: { single: 85000, hoh: 85000, mfj: 175000 },
    phaseoutRange: { single: 15000, hoh: 15000, mfj: 30000 },
  },

  // 2026 Form 8960 draft (6/1/26) line 17: 3.8%.
  niitRatePpm: pct(3.8),
  // Statutory (IRC §280A, §469(i)); not indexed.
  vacationHome: ty2025.vacationHome,
  passiveLoss: ty2025.passiveLoss,
  // Pub. 946 Table A-7a (statutory 39-year mid-month rates); 2026 Form 8829 draft (5/20/26)
  // keeps lines 37-42 unchanged.
  homeDepreciation: ty2025.homeDepreciation,

  formLines: formLines2026,
  schEExpenseLines: schEExpenseLines2026,
  lineAliases: lineAliases2026,
  lineAliasLabels,
};
