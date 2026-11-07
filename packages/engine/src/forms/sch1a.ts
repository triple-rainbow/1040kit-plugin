/**
 * Schedule 1-A (Additional Deductions): tips, overtime, car loan interest,
 * enhanced senior deduction. MAGI = Form 1040 line 11b (Puerto Rico / Form
 * 2555 / Form 4563 exclusions are out of scope). Deducted on Form 1040 after
 * the standard deduction (2025 line 13b, 2026 line 13a).
 */
import { cite } from '../cite.ts';
import {
  bornBefore,
  ownersOnReturn,
  peopleOnReturn,
  statusOf,
} from '../facts.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0, mulRate, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { TaxFacts } from '../types.ts';

const A = (part: string) => cite('f1040s1a', part);

export function sch1aNodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const status = statusOf(facts);
  const owners = ownersOnReturn(facts);
  const p = params.sch1a;
  const hasSsn = (o: 'taxpayer' | 'spouse') =>
    (o === 'taxpayer' ? facts.taxpayer : facts.spouse)?.hasValidSsn !== false;

  return [
    defineNode({
      id: 'sch1aMagi',
      label: 'Modified adjusted gross income for Schedule 1-A',
      deps: ['agi'],
      formula:
        'Form 1040 line 11b (no excluded foreign or Puerto Rico income in v1)',
      cite: [A('Part I, lines 1-3')],
      compute: (ctx) => ctx.node('agi'),
    }),
    defineNode({
      id: 'tipsDeduction',
      label: 'Qualified tips deduction',
      deps: ['sch1aMagi'],
      formula:
        'min(qualified tips of people with a valid SSN, $25,000) - $100 x floor(max(0, MAGI - threshold) / $1,000), not below 0',
      cite: [A('Part II, lines 4-13')],
      compute: (ctx) => {
        const tips = toDollars(
          sumCents(
            owners.map((o) => {
              const c = ctx.cents(`obbba.qualifiedTips.${o}`);
              return ctx.fact<boolean>(`${o}.hasValidSsn`) === false ? 0 : c;
            })
          )
        );
        if (tips <= 0) return 0;
        const l7 = Math.min(tips, ctx.param('sch1a.tips.cap', p.tips.cap));
        const excess = max0(
          ctx.node('sch1aMagi') -
            ctx.param(
              `sch1a.tips.threshold.${status}`,
              p.tips.threshold[status]
            )
        );
        const steps = Math.floor(excess / 1000);
        return max0(
          l7 -
            steps *
              ctx.param('sch1a.tips.reductionPer1000', p.tips.reductionPer1000)
        );
      },
    }),
    defineNode({
      id: 'overtimeDeduction',
      label: 'Qualified overtime compensation deduction',
      deps: ['sch1aMagi'],
      formula:
        'min(qualified overtime of people with a valid SSN, $12,500 / $25,000 MFJ) - $100 x floor(max(0, MAGI - threshold) / $1,000), not below 0',
      cite: [A('Part III, lines 14-21')],
      compute: (ctx) => {
        const ot = toDollars(
          sumCents(
            owners.map((o) => {
              const c = ctx.cents(`obbba.qualifiedOvertime.${o}`);
              return ctx.fact<boolean>(`${o}.hasValidSsn`) === false ? 0 : c;
            })
          )
        );
        if (ot <= 0) return 0;
        const l15 = Math.min(
          ot,
          ctx.param(`sch1a.overtime.cap.${status}`, p.overtime.cap[status])
        );
        const excess = max0(
          ctx.node('sch1aMagi') -
            ctx.param(
              `sch1a.overtime.threshold.${status}`,
              p.overtime.threshold[status]
            )
        );
        return max0(
          l15 -
            Math.floor(excess / 1000) *
              ctx.param(
                'sch1a.overtime.reductionPer1000',
                p.overtime.reductionPer1000
              )
        );
      },
    }),
    defineNode({
      id: 'carLoanInterestDeduction',
      label: 'Qualified passenger vehicle loan interest deduction',
      deps: ['sch1aMagi'],
      formula:
        'new, U.S.-assembled, personal-use vehicle bought after 2024: min(interest, $10,000) - $200 x ceil(max(0, MAGI - threshold) / $1,000), not below 0',
      cite: [A('Part IV, lines 22-30')],
      compute: (ctx) => {
        const interest = toDollars(ctx.cents('obbba.carLoanInterest'));
        if (interest <= 0) return 0;
        const v = ctx.fact<{
          newVehicle?: boolean;
          finalAssemblyInUS?: boolean;
          personalUse?: boolean;
          purchaseDate?: string;
        }>('obbba.carLoanVehicle');
        if (
          !v ||
          v.newVehicle !== true ||
          v.finalAssemblyInUS !== true ||
          v.personalUse !== true
        )
          return 0;
        const after = ctx.param(
          'sch1a.carLoan.purchasedAfter',
          p.carLoan.purchasedAfter
        );
        if (v.purchaseDate && v.purchaseDate <= after) return 0;
        const l24 = Math.min(
          interest,
          ctx.param('sch1a.carLoan.cap', p.carLoan.cap)
        );
        const excess = max0(
          ctx.node('sch1aMagi') -
            ctx.param(
              `sch1a.carLoan.threshold.${status}`,
              p.carLoan.threshold[status]
            )
        );
        return max0(
          l24 -
            Math.ceil(excess / 1000) *
              ctx.param(
                'sch1a.carLoan.reductionPer1000',
                p.carLoan.reductionPer1000
              )
        );
      },
    }),
    defineNode({
      id: 'seniorDeductionPerPerson',
      label: 'Enhanced deduction for seniors, per qualifying person',
      deps: ['sch1aMagi'],
      formula: 'max(0, $6,000 - 6% x max(0, MAGI - threshold))',
      cite: [A('Part V, lines 31-35')],
      compute: (ctx) => {
        const excess = max0(
          ctx.node('sch1aMagi') -
            ctx.param(
              `sch1a.senior.threshold.${status}`,
              p.senior.threshold[status]
            )
        );
        const l34 = mulRate(
          excess,
          ctx.param('sch1a.senior.reductionPpm', p.senior.reductionPpm)
        );
        return max0(ctx.param('sch1a.senior.amount', p.senior.amount) - l34);
      },
    }),
    defineNode({
      id: 'seniorDeduction',
      label: 'Enhanced deduction for seniors',
      deps: ['seniorDeductionPerPerson'],
      formula:
        'line 35 for each person on the return with a valid SSN born before January 2 of (tax year - 64)',
      cite: [A('Part V, lines 36a-37')],
      compute: (ctx) => {
        const cutoff = ctx.param('age65BornBefore', params.age65BornBefore);
        let count = 0;
        for (const person of peopleOnReturn(facts)) {
          const dob = ctx.fact<string>(`${person.id}.dateOfBirth`);
          if (bornBefore(dob, cutoff) && hasSsn(person.id)) {
            ctx.fact(`${person.id}.hasValidSsn`);
            count++;
          }
        }
        return count * ctx.node('seniorDeductionPerPerson');
      },
    }),
    defineNode({
      id: 'sch1aTotal',
      label: 'Additional deductions from Schedule 1-A',
      deps: [
        'tipsDeduction',
        'overtimeDeduction',
        'carLoanInterestDeduction',
        'seniorDeduction',
      ],
      formula: 'tips + overtime + car loan interest + senior deductions',
      cite: [
        A('Part VI'),
        cite('i1040gi', `Line ${params.formLines.sch1aTotal?.line ?? '13b'}`),
      ],
      compute: (ctx) =>
        ctx.node('tipsDeduction') +
        ctx.node('overtimeDeduction') +
        ctx.node('carLoanInterestDeduction') +
        ctx.node('seniorDeduction'),
    }),
  ];
}
