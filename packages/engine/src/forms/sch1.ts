/**
 * Schedule 1 (Additional Income and Adjustments to Income) and Schedule 2
 * Part II (self-employment tax only in v1).
 */
import { cite } from '../cite.ts';
import { ownedOnReturn, peopleOnReturn, statusOf } from '../facts.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0, mulRate, roundDiv, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { TaxFacts } from '../types.ts';
import { businessesOnReturn } from './schC.ts';

const S1 = (line: string) => cite('i1040gi', `Schedule 1, Line ${line}`);

export function sch1Nodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const owners = businessesOnReturn(facts).map((b) => b.owner);
  const miscs = ownedOnReturn(facts, facts.misc1099s).filter(
    (m) => m.treatAsBusiness !== true
  );
  const ks = ownedOnReturn(facts, facts.k1099s);
  const ints = ownedOnReturn(facts, facts.int1099s);
  const e1098s = ownedOnReturn(facts, facts.e1098s ?? []);
  const status = statusOf(facts);
  const sl = params.studentLoanInterest;
  const sum = (ids: string[]) => (ctx: { node(id: string): number }) =>
    ids.reduce((s, i) => s + ctx.node(i), 0);

  const perOwner: NodeDef[] = [];
  for (const o of owners) {
    perOwner.push(
      defineNode({
        id: `sepDeduction.${o}`,
        label: 'Self-employed SEP contribution deduction',
        deps: [`schC.netProfit.${o}`, `seDeduction.${o}`],
        formula:
          'min(contribution, 20% x (net profit - deductible SE tax), §415(c) limit) — Pub. 560 Deduction Worksheet for Self-Employed',
        cite: [S1('16'), cite('p560', 'Deduction Worksheet for Self-Employed')],
        compute: (ctx) => {
          const paid = toDollars(
            ctx.cents(`adjustments.sepContributions.${o}`)
          );
          if (paid <= 0) return 0;
          const earnings = max0(
            ctx.node(`schC.netProfit.${o}`) - ctx.node(`seDeduction.${o}`)
          );
          const rate = ctx.param(
            'sep.selfEmployedRatePpm',
            params.sep.selfEmployedRatePpm
          );
          const cap = ctx.param('sep.annualLimit', params.sep.annualLimit);
          return Math.min(paid, mulRate(earnings, rate), cap);
        },
      }),
      defineNode({
        id: `sehiDeduction.${o}`,
        label: 'Self-employed health insurance deduction',
        deps: [`schC.netProfit.${o}`, `seDeduction.${o}`, `sepDeduction.${o}`],
        formula:
          'min(premiums paid, net profit - deductible SE tax - SEP deduction)',
        cite: [
          S1('17'),
          cite('i1040gi', 'Self-Employed Health Insurance Deduction Worksheet'),
        ],
        compute: (ctx) => {
          const paid = toDollars(
            ctx.cents(`adjustments.selfEmployedHealthInsurance.${o}`)
          );
          if (paid <= 0) return 0;
          const limit = max0(
            ctx.node(`schC.netProfit.${o}`) -
              ctx.node(`seDeduction.${o}`) -
              ctx.node(`sepDeduction.${o}`)
          );
          return Math.min(paid, limit);
        },
      })
    );
  }

  return [
    ...perOwner,
    defineNode({
      id: 'businessIncome',
      label: 'Business income or (loss)',
      deps: owners.map((o) => `schC.netProfit.${o}`),
      formula: 'sum(Schedule C line 31)',
      cite: [S1('3')],
      compute: sum(owners.map((o) => `schC.netProfit.${o}`)),
    }),
    defineNode({
      id: 'otherIncome',
      label: 'Other income (Form 1099-MISC box 3, not business)',
      deps: [],
      formula: 'sum(1099-MISC box 3) where not Schedule C receipts',
      cite: [S1('8z')],
      compute: (ctx) =>
        toDollars(
          sumCents(
            miscs.map((m) => ctx.cents(`misc1099s[${m.id}].otherIncome`))
          )
        ),
    }),
    defineNode({
      id: 'form1099KPersonalPortion',
      label:
        'Form 1099-K amounts included in error or for personal items sold at a loss',
      deps: [],
      formula:
        'sum(personal portion of 1099-K box 1a), entered at the top of Schedule 1 (not income)',
      cite: [cite('i1040gi', 'Schedule 1, Form(s) 1099-K')],
      compute: (ctx) =>
        toDollars(
          sumCents(ks.map((k) => ctx.cents(`k1099s[${k.id}].personalPortion`)))
        ),
    }),
    defineNode({
      id: 'totalOtherIncome',
      label: 'Total other income',
      deps: ['otherIncome'],
      formula: 'lines 8a through 8z',
      cite: [S1('9')],
      compute: (ctx) => ctx.node('otherIncome'),
    }),
    defineNode({
      id: 'additionalIncome',
      label: 'Additional income from Schedule 1',
      deps: ['businessIncome', 'rentalRoyaltyIncome', 'totalOtherIncome'],
      formula: 'Schedule 1 line 3 + line 5 + line 9',
      cite: [S1('10'), cite('i1040gi', 'Line 8')],
      compute: (ctx) =>
        ctx.node('businessIncome') +
        ctx.node('rentalRoyaltyIncome') +
        ctx.node('totalOtherIncome'),
    }),
    defineNode({
      id: 'seDeduction',
      label: 'Deductible part of self-employment tax',
      deps: owners.map((o) => `seDeduction.${o}`),
      formula: 'sum(Schedule SE line 13)',
      cite: [S1('15')],
      compute: sum(owners.map((o) => `seDeduction.${o}`)),
    }),
    defineNode({
      id: 'sepDeduction',
      label: 'Self-employed SEP, SIMPLE, and qualified plans',
      deps: owners.map((o) => `sepDeduction.${o}`),
      formula: 'sum of SEP deductions',
      cite: [S1('16')],
      compute: sum(owners.map((o) => `sepDeduction.${o}`)),
    }),
    defineNode({
      id: 'sehiDeduction',
      label: 'Self-employed health insurance deduction',
      deps: owners.map((o) => `sehiDeduction.${o}`),
      formula: 'sum of self-employed health insurance deductions',
      cite: [S1('17')],
      compute: sum(owners.map((o) => `sehiDeduction.${o}`)),
    }),
    defineNode({
      id: 'earlyWithdrawalPenalty',
      label: 'Penalty on early withdrawal of savings',
      deps: [],
      formula: 'sum(1099-INT box 2)',
      cite: [S1('18')],
      compute: (ctx) =>
        toDollars(
          sumCents(
            ints.map((i) =>
              ctx.cents(`int1099s[${i.id}].earlyWithdrawalPenalty`)
            )
          )
        ),
    }),
    defineNode({
      id: 'studentLoan.interestPaid',
      label: 'Qualified student loan interest paid (up to $2,500)',
      deps: [],
      formula: 'min($2,500, sum(1098-E box 1) + interest paid with no 1098-E)',
      cite: [
        cite(
          'i1040gi',
          'Student Loan Interest Deduction Worksheet—Schedule 1, Line 21, line 1'
        ),
        cite('p970', 'Student Loan Interest Deduction'),
      ],
      compute: (ctx) => {
        const paid = toDollars(
          sumCents([
            ...e1098s.map((e) => ctx.cents(`e1098s[${e.id}].interest`)),
            ctx.cents('adjustments.studentLoanInterestOther'),
          ])
        );
        return Math.min(
          max0(paid),
          ctx.param('studentLoanInterest.cap', sl.cap)
        );
      },
    }),
    defineNode({
      id: 'studentLoan.magi',
      label: 'Modified AGI for the student loan interest deduction',
      deps: [
        'totalIncome',
        'seDeduction',
        'sepDeduction',
        'sehiDeduction',
        'earlyWithdrawalPenalty',
      ],
      formula:
        'Form 1040 line 9 - Schedule 1 lines 11 through 20, 23 and 25 (worksheet lines 2-4)',
      cite: [
        cite(
          'i1040gi',
          'Student Loan Interest Deduction Worksheet—Schedule 1, Line 21, lines 2-4'
        ),
      ],
      compute: (ctx) =>
        ctx.node('totalIncome') -
        ctx.node('seDeduction') -
        ctx.node('sepDeduction') -
        ctx.node('sehiDeduction') -
        ctx.node('earlyWithdrawalPenalty'),
    }),
    defineNode({
      id: 'studentLoan.phaseoutRatio',
      label: 'Phase-out ratio, in thousandths (1000 = 1.000)',
      deps: ['studentLoan.magi'],
      formula:
        '(MAGI - $85,000 [$170,000 MFJ 2025; $175,000 MFJ 2026]) / $15,000 ($30,000 MFJ), rounded to three places, at most 1.000',
      cite: [
        cite(
          'i1040gi',
          'Student Loan Interest Deduction Worksheet—Schedule 1, Line 21, lines 5-7'
        ),
      ],
      compute: (ctx) => {
        const start = ctx.param(
          `studentLoanInterest.phaseoutStart.${status}`,
          sl.phaseoutStart[status]
        );
        const range = ctx.param(
          `studentLoanInterest.phaseoutRange.${status}`,
          sl.phaseoutRange[status]
        );
        const excess = max0(ctx.node('studentLoan.magi') - start);
        if (excess === 0) return 0;
        return Math.min(1000, roundDiv(excess * 1000, range));
      },
    }),
    defineNode({
      id: 'studentLoanInterestDeduction',
      label: 'Student loan interest deduction',
      deps: ['studentLoan.interestPaid', 'studentLoan.phaseoutRatio'],
      formula:
        'line 1 - line 1 x line 7; 0 if you (or your spouse) can be claimed as a dependent, or the loan is not a qualified student loan you are legally obligated to pay',
      cite: [
        S1('21'),
        cite(
          'i1040gi',
          'Student Loan Interest Deduction Worksheet—Schedule 1, Line 21, lines 8-9'
        ),
        cite('p970', 'Student Loan Interest Deduction'),
      ],
      compute: (ctx) => {
        const l1 = ctx.node('studentLoan.interestPaid');
        if (l1 <= 0) return 0;
        for (const person of peopleOnReturn(facts)) {
          if (
            ctx.fact<boolean>(`${person.id}.canBeClaimedAsDependent`) === true
          )
            return 0;
        }
        if (ctx.fact<boolean>('studentLoan.legallyObligated') === false)
          return 0;
        if (ctx.fact<boolean>('studentLoan.qualifiedLoan') === false) return 0;
        const l8 = roundDiv(l1 * ctx.node('studentLoan.phaseoutRatio'), 1000);
        return max0(l1 - l8);
      },
    }),
    defineNode({
      id: 'adjustments',
      label: 'Adjustments to income',
      deps: [
        'seDeduction',
        'sepDeduction',
        'sehiDeduction',
        'earlyWithdrawalPenalty',
        'studentLoanInterestDeduction',
      ],
      formula: 'Schedule 1 lines 15 + 16 + 17 + 18 + 21',
      cite: [S1('26'), cite('i1040gi', 'Line 10')],
      compute: sum([
        'seDeduction',
        'sepDeduction',
        'sehiDeduction',
        'earlyWithdrawalPenalty',
        'studentLoanInterestDeduction',
      ]),
    }),
    defineNode({
      id: 'seTaxTotal',
      label: 'Self-employment tax',
      deps: owners.map((o) => `seTax.${o}`),
      formula: 'sum(Schedule SE line 12)',
      cite: [cite('i1040gi', 'Schedule 2, Line 4')],
      compute: sum(owners.map((o) => `seTax.${o}`)),
    }),
    defineNode({
      id: 'sch2.additionalMedicareTax',
      label: 'Additional Medicare Tax (Form 8959)',
      deps: ['additionalMedicareTax'],
      formula: 'Form 8959 line 18',
      cite: [cite('i1040gi', 'Schedule 2, Line 11'), cite('i8959', 'Line 18')],
      compute: (ctx) => ctx.node('additionalMedicareTax'),
    }),
    defineNode({
      id: 'sch2.additionalMedicareTaxSe',
      label: 'Additional Medicare Tax on self-employment income (Form 8959)',
      deps: ['f8959.taxOnSe'],
      formula: 'Form 8959 (2026 draft) line 18',
      cite: [cite('f8959', '2026 draft, Part IV')],
      compute: (ctx) => ctx.node('f8959.taxOnSe'),
    }),
    defineNode({
      id: 'sch2.additionalMedicareTaxWages',
      label:
        'Additional Medicare Tax on Medicare wages and RRTA compensation (Form 8959)',
      deps: ['f8959.wagesAndRrtaTax'],
      formula: 'Form 8959 (2026 draft) line 12',
      cite: [cite('f8959', '2026 draft, Part III')],
      compute: (ctx) => ctx.node('f8959.wagesAndRrtaTax'),
    }),
    defineNode({
      id: 'sch2.niit',
      label: 'Net investment income tax (Form 8960)',
      deps: ['niit'],
      formula: 'Form 8960 line 17',
      cite: [cite('i1040gi', 'Schedule 2, Line 12'), cite('i8960', 'Line 17')],
      compute: (ctx) => ctx.node('niit'),
    }),
    defineNode({
      id: 'sch2.additionalIncomeTaxes',
      label: 'Additional income taxes (2026 Schedule 2 Section A total)',
      deps: ['seTaxTotal', 'sch2.niit', 'sch2.additionalMedicareTaxSe'],
      formula:
        '2026 Schedule 2 lines 4 + 6 + 11 (other Section A lines not supported)',
      cite: [cite('f1040', '2026 Schedule 2 draft, line 15')],
      compute: sum(['seTaxTotal', 'sch2.niit', 'sch2.additionalMedicareTaxSe']),
    }),
    defineNode({
      id: 'sch2.otherEmploymentTaxes',
      label: 'Other employment taxes (2026 Schedule 2 line 17d)',
      deps: ['sch2.additionalMedicareTaxWages'],
      formula: '2026 Schedule 2 line 17b (17a, 17c not supported)',
      cite: [cite('f1040', '2026 Schedule 2 draft, line 17d')],
      compute: sum(['sch2.additionalMedicareTaxWages']),
    }),
    defineNode({
      id: 'sch2.employmentAndOtherTaxes',
      label:
        'Total additional employment and other taxes (2026 Schedule 2 line 20)',
      deps: ['sch2.otherEmploymentTaxes'],
      formula: '2026 Schedule 2 lines 16c + 17d + 18 + 19c (only 17d in v1)',
      cite: [cite('f1040', '2026 Schedule 2 draft, line 20')],
      compute: sum(['sch2.otherEmploymentTaxes']),
    }),
    defineNode({
      id: 'otherTaxes',
      label: 'Other taxes, including self-employment tax, from Schedule 2',
      deps: ['seTaxTotal', 'additionalMedicareTax', 'niit'],
      formula:
        'Schedule 2 line 21: SE tax + Additional Medicare Tax + net investment income tax',
      cite: [
        cite('i1040gi', 'Schedule 2, Line 21'),
        cite('i1040gi', 'Line 23'),
      ],
      compute: sum(['seTaxTotal', 'additionalMedicareTax', 'niit']),
    }),
  ];
}
