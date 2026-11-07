/**
 * Schedule 8812 (Credits for Qualifying Children and Other Dependents).
 * Credit Limit Worksheet A line 13 = Form 1040 line 18 (no other credits in v1).
 */
import { cite } from '../cite.ts';
import { classifyDependent } from '../dependents.ts';
import { ownedOnReturn, statusOf } from '../facts.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0, mulRate, pct, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { TaxFacts } from '../types.ts';

const S8 = (line: string) => cite('i1040s8', `Line ${line}`);

export function sch8812Nodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const status = statusOf(facts);
  const p = params.ctc;
  // A dependent filer cannot claim dependents (i1040gi, Dependents, Step 1).
  const canClaim = facts.taxpayer.canBeClaimedAsDependent !== true;
  const classes = facts.dependents.map((d) => ({
    d,
    c: classifyDependent(d, facts, params),
  }));
  const ctcKids = canClaim ? classes.filter((x) => x.c.credit === 'ctc') : [];
  const others = canClaim ? classes.filter((x) => x.c.credit === 'odc') : [];
  const w2s = ownedOnReturn(facts, facts.w2s);

  const readDependentFacts = (ctx: { fact(path: string): unknown }) => {
    for (const { d } of classes) {
      for (const f of [
        'dateOfBirth',
        'relationship',
        'monthsLivedWithTaxpayer',
        'hasValidSsn',
      ]) {
        ctx.fact(`dependents[${d.id}].${f}`);
      }
    }
  };

  return [
    defineNode({
      id: 'ctcChildren',
      label: 'Qualifying children under 17 with the required SSN',
      deps: [],
      formula:
        'count of dependents who are qualifying children under 17 with a valid SSN (filer has a valid SSN)',
      cite: [S8('4'), cite('i1040s8', 'Credits for Qualifying Children')],
      compute: (ctx) => {
        readDependentFacts(ctx);
        ctx.fact('taxpayer.hasValidSsn');
        return ctcKids.length;
      },
    }),
    defineNode({
      id: 'odcDependents',
      label: 'Other dependents',
      deps: [],
      formula:
        'count of other dependents (including qualifying children 17+ or without a valid SSN)',
      cite: [S8('6'), cite('i1040s8', 'Credit for Other Dependents (ODC)')],
      compute: (ctx) => {
        readDependentFacts(ctx);
        return others.length;
      },
    }),
    defineNode({
      id: 'ctc',
      label: 'Child tax credit before limits',
      deps: ['ctcChildren'],
      formula: 'line 4 x $2,200',
      cite: [S8('5')],
      compute: (ctx) =>
        ctx.node('ctcChildren') * ctx.param('ctc.perChild', p.perChild),
    }),
    defineNode({
      id: 'odc',
      label: 'Credit for other dependents before limits',
      deps: ['odcDependents'],
      formula: 'line 6 x $500',
      cite: [S8('7')],
      compute: (ctx) =>
        ctx.node('odcDependents') *
        ctx.param('ctc.perOtherDependent', p.perOtherDependent),
    }),
    defineNode({
      id: 'ctcOdcTotal',
      label: 'Credits before the phase-out',
      deps: ['ctc', 'odc'],
      formula: 'line 5 + line 7',
      cite: [S8('8')],
      compute: (ctx) => ctx.node('ctc') + ctx.node('odc'),
    }),
    defineNode({
      id: 'ctcOdcThreshold',
      label: 'Phase-out threshold for your filing status',
      deps: [],
      formula: '$400,000 married filing jointly; $200,000 all others',
      cite: [S8('9')],
      compute: (ctx) =>
        ctx.param(
          `ctc.phaseoutThreshold.${status}`,
          p.phaseoutThreshold[status]
        ),
    }),
    defineNode({
      id: 'ctcOdcExcess',
      label: 'Income over the threshold, rounded up to $1,000',
      deps: ['agi', 'ctcOdcThreshold'],
      formula:
        'max(0, line 3 - line 9), rounded up to the next multiple of $1,000',
      cite: [S8('10')],
      compute: (ctx) =>
        Math.ceil(max0(ctx.node('agi') - ctx.node('ctcOdcThreshold')) / 1000) *
        1000,
    }),
    defineNode({
      id: 'ctcOdcPhaseout',
      label: 'Phase-out amount',
      deps: ['ctcOdcExcess'],
      formula: 'line 10 x 5%',
      cite: [S8('11')],
      compute: (ctx) =>
        mulRate(
          ctx.node('ctcOdcExcess'),
          ctx.param('ctc.phaseoutPpm', p.phaseoutPpm)
        ),
    }),
    defineNode({
      id: 'ctcOdcAfterPhaseout',
      label: 'Credits after phase-out',
      deps: ['ctcOdcTotal', 'ctcOdcPhaseout'],
      formula: 'max(0, line 8 - line 11)',
      cite: [S8('12')],
      compute: (ctx) =>
        max0(ctx.node('ctcOdcTotal') - ctx.node('ctcOdcPhaseout')),
    }),
    defineNode({
      id: 'creditLimit',
      label: 'Credit Limit Worksheet A',
      deps: ['taxBeforeCredits'],
      formula: 'Form 1040 line 18 (no other nonrefundable credits in v1)',
      cite: [S8('13'), cite('i1040s8', 'Credit Limit Worksheet A')],
      compute: (ctx) => ctx.node('taxBeforeCredits'),
    }),
    defineNode({
      id: 'childCredits',
      label: 'Child tax credit and credit for other dependents',
      deps: ['ctcOdcAfterPhaseout', 'creditLimit'],
      formula: 'min(line 12, line 13)',
      cite: [S8('14'), cite('i1040gi', 'Line 19')],
      compute: (ctx) =>
        Math.min(ctx.node('ctcOdcAfterPhaseout'), ctx.node('creditLimit')),
    }),
    // Part II-A. Each line is 0 (blank) once the form says "stop here".
    defineNode({
      id: 'actc.unused',
      label: 'Credit not used against tax',
      deps: ['ctcOdcAfterPhaseout', 'childCredits'],
      formula: 'line 12 - line 14',
      cite: [S8('16a')],
      compute: (ctx) =>
        max0(ctx.node('ctcOdcAfterPhaseout') - ctx.node('childCredits')),
    }),
    defineNode({
      id: 'actc.childLimit',
      label: 'Refundable limit per qualifying child',
      deps: ['actc.unused', 'ctcChildren'],
      formula: 'line 4 x $1,700 (0 if line 16a is zero)',
      cite: [S8('16b')],
      compute: (ctx) =>
        ctx.node('actc.unused') === 0
          ? 0
          : ctx.node('ctcChildren') *
            ctx.param('ctc.refundablePerChild', p.refundablePerChild),
    }),
    defineNode({
      id: 'actc.limit',
      label: 'Most the additional child tax credit can be',
      deps: ['actc.unused', 'actc.childLimit'],
      formula: 'min(line 16a, line 16b)',
      cite: [S8('17')],
      compute: (ctx) =>
        Math.min(ctx.node('actc.unused'), ctx.node('actc.childLimit')),
    }),
    defineNode({
      id: 'actcEarnedIncome',
      label: 'Earned income for the ACTC',
      deps: ['earnedIncome', 'actc.limit'],
      formula:
        'Form 1040 line 1z + Schedule C net earnings - deductible SE tax (only when line 17 is more than zero)',
      cite: [S8('18a'), cite('i1040s8', 'Earned Income Chart')],
      compute: (ctx) =>
        ctx.node('actc.limit') > 0 ? ctx.node('earnedIncome') : 0,
    }),
    defineNode({
      id: 'actc.earnedOverThreshold',
      label: 'Earned income over $2,500',
      deps: ['actcEarnedIncome'],
      formula: 'max(0, line 18a - $2,500)',
      cite: [S8('19')],
      compute: (ctx) =>
        max0(
          ctx.node('actcEarnedIncome') -
            ctx.param('ctc.earnedIncomeThreshold', p.earnedIncomeThreshold)
        ),
    }),
    defineNode({
      id: 'actc.earnedIncomeCredit',
      label: 'Earned-income amount',
      deps: ['actc.earnedOverThreshold'],
      formula: 'line 19 x 15%',
      cite: [S8('20')],
      compute: (ctx) =>
        mulRate(
          ctx.node('actc.earnedOverThreshold'),
          ctx.param('ctc.earnedIncomePpm', p.earnedIncomePpm)
        ),
    }),
    // Part II-B: only with line 16b of $5,100 or more (3+ children) and line 20 below line 17.
    defineNode({
      id: 'actc.usesPartIIB',
      label: 'Part II-B applies (1 = yes)',
      deps: ['actc.childLimit', 'actc.limit', 'actc.earnedIncomeCredit'],
      formula:
        '1 if line 16b is $5,100 or more and line 20 is less than line 17, else 0',
      cite: [S8('20')],
      compute: (ctx) =>
        ctx.node('actc.childLimit') >=
          ctx.param('ctc.partIIBMinimum', p.partIIBMinimum) &&
        ctx.node('actc.earnedIncomeCredit') < ctx.node('actc.limit')
          ? 1
          : 0,
    }),
    defineNode({
      id: 'actc.withheldTaxes',
      label: 'Social security and Medicare taxes withheld',
      deps: [
        'actc.usesPartIIB',
        'f8959.taxOnWages',
        'f8959.additionalWithheld',
        'f8959.taxOnSe',
      ],
      formula:
        'W-2 boxes 4 and 6, adjusted by the Additional Medicare Tax and RRTA Tax Worksheet (+ Form 8959 line 7 - line 22 + half of line 13)',
      cite: [
        S8('21'),
        cite('i1040s8', 'Additional Medicare Tax and RRTA Tax Worksheet'),
      ],
      compute: (ctx) => {
        if (ctx.node('actc.usesPartIIB') === 0) return 0;
        const withheld = toDollars(
          sumCents(
            w2s.flatMap((w) => [
              ctx.cents(`w2s[${w.id}].ssTax`),
              ctx.cents(`w2s[${w.id}].medicareTax`),
            ])
          )
        );
        return (
          withheld +
          ctx.node('f8959.taxOnWages') -
          ctx.node('f8959.additionalWithheld') +
          mulRate(ctx.node('f8959.taxOnSe'), pct(50))
        );
      },
    }),
    defineNode({
      id: 'actc.seDeduction',
      label: 'Deductible part of self-employment tax',
      deps: ['actc.usesPartIIB', 'seDeduction'],
      formula: 'Schedule 1 line 15 (Part II-B only)',
      cite: [S8('22')],
      compute: (ctx) =>
        ctx.node('actc.usesPartIIB') === 1 ? ctx.node('seDeduction') : 0,
    }),
    defineNode({
      id: 'actc.payrollTotal',
      label: 'Payroll and self-employment taxes',
      deps: ['actc.withheldTaxes', 'actc.seDeduction'],
      formula: 'line 21 + line 22',
      cite: [S8('23')],
      compute: (ctx) =>
        ctx.node('actc.withheldTaxes') + ctx.node('actc.seDeduction'),
    }),
    defineNode({
      id: 'actc.eic',
      label: 'Earned income credit',
      deps: ['actc.usesPartIIB', 'eic'],
      formula: 'Form 1040 line 27a (Part II-B only)',
      cite: [S8('24')],
      compute: (ctx) =>
        ctx.node('actc.usesPartIIB') === 1 ? ctx.node('eic') : 0,
    }),
    defineNode({
      id: 'actc.payrollNet',
      label: 'Payroll taxes less the EIC',
      deps: ['actc.payrollTotal', 'actc.eic'],
      formula: 'max(0, line 23 - line 24)',
      cite: [S8('25')],
      compute: (ctx) =>
        max0(ctx.node('actc.payrollTotal') - ctx.node('actc.eic')),
    }),
    defineNode({
      id: 'actc.partIIB',
      label: 'Larger of the two methods',
      deps: ['actc.usesPartIIB', 'actc.earnedIncomeCredit', 'actc.payrollNet'],
      formula: 'max(line 20, line 25) (Part II-B only)',
      cite: [S8('26')],
      compute: (ctx) =>
        ctx.node('actc.usesPartIIB') === 1
          ? Math.max(
              ctx.node('actc.earnedIncomeCredit'),
              ctx.node('actc.payrollNet')
            )
          : 0,
    }),
    defineNode({
      id: 'actc',
      label: 'Additional child tax credit',
      deps: [
        'actc.limit',
        'actc.earnedIncomeCredit',
        'actc.usesPartIIB',
        'actc.partIIB',
      ],
      formula: 'min(line 17, line 20), or min(line 17, line 26) with Part II-B',
      cite: [S8('27'), cite('i1040gi', 'Line 28')],
      compute: (ctx) =>
        Math.min(
          ctx.node('actc.limit'),
          ctx.node('actc.usesPartIIB') === 1
            ? ctx.node('actc.partIIB')
            : ctx.node('actc.earnedIncomeCredit')
        ),
    }),
  ];
}
