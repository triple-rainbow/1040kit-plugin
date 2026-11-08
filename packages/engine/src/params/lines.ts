/**
 * Where each semantic node prints, per tax year. Line numbers move between
 * years (2025 -> 2026: Schedule 1-A and QBI swap lines 13a/13b), so node ids
 * never encode them.
 *
 * TY2025: final 2025 Form 1040, Schedules 1, 1-A, 2, B, C, SE, 8812, Form 8995.
 * TY2026: Form 1040 draft (created 8/19/26), Schedule 1/2/8812 drafts (4/2026),
 *   Form 8995 draft (5/1/26), Schedule 1-A draft (6/16/26), final 2026
 *   Schedules C and SE. Marked provisional in ty2026.ts until finals publish.
 */
import type {
  HomeExpense,
  PersonId,
  ScheduleCExpense,
  ScheduleEExpense,
} from '../types.ts';
import type { FormLine } from './types.ts';

const OWNERS: PersonId[] = ['taxpayer', 'spouse'];

/** Expands per-owner node ids ("schC.netProfit") onto "schC.taxpayer" / "schC.spouse". */
function perOwner(
  base: 'schC' | 'schSE' | 'f8829',
  lines: Record<string, string>
): Record<string, FormLine> {
  const out: Record<string, FormLine> = {};
  for (const owner of OWNERS) {
    for (const [id, line] of Object.entries(lines)) {
      out[`${id}.${owner}`] = { form: `${base}.${owner}`, line };
    }
  }
  return out;
}

const f1040 = (line: string): FormLine => ({ form: 'f1040', line });
const sch1 = (line: string): FormLine => ({ form: 'sch1', line });
const sch1a = (line: string): FormLine => ({ form: 'sch1a', line });
const sch2 = (line: string): FormLine => ({ form: 'sch2', line });
const sch8812 = (line: string): FormLine => ({ form: 'sch8812', line });
const f8995 = (line: string): FormLine => ({ form: 'f8995', line });
const schE = (line: string): FormLine => ({ form: 'schE', line });
const f8959 = (line: string): FormLine => ({ form: 'f8959', line });
const f8960 = (line: string): FormLine => ({ form: 'f8960', line });

/** Form 8829 lines 16-22, by home expense (standard-deduction filers; casualty losses are flagged). */
export const F8829_EXPENSE_LINES: Record<
  Exclude<HomeExpense, 'casualty_losses'>,
  string
> = {
  mortgage_interest: '16',
  real_estate_taxes: '17',
  insurance: '18',
  rent: '19',
  repairs_maintenance: '20',
  utilities: '21',
  other: '22',
};

const f8829Lines = perOwner('f8829', {
  'f8829.officeArea': '1',
  'f8829.homeArea': '2',
  'f8829.businessPct': '3',
  'f8829.grossIncomeLimit': '8',
  'f8829.homeDeductionsBusiness': '14',
  'f8829.limitAfterHomeDeductions': '15',
  ...Object.fromEntries(
    Object.entries(F8829_EXPENSE_LINES).flatMap(([cat, line]) => [
      [`f8829.expense.${cat}.direct`, `${line}:a`],
      [`f8829.expense.${cat}.indirect`, `${line}:b`],
    ])
  ),
  'f8829.operatingDirect': '23:a',
  'f8829.operatingIndirect': '23:b',
  'f8829.operatingIndirectBusiness': '24',
  'f8829.operatingCarryover': '25',
  'f8829.operatingTotal': '26',
  'f8829.operatingAllowed': '27',
  'f8829.limitAfterOperating': '28',
  'f8829.depreciation': '30',
  'f8829.depreciationCarryover': '31',
  'f8829.depreciationTotal': '32',
  'f8829.depreciationAllowed': '33',
  'f8829.totalAllowed': '34',
  'f8829.allowable': '36',
  'f8829.homeBasis': '37',
  'f8829.landValue': '38',
  'f8829.buildingBasis': '39',
  'f8829.businessBasis': '40',
  'f8829.depreciationPct': '41',
  'f8829.depreciationAllowable': '42',
  'f8829.operatingCarryoverOut': '43',
  'f8829.depreciationCarryoverOut': '44',
});

export const schEExpenseLines2025: Record<ScheduleEExpense, string> = {
  advertising: '5',
  auto_travel: '6',
  cleaning_maintenance: '7',
  commissions: '8',
  insurance: '9',
  legal_professional: '10',
  management_fees: '11',
  mortgage_interest: '12',
  other_interest: '13',
  repairs: '14',
  supplies: '15',
  taxes: '16',
  utilities: '17',
  other: '19',
};

/** 2026 Schedule E draft (5/6/26): line 13 split into 13a vehicle loan / 13b other interest. */
export const schEExpenseLines2026: Record<ScheduleEExpense, string> = {
  ...schEExpenseLines2025,
  other_interest: '13b',
};

const schETotals = {
  'schE.totalRents': schE('23a'),
  'schE.totalRoyalties': schE('23b'),
  'schE.totalMortgageInterest': schE('23c'),
  'schE.totalDepreciation': schE('23d'),
  'schE.totalExpenses': schE('23e'),
  'schE.income': schE('24'),
  'schE.losses': schE('25'),
  'schE.total': schE('26'),
};

const f8959Lines2025 = {
  'f8959.medicareWages': f8959('1'),
  'f8959.totalWages': f8959('4'),
  'f8959.wageThreshold': f8959('5'),
  'f8959.wagesOverThreshold': f8959('6'),
  'f8959.taxOnWages': f8959('7'),
  'f8959.seIncome': f8959('8'),
  'f8959.seThreshold': f8959('9'),
  'f8959.seWages': f8959('10'),
  'f8959.seThresholdReduced': f8959('11'),
  'f8959.seOverThreshold': f8959('12'),
  'f8959.taxOnSe': f8959('13'),
  'f8959.total': f8959('18'),
  'f8959.medicareWithheld': f8959('19'),
  'f8959.withholdingWages': f8959('20'),
  'f8959.regularWithholding': f8959('21'),
  'f8959.additionalWithheld': f8959('22'),
  'f8959.totalWithheld': f8959('24'),
};

const f8960Lines = {
  'f8960.taxableInterest': f8960('1'),
  'f8960.ordinaryDividends': f8960('2'),
  'f8960.businessRentalIncome': f8960('4a'),
  'f8960.nonSection1411Adjustment': f8960('4b'),
  'f8960.netBusinessRental': f8960('4c'),
  'f8960.dispositionGain': f8960('5a'),
  'f8960.netGain': f8960('5d'),
  'f8960.investmentIncome': f8960('8'),
  'f8960.deductions': f8960('11'),
  'f8960.netInvestmentIncome': f8960('12'),
  'f8960.magi': f8960('13'),
  'f8960.threshold': f8960('14'),
  'f8960.magiOverThreshold': f8960('15'),
  'f8960.taxBase': f8960('16'),
  'f8960.tax': f8960('17'),
};

function schCExpenseLines(interestLine: string): Record<string, string> {
  const lines: Record<ScheduleCExpense, string> = {
    advertising: '8',
    car_truck: '9',
    commissions: '10',
    contract_labor: '11',
    depreciation_section179: '13',
    insurance: '15',
    interest_other: interestLine,
    legal_professional: '17',
    office: '18',
    rent_equipment: '20a',
    rent_property: '20b',
    repairs: '21',
    supplies: '22',
    taxes_licenses: '23',
    travel: '24a',
    meals: '24b',
    utilities: '25',
    wages: '26',
    other: '27b',
  };
  return Object.fromEntries(
    Object.entries(lines).map(([cat, line]) => [`schC.expense.${cat}`, line])
  );
}

const schCLines = (interestLine: string) =>
  perOwner('schC', {
    'schC.grossReceipts': '1',
    'schC.returns': '2',
    'schC.grossIncome': '7',
    ...schCExpenseLines(interestLine),
    'schC.totalExpenses': '28',
    'schC.tentativeProfit': '29',
    'schC.homeOffice': '30',
    'schC.netProfit': '31',
  });

const schSELines = perOwner('schSE', {
  'se.netProfit': '2',
  'se.netEarnings': '4a',
  'se.netEarningsSubject': '4c',
  'se.ssWagesAndTips': '8a',
  'se.ssWageRoom': '9',
  'se.ssPortion': '10',
  'se.medicarePortion': '11',
  seTax: '12',
  seDeduction: '13',
});

export const formLines2025: Record<string, FormLine> = {
  wages: f1040('1a'),
  totalWages: f1040('1z'),
  taxExemptInterest: f1040('2a'),
  taxableInterest: f1040('2b'),
  qualifiedDividends: f1040('3a'),
  ordinaryDividends: f1040('3b'),
  capitalGainDistributions: f1040('7a'),
  additionalIncome: f1040('8'),
  totalIncome: f1040('9'),
  adjustments: f1040('10'),
  agi: f1040('11a'),
  standardDeduction: f1040('12e'),
  qbiDeduction: f1040('13a'),
  sch1aTotal: f1040('13b'),
  deductions: f1040('14'),
  taxableIncome: f1040('15'),
  tax: f1040('16'),
  taxBeforeCredits: f1040('18'),
  childCredits: f1040('19'),
  totalCredits: f1040('21'),
  taxAfterCredits: f1040('22'),
  otherTaxes: f1040('23'),
  totalTax: f1040('24'),
  withholdingW2: f1040('25a'),
  withholding1099: f1040('25b'),
  withholdingOther: f1040('25c'),
  totalWithholding: f1040('25d'),
  estimatedPayments: f1040('26'),
  eic: f1040('27a'),
  actc: f1040('28'),
  otherPaymentsAndCredits: f1040('32'),
  totalPayments: f1040('33'),
  overpaid: f1040('34'),
  amountOwed: f1040('37'),

  // Schedule 1 (2025)
  businessIncome: sch1('3'),
  rentalRoyaltyIncome: sch1('5'),
  otherIncome: sch1('8z'),
  totalOtherIncome: sch1('9'),
  seDeduction: sch1('15'),
  sepDeduction: sch1('16'),
  sehiDeduction: sch1('17'),
  earlyWithdrawalPenalty: sch1('18'),
  studentLoanInterestDeduction: sch1('21'),
  form1099KPersonalPortion: sch1('top'),

  // Schedule 1-A (2025)
  sch1aMagi: sch1a('3'),
  tipsDeduction: sch1a('13'),
  overtimeDeduction: sch1a('21'),
  carLoanInterestDeduction: sch1a('30'),
  seniorDeductionPerPerson: sch1a('35'),
  seniorDeduction: sch1a('37'),

  // Schedule 2 (2025)
  seTaxTotal: sch2('4'),
  'sch2.additionalMedicareTax': sch2('11'),
  'sch2.niit': sch2('12'),

  ...schETotals,
  ...f8959Lines2025,
  ...f8960Lines,
  ...f8829Lines,

  // Schedule 8812 (2025)
  ctcChildren: sch8812('4'),
  odcDependents: sch8812('6'),
  ctc: sch8812('5'),
  odc: sch8812('7'),
  ctcOdcTotal: sch8812('8'),
  ctcOdcThreshold: sch8812('9'),
  ctcOdcExcess: sch8812('10'),
  ctcOdcPhaseout: sch8812('11'),
  ctcOdcAfterPhaseout: sch8812('12'),
  creditLimit: sch8812('13'),
  'actc.unused': sch8812('16a'),
  'actc.childLimit': sch8812('16b'),
  'actc.limit': sch8812('17'),
  actcEarnedIncome: sch8812('18a'),
  'actc.earnedOverThreshold': sch8812('19'),
  'actc.earnedIncomeCredit': sch8812('20'),
  'actc.withheldTaxes': sch8812('21'),
  'actc.seDeduction': sch8812('22'),
  'actc.payrollTotal': sch8812('23'),
  'actc.eic': sch8812('24'),
  'actc.payrollNet': sch8812('25'),
  'actc.partIIB': sch8812('26'),

  // Form 8995 (2025); the per-business rows (line 1 column (c)) are placed by f8995.ts.
  qbiBusinessSum: f8995('2'),
  qbiTotal: f8995('4'),
  qbiComponent: f8995('5'),
  reitDividends: f8995('8'),
  qbiBeforeLimit: f8995('10'),
  qbiTaxableIncome: f8995('11'),
  qbiNetCapitalGain: f8995('12'),
  qbiIncomeBase: f8995('13'),
  qbiIncomeLimit: f8995('14'),

  ...schCLines('16b'),
  ...schSELines,
};

/**
 * Lines that repeat another line because v1 has nothing that would make them
 * differ (no cost of goods sold, farm income, church employee income,
 * Form 4137/8919 wages, or Puerto Rico/foreign exclusions on Schedule 8812).
 */
function copyLines(): Record<string, string> {
  const out: Record<string, string> = {
    'sch8812:1': 'agi',
    'sch8812:3': 'agi',
  };
  for (const o of OWNERS) {
    out[`schC.${o}:3`] = `schC.grossIncome.${o}`;
    out[`schC.${o}:5`] = `schC.grossIncome.${o}`;
    out[`schC.${o}:48`] = `schC.expense.other.${o}`;
    out[`schSE.${o}:3`] = `se.netProfit.${o}`;
    out[`schSE.${o}:6`] = `se.netEarningsSubject.${o}`;
    out[`schSE.${o}:8d`] = `se.ssWagesAndTips.${o}`;
  }
  return out;
}

/**
 * Descriptions for alias lines whose source node's label would describe the
 * wrong line (Schedule C line 5 is gross profit, not gross income). Keyed by
 * "<form without owner>:<line>". Aliases not listed use the node's label.
 */
export const lineAliasLabels: Record<string, string> = {
  'schC:3': 'Gross receipts less returns and allowances (line 1 minus line 2)',
  'schC:5': 'Gross profit (line 3 minus line 4)',
  'schC:48': 'Total other expenses (Part V)',
  'schSE:3': 'Combine lines 1a, 1b and 2',
  'schSE:6': 'Add lines 4c and 5b',
  'schSE:8d': 'Add lines 8a, 8b and 8c',
  'sch8812:1': 'Amount from Form 1040, line 11 (adjusted gross income)',
  'sch8812:3': 'Add lines 1 and 2d',
  'f1040:11b': 'Amount from line 11a (adjusted gross income)',
  'f1040:24c': 'Total tax (line 24a plus line 24b)',
  'f1040:32c': 'Total other payments and refundable credits',
  'sch1:10': 'Additional income (combine lines 1 through 7 and 9)',
  'sch1:26': 'Adjustments to income (add lines 11 through 23 and 25)',
  'sch2:21': 'Total other taxes',
};

/** Other places a node's value prints, for "<form>:<line>" lookups. */
export const lineAliases2025: Record<string, string> = {
  ...copyLines(),
  'f1040:11b': 'agi',
  'sch1:10': 'additionalIncome',
  'sch1:26': 'adjustments',
  'sch2:21': 'otherTaxes',
  'sch1a:38': 'sch1aTotal',
  'sch8812:14': 'childCredits',
  'sch8812:27': 'actc',
  'f8995:15': 'qbiDeduction',
  'schB:4': 'taxableInterest',
  'schB:6': 'ordinaryDividends',
  'f8829.taxpayer:7': 'f8829.businessPct.taxpayer',
  'f8829.spouse:7': 'f8829.businessPct.spouse',
};

export const formLines2026: Record<string, FormLine> = {
  ...formLines2025,
  // 2026 draft Form 1040: 13a = Schedule 1-A (line 44), 13b = QBI; 24a total tax; 32a.
  sch1aTotal: f1040('13a'),
  qbiDeduction: f1040('13b'),
  totalTax: f1040('24a'),
  otherPaymentsAndCredits: f1040('32a'),
  // 2026 Schedule 1-A draft renumbered (totals on line 44).
  sch1aMagi: sch1a('3'),
  tipsDeduction: sch1a('15'),
  overtimeDeduction: sch1a('27'),
  carLoanInterestDeduction: sch1a('36'),
  seniorDeductionPerPerson: sch1a('41'),
  seniorDeduction: sch1a('43'),
  // 2026 Form 8995 draft: line 16 minimum deduction, line 17 total.
  qbiMinimum: f8995('16'),
  // 2026 Schedule C: interest split into 16a mortgage / 16b vehicle loan / 16c other.
  ...schCLines('16c'),
  // 2026 Schedule 2 draft (4/27/26): NIIT on line 6; Additional Medicare Tax split into line 11
  // (self-employment income) and line 17b (wages), section totals 15, 17d, 20.
  'sch2.niit': sch2('6'),
  'sch2.additionalMedicareTaxSe': sch2('11'),
  'sch2.additionalIncomeTaxes': sch2('15'),
  'sch2.additionalMedicareTaxWages': sch2('17b'),
  'sch2.otherEmploymentTaxes': sch2('17d'),
  'sch2.employmentAndOtherTaxes': sch2('20'),
  // 2026 Form 8959 draft (5/27/26): RRTA moves to Part II, wages total on line 12, SE in Part IV
  // (lines 13-18), no overall total line.
  'f8959.wagesAndRrtaTax': f8959('12'),
  'f8959.seIncome': f8959('13'),
  'f8959.seThreshold': f8959('14'),
  'f8959.seWages': f8959('15'),
  'f8959.seThresholdReduced': f8959('16'),
  'f8959.seOverThreshold': f8959('17'),
  'f8959.taxOnSe': f8959('18'),
};
// Not printed in 2026: Schedule 2 has no single Additional Medicare Tax line, and Form 8959 has no
// overall total line (2026 drafts).
for (const k of ['sch2.additionalMedicareTax', 'f8959.total']) {
  delete formLines2026[k];
}

export const lineAliases2026: Record<string, string> = {
  ...copyLines(),
  'f1040:11b': 'agi',
  'f1040:24c': 'totalTax', // 24b (Form 1062) is out of scope, so 24c = 24a
  'f1040:32c': 'otherPaymentsAndCredits', // 32b (Schedule 3-A) is out of scope
  'sch1:10': 'additionalIncome',
  'sch1:26': 'adjustments',
  'sch2:21': 'otherTaxes',
  'sch1a:44': 'sch1aTotal',
  'sch8812:14': 'childCredits',
  'sch8812:27': 'actc',
  'f8995:17': 'qbiDeduction',
  'schB:4': 'taxableInterest',
  'schB:6': 'ordinaryDividends',
  'f8829.taxpayer:7': 'f8829.businessPct.taxpayer',
  'f8829.spouse:7': 'f8829.businessPct.spouse',
};
