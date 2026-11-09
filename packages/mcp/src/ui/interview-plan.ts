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
      'Your income is done. Now we work on lowering your taxable income and your tax: deductions and credits. These questions take a little patience, and each one can reduce what you owe or raise your refund.',
  },
};

const DEDUCTION_PATHS = [
  // Part IV follows a car expense claimed while finding deductions.
  /\.vehicleUse\./,
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
    path: 'screening.hasDependents',
    label: 'A child or relative lives with you or depends on you',
  },
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

/** One field of a grouped question: its own fact path and answer type. */
export interface GroupField {
  path: string;
  label: string;
  answer: AnswerSpec;
}

export type PlannedAnswer =
  | AnswerSpec
  | {
      kind: 'multiselect';
      options: { path: string; label: string }[];
      other?: { path: string; label: string };
      noneLabel: string;
    }
  | {
      /** Several facts about one thing (a dependent, a business), asked as one form. */
      kind: 'group';
      fields: GroupField[];
      /** For new people: the same fields again for the next id ("{id}" in each path). */
      addAnother?: { label: string; fields: GroupField[]; nextIndex: number };
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

/** What a grouped question is for, by group kind. */
const GROUP_WHY: Record<string, string> = {
  dependent:
    'These details decide which credits this person can bring, such as the child tax credit.',
  business: 'Your business form (Schedule C) asks these about the business.',
  vehicle:
    'Your business form asks these when you claim car or truck expenses.',
};

/** Short labels for fields shown inside a group (the engine's question otherwise). */
const FIELD_LABELS: Record<string, string> = {
  dateOfBirth: 'Date of birth',
  relationship: 'How they are related to you',
  monthsLivedWithTaxpayer: 'Months they lived with you',
  hasValidSsn: 'Has a Social Security number valid for work',
  fullTimeStudent: 'Full-time student for at least 5 months',
  grossIncome: 'Their income this year',
  providedOverHalfOwnSupport: 'Paid more than half of their own support',
  firstName: 'First name',
  lastName: 'Last name',
};

/** The fields asked about a person the user is adding as a dependent. */
function newPersonFields(id: string): GroupField[] {
  const f = (path: string, key: string): GroupField => ({
    path,
    label: FIELD_LABELS[key]!,
    answer: answerSpec(path),
  });
  const base = `dependents[${id}]`;
  return [
    {
      path: `identity.dependents[${id}].firstName`,
      label: FIELD_LABELS.firstName!,
      answer: { kind: 'text' },
    },
    {
      path: `identity.dependents[${id}].lastName`,
      label: FIELD_LABELS.lastName!,
      answer: { kind: 'text' },
    },
    f(`${base}.relationship`, 'relationship'),
    f(`${base}.dateOfBirth`, 'dateOfBirth'),
    f(`${base}.monthsLivedWithTaxpayer`, 'monthsLivedWithTaxpayer'),
    f(`${base}.hasValidSsn`, 'hasValidSsn'),
    f(`${base}.providedOverHalfOwnSupport`, 'providedOverHalfOwnSupport'),
  ];
}

/**
 * Compact forms: every open question about one dependent, one business's
 * Schedule C, or its vehicle becomes one grouped question, and "who depends
 * on you" becomes a form for each new person. Each field keeps its own fact
 * path, so saving is the same profile_set call as before.
 */
export function groupQuestions(
  planned: PlannedQuestion[],
  ctx: {
    dependentIds: string[];
    names: Record<string, string | undefined>;
  }
): PlannedQuestion[] {
  const groups = new Map<
    string,
    { title: string; members: PlannedQuestion[] }
  >();
  const out: PlannedQuestion[] = [];
  const keyOf = (q: PlannedQuestion): [string, string] | null => {
    let m = /^dependents\[([^\]]+)\]\./.exec(q.path);
    if (m) {
      const i = ctx.dependentIds.indexOf(m[1]!);
      const name = ctx.names[m[1]!] ?? `your dependent #${i + 1}`;
      return [`dependent:${m[1]}`, `About ${name}`];
    }
    m = /^businesses\[(taxpayer|spouse)\]\.vehicleUse\./.exec(q.path);
    if (m)
      return [
        `vehicle:${m[1]}`,
        m[1] === 'spouse'
          ? 'Your spouse’s business vehicle'
          : 'Your business vehicle',
      ];
    m = /^businesses\[(taxpayer|spouse)\]\./.exec(q.path);
    if (m)
      return [
        `business:${m[1]}`,
        m[1] === 'spouse' ? 'Your spouse’s business' : 'Your business',
      ];
    return null;
  };
  for (const q of planned) {
    if (q.path === 'dependents' && q.answer.kind === 'open') {
      const next = ctx.dependentIds.length + 1;
      out.push({
        ...q,
        answer: {
          kind: 'group',
          fields: newPersonFields(`dependent_${next}`),
          addAnother: {
            label: 'Add another person',
            fields: newPersonFields('{id}'),
            nextIndex: next + 1,
          },
        },
      });
      continue;
    }
    const key = keyOf(q);
    if (!key) {
      out.push(q);
      continue;
    }
    const g = groups.get(key[0]);
    if (g) g.members.push(q);
    else {
      const entry = { title: key[1], members: [q] };
      groups.set(key[0], entry);
      out.push({ ...q, path: key[0] }); // placeholder, replaced below
    }
  }
  return out.map((q) => {
    const g = groups.get(q.path);
    if (!g) return q;
    if (g.members.length === 1) return g.members[0]!;
    const first = g.members[0]!;
    return {
      path: q.path,
      question: g.title,
      why: GROUP_WHY[q.path.split(':')[0]!] ?? first.why,
      blocking: g.members.some((m) => m.blocking),
      priority: Math.min(...g.members.map((m) => m.priority)),
      phase: first.phase,
      answer: {
        kind: 'group',
        fields: g.members.map((m) => {
          const suffix = m.path.slice(m.path.lastIndexOf('.') + 1);
          return {
            path: m.path,
            label: q.path.startsWith('dependent:')
              ? (FIELD_LABELS[suffix] ?? m.question)
              : m.question,
            answer: m.answer as AnswerSpec,
          };
        }),
      },
    };
  });
}
