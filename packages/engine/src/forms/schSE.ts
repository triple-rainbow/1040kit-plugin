/**
 * Schedule SE (Self-Employment Tax), one per person with a Schedule C.
 * Each line is rounded to whole dollars as entered on the form, so line 13
 * is 50% of the rounded line 12.
 */
import { cite } from '../cite.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0, mulRate, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { TaxFacts } from '../types.ts';
import { businessesOnReturn } from './schC.ts';

const SE = (line: string) => cite('i1040sse', `Line ${line}`);

export function schSENodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const nodes: NodeDef[] = [];
  for (const { owner: o } of businessesOnReturn(facts)) {
    const id = (name: string) => `${name}.${o}`;
    const w2s = facts.w2s.filter((w) => w.owner === o);
    nodes.push(
      defineNode({
        id: id('se.netProfit'),
        label: 'Net profit or (loss) from Schedule C',
        deps: [`schC.netProfit.${o}`],
        formula: 'Schedule C line 31',
        cite: [SE('2')],
        compute: (ctx) => ctx.node(`schC.netProfit.${o}`),
      }),
      defineNode({
        id: id('se.netEarnings'),
        label: 'Net earnings from self-employment',
        deps: [id('se.netProfit')],
        formula: 'line 3 x 92.35% if more than zero, else line 3',
        cite: [SE('4a')],
        compute: (ctx) => {
          const l3 = ctx.node(id('se.netProfit'));
          return l3 > 0
            ? mulRate(
                l3,
                ctx.param('se.netEarningsPpm', params.se.netEarningsPpm)
              )
            : l3;
        },
      }),
      defineNode({
        id: id('se.ssWagesAndTips'),
        label: 'Social security wages and tips (W-2 boxes 3 and 7)',
        deps: [],
        formula: 'sum(W-2 box 3 + box 7) for this person',
        cite: [SE('8a')],
        compute: (ctx) =>
          toDollars(
            sumCents(
              w2s.flatMap((w) => [
                ctx.cents(`w2s[${w.id}].ssWages`),
                ctx.cents(`w2s[${w.id}].ssTips`),
              ])
            )
          ),
      }),
      defineNode({
        id: id('se.netEarningsSubject'),
        label: 'Net earnings subject to SE tax',
        deps: [id('se.netEarnings')],
        formula: 'line 4a (no optional methods in v1); 0 if less than $400',
        cite: [SE('4c')],
        compute: (ctx) => {
          const l4a = ctx.node(id('se.netEarnings'));
          return l4a <
            ctx.param('se.minimumNetEarnings', params.se.minimumNetEarnings)
            ? 0
            : l4a;
        },
      }),
      defineNode({
        id: id('se.ssWageRoom'),
        label: 'Social security wage base left after wages',
        deps: [id('se.ssWagesAndTips')],
        formula: 'max(0, wage base (line 7) - line 8d)',
        cite: [SE('9')],
        compute: (ctx) =>
          max0(
            ctx.param('ssWageBase', params.ssWageBase) -
              ctx.node(id('se.ssWagesAndTips'))
          ),
      }),
      defineNode({
        id: id('se.ssPortion'),
        label: 'Social security part of SE tax',
        deps: [id('se.netEarningsSubject'), id('se.ssWageRoom')],
        formula: 'min(line 6, line 9) x 12.4%',
        cite: [SE('10')],
        compute: (ctx) =>
          mulRate(
            Math.min(
              ctx.node(id('se.netEarningsSubject')),
              ctx.node(id('se.ssWageRoom'))
            ),
            ctx.param('se.ssRatePpm', params.se.ssRatePpm)
          ),
      }),
      defineNode({
        id: id('se.medicarePortion'),
        label: 'Medicare part of SE tax',
        deps: [id('se.netEarningsSubject')],
        formula: 'line 6 x 2.9%',
        cite: [SE('11')],
        compute: (ctx) =>
          mulRate(
            ctx.node(id('se.netEarningsSubject')),
            ctx.param('se.medicareRatePpm', params.se.medicareRatePpm)
          ),
      }),
      defineNode({
        id: id('seTax'),
        label: 'Self-employment tax',
        deps: [id('se.ssPortion'), id('se.medicarePortion')],
        formula: 'line 10 + line 11',
        cite: [SE('12')],
        compute: (ctx) =>
          ctx.node(id('se.ssPortion')) + ctx.node(id('se.medicarePortion')),
      }),
      defineNode({
        id: id('seDeduction'),
        label: 'Deduction for one-half of self-employment tax',
        deps: [id('seTax')],
        formula: 'line 12 x 50%',
        cite: [SE('13')],
        compute: (ctx) =>
          mulRate(
            ctx.node(id('seTax')),
            ctx.param('se.deductionPpm', params.se.deductionPpm)
          ),
      })
    );
  }
  return nodes;
}
