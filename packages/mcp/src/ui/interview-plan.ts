/**
 * How interview_next presents the engine's open questions:
 *
 * - Two phases. "income" (you, your household and your income) comes first;
 *   "deductions" (questions that can lower the tax) only once the income
 *   phase has nothing left, with a short intro so the user knows why this
 *   part has more questions.
 * - The yes/no situation screening (out-of-scope topics, rentals, student
 *   loan interest, digital assets) becomes one "check all that apply"
 *   question. Saving it sets every listed path: true for checked, false for
 *   the rest (outOfScope.other takes a list of short descriptions).
 *
 * Presentation only: the engine still owns which facts are needed.
 */
import type { MissingFact } from '@1040kit/engine';

import { answerSpec, type AnswerSpec } from './answers.ts';

export type Phase = 'income' | 'deductions';

export const PHASES: Record<Phase, { title: string; intro: string }> = {
  income: {
    title: 'You and your income',
    intro:
      'First, who is on the return and what you earned. Most of it comes from your documents; these questions fill the gaps.',
  },
  deductions: {
    title: 'Deductions and credits',
    intro:
      'Your income is done. Now we work on lowering your taxable income and your tax: deductions and credits. This part has the most questions, and each one can reduce what you owe or raise your refund.',
  },
};

const DEDUCTION_PATHS = [
  /^obbba\./,
  /^e1098s/,
  /^studentLoan\./,
  /^eitc\./,
  /\.livedInUsOverHalfYear$/,
  /^taxpayer\.qualifyingChildOfAnother$/,
];

export function phaseOf(path: string): Phase {
  return DEDUCTION_PATHS.some((r) => r.test(path)) ? 'deductions' : 'income';
}

/** Situation screening: path → checkbox label. The order is the order shown. */
export const SITUATIONS: { path: string; label: string }[] = [
  {
    path: 'screening.hasRentalOrRoyaltyIncome',
    label: 'Rent from a property, or royalties',
  },
  {
    path: 'screening.paidStudentLoanInterest',
    label: 'Paid student loan interest (Form 1098-E)',
  },
  {
    path: 'outOfScope.retirementDistributions',
    label: 'Money from a retirement plan, pension or IRA (Form 1099-R)',
  },
  {
    path: 'outOfScope.socialSecurityBenefits',
    label: 'Social Security benefits (Form SSA-1099)',
  },
  {
    path: 'outOfScope.stockOrCryptoSales',
    label: 'Sold stocks, funds or crypto (Form 1099-B)',
  },
  {
    path: 'digitalAssetActivity',
    label: 'Received, sold or swapped crypto or other digital assets',
  },
  {
    path: 'outOfScope.unemploymentCompensation',
    label: 'Unemployment benefits (Form 1099-G)',
  },
  {
    path: 'outOfScope.hsa',
    label: 'A health savings account (HSA): money in or out',
  },
  {
    path: 'outOfScope.educationExpenses',
    label: 'College tuition, and you want an education credit (Form 1098-T)',
  },
  {
    path: 'outOfScope.k1Income',
    label: 'A Schedule K-1 from a partnership, S corporation, estate or trust',
  },
  {
    path: 'outOfScope.foreignIncomeOrAccounts',
    label: 'Income, taxes paid or bank accounts outside the U.S.',
  },
  {
    path: 'outOfScope.wantsToItemize',
    label:
      'Want to itemize deductions instead of taking the standard deduction',
  },
  {
    path: 'outOfScope.marriedFilingSeparately',
    label: 'Married, and filing separately from your spouse',
  },
];

export const OTHER_SITUATION = {
  path: 'outOfScope.other',
  label:
    'Something else, such as gambling winnings, alimony or a household employee',
};

export const SITUATIONS_PATH = 'situations';

export type PlannedAnswer =
  | AnswerSpec
  | {
      kind: 'multiselect';
      options: { path: string; label: string }[];
      other?: { path: string; label: string };
      noneLabel: string;
    };

export interface PlannedQuestion {
  path: string;
  question: string;
  why: string;
  blocking: boolean;
  priority: number;
  phase: Phase;
  answer: PlannedAnswer;
}

const SITUATION_PATHS = new Set([
  ...SITUATIONS.map((s) => s.path),
  OTHER_SITUATION.path,
]);

/** The open questions as presented: situations merged, sorted within each phase. */
export function planQuestions(
  open: MissingFact[],
  taxYear: number
): PlannedQuestion[] {
  const situations = open.filter((m) => SITUATION_PATHS.has(m.path));
  const rest = open.filter((m) => !SITUATION_PATHS.has(m.path));
  const out: PlannedQuestion[] = rest.map((m) => ({
    ...m,
    phase: phaseOf(m.path),
    answer: answerSpec(m.path),
  }));
  if (situations.length > 0) {
    const want = new Set(situations.map((s) => s.path));
    out.push({
      path: SITUATIONS_PATH,
      question: `Did any of these happen to you (or your spouse) in ${taxYear}? Check all that apply.`,
      why: 'Some of these 1040kit handles, and some it can’t include yet. Knowing now saves you from finding out at the end.',
      blocking: true,
      // Asked first: a yes here can mean 1040kit can't finish the return.
      priority: -1,
      phase: 'income',
      answer: {
        kind: 'multiselect',
        options: SITUATIONS.filter((s) => want.has(s.path)),
        ...(want.has(OTHER_SITUATION.path) ? { other: OTHER_SITUATION } : {}),
        noneLabel: 'None of these',
      },
    });
  }
  const order: Phase[] = ['income', 'deductions'];
  return out.sort(
    (a, b) =>
      order.indexOf(a.phase) - order.indexOf(b.phase) ||
      Number(b.blocking) - Number(a.blocking) ||
      a.priority - b.priority
  );
}
