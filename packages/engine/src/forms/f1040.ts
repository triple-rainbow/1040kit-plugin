/**
 * Form 1040 core lines. Nodes owned by schedules (additionalIncome,
 * adjustments, qbiDeduction, sch1aTotal, childCredits, otherTaxes, actc,
 * businessIncome, seDeduction) are defined in their own form modules.
 */
import { cite } from '../cite.ts';
import {
  bornBefore,
  ownedOnReturn,
  peopleOnReturn,
  statusOf,
} from '../facts.ts';
import { defineNode, type NodeContext, type NodeDef } from '../graph.ts';
import { max0, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import { taxWithQdcg } from '../tax/qdcg.ts';
import { taxOnOrdinary } from '../tax/table.ts';
import type { TaxFacts } from '../types.ts';

const L = (line: string) => cite('i1040gi', `Line ${line}`);

/** Sum a cents fact over items, adding cents first and rounding the total. */
function sumFacts<T extends { id: string }>(
  ctx: NodeContext,
  arrayName: string,
  items: T[],
  field: string
): number {
  return toDollars(
    sumCents(items.map((i) => ctx.cents(`${arrayName}[${i.id}].${field}`)))
  );
}

export function f1040Nodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const status = statusOf(facts);
  const w2s = ownedOnReturn(facts, facts.w2s);
  const ints = ownedOnReturn(facts, facts.int1099s);
  const divs = ownedOnReturn(facts, facts.div1099s);
  const necs = ownedOnReturn(facts, facts.nec1099s);
  const miscs = ownedOnReturn(facts, facts.misc1099s);
  const ks = ownedOnReturn(facts, facts.k1099s);

  return [
    defineNode({
      id: 'wages',
      label: 'Wages from Form(s) W-2, box 1',
      deps: [],
      formula: 'sum(W-2 box 1), cents added before rounding',
      cite: [L('1a')],
      compute: (ctx) => sumFacts(ctx, 'w2s', w2s, 'wages'),
    }),
    defineNode({
      id: 'totalWages',
      label: 'Total wages (lines 1a through 1h)',
      deps: ['wages'],
      formula: 'line 1a (lines 1b-1h are not supported in v1)',
      cite: [L('1z')],
      compute: (ctx) => ctx.node('wages'),
    }),
    defineNode({
      id: 'taxExemptInterest',
      label: 'Tax-exempt interest',
      deps: [],
      formula: 'sum(1099-INT box 8) + sum(1099-DIV box 12)',
      cite: [L('2a')],
      compute: (ctx) =>
        toDollars(
          sumCents([
            ...ints.map((i) =>
              ctx.cents(`int1099s[${i.id}].taxExemptInterest`)
            ),
            ...divs.map((d) =>
              ctx.cents(`div1099s[${d.id}].exemptInterestDividends`)
            ),
          ])
        ),
    }),
    defineNode({
      id: 'taxableInterest',
      label: 'Taxable interest',
      deps: [],
      formula: 'sum(1099-INT box 1 + box 3)',
      cite: [L('2b'), cite('i1040sb', 'Part I, Line 1')],
      compute: (ctx) =>
        toDollars(
          sumCents(
            ints.flatMap((i) => [
              ctx.cents(`int1099s[${i.id}].interest`),
              ctx.cents(`int1099s[${i.id}].usSavingsBondInterest`),
            ])
          )
        ),
    }),
    defineNode({
      id: 'qualifiedDividends',
      label: 'Qualified dividends',
      deps: [],
      formula: 'sum(1099-DIV box 1b)',
      cite: [L('3a')],
      compute: (ctx) => sumFacts(ctx, 'div1099s', divs, 'qualifiedDividends'),
    }),
    defineNode({
      id: 'ordinaryDividends',
      label: 'Ordinary dividends',
      deps: [],
      formula: 'sum(1099-DIV box 1a)',
      cite: [L('3b')],
      compute: (ctx) => sumFacts(ctx, 'div1099s', divs, 'ordinaryDividends'),
    }),
    defineNode({
      id: 'capitalGainDistributions',
      label: 'Capital gain distributions (Schedule D not required)',
      deps: [],
      formula: 'sum(1099-DIV box 2a)',
      cite: [L('7a'), cite('i1040gi', 'Line 7a, Exception 1')],
      compute: (ctx) =>
        sumFacts(ctx, 'div1099s', divs, 'capitalGainDistributions'),
    }),
    defineNode({
      id: 'totalIncome',
      label: 'Total income',
      deps: [
        'totalWages',
        'taxableInterest',
        'ordinaryDividends',
        'capitalGainDistributions',
        'additionalIncome',
      ],
      formula: 'line 1z + 2b + 3b + 7a + 8',
      cite: [L('9')],
      compute: (ctx) =>
        ctx.node('totalWages') +
        ctx.node('taxableInterest') +
        ctx.node('ordinaryDividends') +
        ctx.node('capitalGainDistributions') +
        ctx.node('additionalIncome'),
    }),
    defineNode({
      id: 'agi',
      label: 'Adjusted gross income',
      deps: ['totalIncome', 'adjustments'],
      formula: 'line 9 - line 10',
      cite: [L('11a')],
      compute: (ctx) => ctx.node('totalIncome') - ctx.node('adjustments'),
    }),
    defineNode({
      id: 'earnedIncome',
      label: 'Earned income (standard deduction of a dependent, ACTC, EIC)',
      deps: ['totalWages', 'businessIncome', 'seDeduction'],
      formula: 'line 1z + Schedule 1 line 3 - Schedule 1 line 15',
      cite: [
        cite('i1040gi', 'Standard Deduction Worksheet for Dependents—Line 12e'),
        cite('i1040s8', 'Line 18a'),
        cite('i1040gi', 'Worksheet B—2025 EIC —Lines 27a, Part 4'),
      ],
      compute: (ctx) =>
        ctx.node('totalWages') +
        ctx.node('businessIncome') -
        ctx.node('seDeduction'),
    }),
    defineNode({
      id: 'standardDeduction',
      label: 'Standard deduction',
      deps: ['earnedIncome'],
      formula:
        'basic amount for filing status (dependent: max(minimum, earned income + add-on), capped at basic) + additional amount per 65+/blind box',
      cite: [
        L('12e'),
        cite(
          'i1040gi',
          'Standard Deduction Chart for People Who Were Born Before January 2 of the 65th Year, or Were Blind'
        ),
        cite('rp202440', '§3.15'),
        cite('pl11921', '§70102'),
      ],
      compute: (ctx) => {
        const basic = ctx.param(
          `standardDeduction.${status}`,
          params.standardDeduction[status]
        );
        const people = peopleOnReturn(facts);
        let boxes = 0;
        for (const p of people) {
          const dob = ctx.fact<string>(`${p.id}.dateOfBirth`);
          if (
            bornBefore(
              dob,
              ctx.param('age65BornBefore', params.age65BornBefore)
            )
          )
            boxes++;
          if (ctx.fact<boolean>(`${p.id}.blind`) === true) boxes++;
        }
        const addOn =
          status === 'mfj'
            ? ctx.param(
                'additionalStdDeduction.married',
                params.additionalStdDeduction.married
              )
            : ctx.param(
                'additionalStdDeduction.unmarried',
                params.additionalStdDeduction.unmarried
              );
        const isDependent = people.some(
          (p) => ctx.fact<boolean>(`${p.id}.canBeClaimedAsDependent`) === true
        );
        let base = basic;
        if (isDependent) {
          const min = ctx.param(
            'dependentStdDeduction.minimum',
            params.dependentStdDeduction.minimum
          );
          const add = ctx.param(
            'dependentStdDeduction.earnedIncomeAddOn',
            params.dependentStdDeduction.earnedIncomeAddOn
          );
          base = Math.min(basic, Math.max(min, ctx.node('earnedIncome') + add));
        }
        return base + boxes * addOn;
      },
    }),
    defineNode({
      id: 'deductions',
      label: 'Total deductions',
      deps: ['standardDeduction', 'qbiDeduction', 'sch1aTotal'],
      formula: 'standard deduction + QBI deduction + Schedule 1-A deductions',
      cite: [L('14')],
      compute: (ctx) =>
        ctx.node('standardDeduction') +
        ctx.node('qbiDeduction') +
        ctx.node('sch1aTotal'),
    }),
    defineNode({
      id: 'taxableIncome',
      label: 'Taxable income',
      deps: ['agi', 'deductions'],
      formula: 'max(0, line 11b - line 14)',
      cite: [L('15')],
      compute: (ctx) => max0(ctx.node('agi') - ctx.node('deductions')),
    }),
    defineNode({
      id: 'tax',
      label: 'Tax',
      deps: ['taxableIncome', 'qualifiedDividends', 'capitalGainDistributions'],
      formula:
        'Tax Table (< $100,000) or Tax Computation Worksheet; Qualified Dividends and Capital Gain Tax Worksheet when line 3a or 7a > 0',
      cite: [
        L('16'),
        cite('i1040gi', 'Tax Table'),
        cite('i1040gi', 'Tax Computation Worksheet—Line 16'),
        cite(
          'i1040gi',
          'Qualified Dividends and Capital Gain Tax Worksheet—Line 16'
        ),
      ],
      compute: (ctx) => {
        const ti = ctx.node('taxableIncome');
        const qd = ctx.node('qualifiedDividends');
        const cg = ctx.node('capitalGainDistributions');
        ctx.param('filingStatus', status);
        if (qd > 0 || cg > 0) {
          const r = taxWithQdcg(ti, qd, cg, status, params);
          ctx.param('qdcg.zeroMax', params.qdcgThresholds[status].zeroMax);
          ctx.param(
            'qdcg.fifteenMax',
            params.qdcgThresholds[status].fifteenMax
          );
          ctx.param('qdcg.line22', r.lines.l22!);
          ctx.param('qdcg.line23', r.lines.l23!);
          ctx.param('qdcg.line24', r.lines.l24!);
          return r.tax;
        }
        return taxOnOrdinary(ti, status, params);
      },
    }),
    defineNode({
      id: 'taxBeforeCredits',
      label: 'Tax before credits',
      deps: ['tax'],
      formula: 'line 16 + line 17 (Schedule 2 Part I is not supported in v1)',
      cite: [L('18')],
      compute: (ctx) => ctx.node('tax'),
    }),
    defineNode({
      id: 'totalCredits',
      label: 'Total nonrefundable credits',
      deps: ['childCredits'],
      formula: 'line 19 + line 20 (Schedule 3 is not supported in v1)',
      cite: [L('21')],
      compute: (ctx) => ctx.node('childCredits'),
    }),
    defineNode({
      id: 'taxAfterCredits',
      label: 'Tax after credits',
      deps: ['taxBeforeCredits', 'totalCredits'],
      formula: 'max(0, line 18 - line 21)',
      cite: [L('22')],
      compute: (ctx) =>
        max0(ctx.node('taxBeforeCredits') - ctx.node('totalCredits')),
    }),
    defineNode({
      id: 'totalTax',
      label: 'Total tax',
      deps: ['taxAfterCredits', 'otherTaxes'],
      formula: 'line 22 + line 23',
      cite: [L('24')],
      compute: (ctx) => ctx.node('taxAfterCredits') + ctx.node('otherTaxes'),
    }),
    defineNode({
      id: 'withholdingW2',
      label: 'Federal income tax withheld from Form(s) W-2',
      deps: [],
      formula: 'sum(W-2 box 2)',
      cite: [L('25a')],
      compute: (ctx) => sumFacts(ctx, 'w2s', w2s, 'federalWithheld'),
    }),
    defineNode({
      id: 'withholding1099',
      label: 'Federal income tax withheld from Form(s) 1099',
      deps: [],
      formula: 'sum(box 4 of 1099-INT, -DIV, -NEC, -MISC, -K)',
      cite: [L('25b')],
      compute: (ctx) =>
        toDollars(
          sumCents([
            ...ints.map((i) => ctx.cents(`int1099s[${i.id}].federalWithheld`)),
            ...divs.map((i) => ctx.cents(`div1099s[${i.id}].federalWithheld`)),
            ...necs.map((i) => ctx.cents(`nec1099s[${i.id}].federalWithheld`)),
            ...miscs.map((i) =>
              ctx.cents(`misc1099s[${i.id}].federalWithheld`)
            ),
            ...ks.map((i) => ctx.cents(`k1099s[${i.id}].federalWithheld`)),
          ])
        ),
    }),
    defineNode({
      id: 'totalWithholding',
      label: 'Total federal income tax withheld',
      deps: ['withholdingW2', 'withholding1099', 'withholdingOther'],
      formula: 'line 25a + 25b + 25c',
      cite: [L('25d')],
      compute: (ctx) =>
        ctx.node('withholdingW2') +
        ctx.node('withholding1099') +
        ctx.node('withholdingOther'),
    }),
    defineNode({
      id: 'estimatedPayments',
      label: 'Estimated tax payments and amount applied from prior year',
      deps: [],
      formula: 'estimated payments + prior-year overpayment applied',
      cite: [L('26')],
      compute: (ctx) =>
        toDollars(
          sumCents([
            ctx.cents('payments.estimatedTaxPayments'),
            ctx.cents('payments.priorYearOverpaymentApplied'),
          ])
        ),
    }),
    defineNode({
      id: 'otherPaymentsAndCredits',
      label: 'Total other payments and refundable credits',
      deps: ['eic', 'actc'],
      formula: 'line 27a + 28 (29-31 not supported in v1)',
      cite: [L('32')],
      compute: (ctx) => ctx.node('eic') + ctx.node('actc'),
    }),
    defineNode({
      id: 'totalPayments',
      label: 'Total payments',
      deps: [
        'totalWithholding',
        'estimatedPayments',
        'otherPaymentsAndCredits',
      ],
      formula: 'line 25d + 26 + 32',
      cite: [L('33')],
      compute: (ctx) =>
        ctx.node('totalWithholding') +
        ctx.node('estimatedPayments') +
        ctx.node('otherPaymentsAndCredits'),
    }),
    defineNode({
      id: 'refundOrOwed',
      label: 'Refund (positive) or amount owed (negative)',
      deps: ['totalPayments', 'totalTax'],
      formula: 'line 33 - line 24',
      cite: [L('34'), L('37')],
      compute: (ctx) => ctx.node('totalPayments') - ctx.node('totalTax'),
    }),
    defineNode({
      id: 'overpaid',
      label: 'Amount overpaid',
      deps: ['refundOrOwed'],
      formula: 'max(0, line 33 - line 24)',
      cite: [L('34')],
      compute: (ctx) => max0(ctx.node('refundOrOwed')),
    }),
    defineNode({
      id: 'amountOwed',
      label: 'Amount you owe',
      deps: ['refundOrOwed'],
      formula: 'max(0, line 24 - line 33)',
      cite: [L('37')],
      compute: (ctx) => max0(-ctx.node('refundOrOwed')),
    }),
  ];
}
