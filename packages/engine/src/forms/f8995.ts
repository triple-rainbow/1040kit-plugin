/**
 * Form 8995 (Qualified Business Income Deduction Simplified Computation).
 * Taxable income above the threshold needs Form 8995-A, which checkScope flags.
 */
import { cite } from '../cite.ts';
import { ownedOnReturn } from '../facts.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0, mulRate, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { TaxFacts } from '../types.ts';
import { businessesOnReturn } from './schC.ts';

const Q = (line: string) => cite('i8995', `Line ${line}`);

export function f8995Nodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const owners = businessesOnReturn(facts).map((b) => b.owner);
  const divs = ownedOnReturn(facts, facts.div1099s);
  const rate = (ctx: { param<T extends number>(n: string, v: T): T }) =>
    ctx.param('qbi.ratePpm', params.qbi.ratePpm);
  const minimum = params.qbi.minimum;

  const ROWS = ['1i', '1ii', '1iii', '1iv', '1v'];
  const perOwner = owners.map((o, i) =>
    defineNode({
      id: `qbi.${o}`,
      at: { form: 'f8995', line: ROWS[i]! },
      label: 'Qualified business income from Schedule C',
      deps: [
        `schC.netProfit.${o}`,
        `seDeduction.${o}`,
        `sehiDeduction.${o}`,
        `sepDeduction.${o}`,
      ],
      formula:
        'Schedule C net profit - deductible SE tax - SE health insurance - SEP deduction',
      cite: [
        Q('1'),
        cite('i8995', 'Determining Your Qualified Business Income'),
      ],
      compute: (ctx) =>
        ctx.node(`schC.netProfit.${o}`) -
        ctx.node(`seDeduction.${o}`) -
        ctx.node(`sehiDeduction.${o}`) -
        ctx.node(`sepDeduction.${o}`),
    })
  );

  const nodes: NodeDef[] = [
    ...perOwner,
    defineNode({
      id: 'qbiBusinessSum',
      label: 'Total qualified business income or (loss)',
      deps: perOwner.map((n) => n.id),
      formula: 'sum of line 1, column (c)',
      cite: [Q('2')],
      compute: (ctx) => perOwner.reduce((s, n) => s + ctx.node(n.id), 0),
    }),
    defineNode({
      id: 'qbiTotal',
      label: 'Total qualified business income',
      deps: ['qbiBusinessSum'],
      formula: 'max(0, line 2) (no prior-year loss carryforward in v1)',
      cite: [Q('4')],
      compute: (ctx) => max0(ctx.node('qbiBusinessSum')),
    }),
    defineNode({
      id: 'qbiComponent',
      label: 'Qualified business income component',
      deps: ['qbiTotal'],
      formula: 'line 4 x 20%',
      cite: [Q('5')],
      compute: (ctx) => mulRate(ctx.node('qbiTotal'), rate(ctx)),
    }),
    defineNode({
      id: 'reitDividends',
      label: 'Qualified REIT dividends (1099-DIV box 5)',
      deps: [],
      formula: 'max(0, sum(1099-DIV box 5))',
      cite: [Q('6'), Q('8')],
      compute: (ctx) =>
        max0(
          toDollars(
            sumCents(
              divs.map((d) =>
                ctx.cents(`div1099s[${d.id}].section199aDividends`)
              )
            )
          )
        ),
    }),
    defineNode({
      id: 'reitComponent',
      label: 'REIT and PTP component',
      deps: ['reitDividends'],
      formula: 'line 8 x 20%',
      cite: [Q('9')],
      compute: (ctx) => mulRate(ctx.node('reitDividends'), rate(ctx)),
    }),
    defineNode({
      id: 'qbiBeforeLimit',
      label: 'QBI deduction before the income limitation',
      deps: ['qbiComponent', 'reitComponent'],
      formula: 'line 5 + line 9',
      cite: [Q('10')],
      compute: (ctx) => ctx.node('qbiComponent') + ctx.node('reitComponent'),
    }),
    defineNode({
      id: 'qbiTaxableIncome',
      label: 'Taxable income before the QBI deduction',
      deps: ['agi', 'standardDeduction', 'sch1aTotal'],
      formula: 'Form 1040 line 11a - line 12e - Schedule 1-A deductions',
      cite: [Q('11')],
      compute: (ctx) =>
        ctx.node('agi') -
        ctx.node('standardDeduction') -
        ctx.node('sch1aTotal'),
    }),
    defineNode({
      id: 'qbiNetCapitalGain',
      label: 'Net capital gain plus qualified dividends',
      deps: ['qualifiedDividends', 'capitalGainDistributions'],
      formula: 'qualified dividends + capital gain distributions',
      cite: [Q('12')],
      compute: (ctx) =>
        ctx.node('qualifiedDividends') + ctx.node('capitalGainDistributions'),
    }),
    defineNode({
      id: 'qbiIncomeBase',
      label: 'Taxable income less net capital gain',
      deps: ['qbiTaxableIncome', 'qbiNetCapitalGain'],
      formula: 'max(0, line 11 - line 12)',
      cite: [Q('13')],
      compute: (ctx) =>
        max0(ctx.node('qbiTaxableIncome') - ctx.node('qbiNetCapitalGain')),
    }),
    defineNode({
      id: 'qbiIncomeLimit',
      label: 'Income limitation',
      deps: ['qbiIncomeBase'],
      formula: 'line 13 x 20%',
      cite: [Q('14')],
      compute: (ctx) => mulRate(ctx.node('qbiIncomeBase'), rate(ctx)),
    }),
  ];

  if (minimum) {
    nodes.push(
      defineNode({
        id: 'qbiMinimum',
        label: 'Minimum deduction for active qualified business income',
        deps: ['qbiTotal'],
        formula: `$${minimum.deduction} if active QBI is at least $${minimum.activeQbi} (§199A(i)), assumes material participation`,
        cite: [Q('16'), cite('rp202532', '§2.12'), cite('pl11921', '§70105')],
        compute: (ctx) =>
          ctx.node('qbiTotal') >=
          ctx.param('qbi.minimum.activeQbi', minimum.activeQbi)
            ? ctx.param('qbi.minimum.deduction', minimum.deduction)
            : 0,
      }),
      defineNode({
        id: 'qbiDeduction',
        label: 'Qualified business income deduction',
        deps: ['qbiBeforeLimit', 'qbiIncomeLimit', 'qbiMinimum'],
        formula: 'max(min(line 10, line 14), line 16)',
        cite: [Q('15'), Q('17')],
        compute: (ctx) =>
          Math.max(
            Math.min(ctx.node('qbiBeforeLimit'), ctx.node('qbiIncomeLimit')),
            ctx.node('qbiMinimum')
          ),
      })
    );
  } else {
    nodes.push(
      defineNode({
        id: 'qbiDeduction',
        label: 'Qualified business income deduction',
        deps: ['qbiBeforeLimit', 'qbiIncomeLimit'],
        formula: 'min(line 10, line 14)',
        cite: [
          Q('15'),
          cite(
            'i1040gi',
            `Line ${params.formLines.qbiDeduction?.line ?? '13a'}`
          ),
        ],
        compute: (ctx) =>
          Math.min(ctx.node('qbiBeforeLimit'), ctx.node('qbiIncomeLimit')),
      })
    );
  }
  return nodes;
}
