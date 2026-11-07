/**
 * Form 8959 (Additional Medicare Tax) and Form 8960 (Net Investment Income
 * Tax). One form per return (MFJ combines both spouses).
 *
 * Form 8959 node ids are year-stable; 2025 and 2026 number the lines
 * differently (2026 draft puts RRTA in Part II and self-employment income in
 * Part IV), see params/lines.ts. RRTA compensation (W-2 box 14), Form 4137
 * tips and Form 8919 wages are not supported in v1.
 */
import { cite } from '../cite.ts';
import { ownedOnReturn, statusOf } from '../facts.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0, mulRate, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type { TaxFacts } from '../types.ts';
import { businessesOnReturn } from './schC.ts';

const A = (line: string) => cite('i8959', `Line ${line}`);
const N = (line: string) => cite('i8960', `Line ${line}`);

export function f8959Nodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const status = statusOf(facts);
  const w2s = ownedOnReturn(facts, facts.w2s);
  const seOwners = businessesOnReturn(facts).map((b) => b.owner);
  const threshold = (ctx: { param<T extends number>(n: string, v: T): T }) =>
    ctx.param(
      `additionalMedicareThreshold.${status}`,
      params.additionalMedicareThreshold[status]
    );
  const rate = (ctx: { param<T extends number>(n: string, v: T): T }) =>
    ctx.param('additionalMedicareRatePpm', params.additionalMedicareRatePpm);

  return [
    defineNode({
      id: 'f8959.medicareWages',
      label: 'Medicare wages and tips (Form W-2, box 5)',
      deps: [],
      formula: 'sum(W-2 box 5), both spouses on a joint return',
      cite: [A('1')],
      compute: (ctx) =>
        toDollars(
          sumCents(w2s.map((w) => ctx.cents(`w2s[${w.id}].medicareWages`)))
        ),
    }),
    defineNode({
      id: 'f8959.totalWages',
      label: 'Total Medicare wages (lines 1 through 3)',
      deps: ['f8959.medicareWages'],
      formula: 'line 1 (Form 4137 tips and Form 8919 wages are not supported)',
      cite: [A('4')],
      compute: (ctx) => ctx.node('f8959.medicareWages'),
    }),
    defineNode({
      id: 'f8959.wageThreshold',
      label: 'Threshold for your filing status',
      deps: [],
      formula: '$250,000 MFJ; $200,000 single or head of household',
      cite: [
        A('5'),
        cite('i8959', 'Threshold Amounts for Additional Medicare Tax'),
      ],
      compute: (ctx) => threshold(ctx),
    }),
    defineNode({
      id: 'f8959.wagesOverThreshold',
      label: 'Medicare wages over the threshold',
      deps: ['f8959.totalWages', 'f8959.wageThreshold'],
      formula: 'max(0, line 4 - line 5)',
      cite: [A('6')],
      compute: (ctx) =>
        max0(ctx.node('f8959.totalWages') - ctx.node('f8959.wageThreshold')),
    }),
    defineNode({
      id: 'f8959.taxOnWages',
      label: 'Additional Medicare Tax on Medicare wages',
      deps: ['f8959.wagesOverThreshold'],
      formula: 'line 6 x 0.9%',
      cite: [A('7')],
      compute: (ctx) =>
        mulRate(ctx.node('f8959.wagesOverThreshold'), rate(ctx)),
    }),
    defineNode({
      id: 'f8959.wagesAndRrtaTax',
      label: 'Additional Medicare Tax on Medicare wages and RRTA compensation',
      deps: ['f8959.taxOnWages'],
      formula:
        'line 7 + RRTA line 11 (RRTA not supported) — 2026 draft line 12',
      cite: [cite('f8959', '2026 draft, line 12')],
      compute: (ctx) => ctx.node('f8959.taxOnWages'),
    }),
    defineNode({
      id: 'f8959.seIncome',
      label: 'Self-employment income (Schedule SE line 6; a loss counts as 0)',
      deps: seOwners.map((o) => `se.netEarnings.${o}`),
      formula:
        'sum over Schedules SE of line 6 (line 4a when $400 or more), each loss entered as 0',
      cite: [A('8'), cite('i8959', 'Who Must File')],
      compute: (ctx) => {
        const min = ctx.param(
          'se.minimumNetEarnings',
          params.se.minimumNetEarnings
        );
        return seOwners.reduce((s, o) => {
          const v = ctx.node(`se.netEarnings.${o}`);
          return s + (v >= min ? v : 0);
        }, 0);
      },
    }),
    defineNode({
      id: 'f8959.seThreshold',
      label: 'Threshold for your filing status',
      deps: [],
      formula: '$250,000 MFJ; $200,000 single or head of household',
      cite: [A('9')],
      compute: (ctx) => threshold(ctx),
    }),
    defineNode({
      id: 'f8959.seWages',
      label: 'Medicare wages (line 4)',
      deps: ['f8959.totalWages'],
      formula: 'line 4',
      cite: [A('10')],
      compute: (ctx) => ctx.node('f8959.totalWages'),
    }),
    defineNode({
      id: 'f8959.seThresholdReduced',
      label: 'Threshold reduced by Medicare wages',
      deps: ['f8959.seThreshold', 'f8959.seWages'],
      formula: 'max(0, line 9 - line 10)',
      cite: [A('11')],
      compute: (ctx) =>
        max0(ctx.node('f8959.seThreshold') - ctx.node('f8959.seWages')),
    }),
    defineNode({
      id: 'f8959.seOverThreshold',
      label: 'Self-employment income over the reduced threshold',
      deps: ['f8959.seIncome', 'f8959.seThresholdReduced'],
      formula: 'max(0, line 8 - line 11)',
      cite: [A('12')],
      compute: (ctx) =>
        max0(ctx.node('f8959.seIncome') - ctx.node('f8959.seThresholdReduced')),
    }),
    defineNode({
      id: 'f8959.taxOnSe',
      label: 'Additional Medicare Tax on self-employment income',
      deps: ['f8959.seOverThreshold'],
      formula: 'line 12 x 0.9%',
      cite: [A('13')],
      compute: (ctx) => mulRate(ctx.node('f8959.seOverThreshold'), rate(ctx)),
    }),
    defineNode({
      id: 'f8959.total',
      label: 'Total Additional Medicare Tax',
      deps: ['f8959.taxOnWages', 'f8959.taxOnSe'],
      formula: 'line 7 + line 13 (+ RRTA line 17, not supported)',
      cite: [A('18')],
      compute: (ctx) =>
        ctx.node('f8959.taxOnWages') + ctx.node('f8959.taxOnSe'),
    }),
    defineNode({
      id: 'additionalMedicareTax',
      label: 'Additional Medicare Tax',
      deps: ['f8959.total'],
      formula: 'Form 8959 total (2025 line 18; 2026 lines 12 + 18)',
      cite: [A('18'), cite('i1040gi', 'Schedule 2, Line 11')],
      compute: (ctx) => ctx.node('f8959.total'),
    }),
    defineNode({
      id: 'f8959.medicareWithheld',
      label: 'Medicare tax withheld (Form W-2, box 6)',
      deps: [],
      formula: 'sum(W-2 box 6), both spouses on a joint return',
      cite: [A('19')],
      compute: (ctx) =>
        toDollars(
          sumCents(w2s.map((w) => ctx.cents(`w2s[${w.id}].medicareTax`)))
        ),
    }),
    defineNode({
      id: 'f8959.withholdingWages',
      label: 'Medicare wages (line 1)',
      deps: ['f8959.medicareWages'],
      formula: 'line 1',
      cite: [A('20')],
      compute: (ctx) => ctx.node('f8959.medicareWages'),
    }),
    defineNode({
      id: 'f8959.regularWithholding',
      label: 'Regular Medicare tax withholding on Medicare wages',
      deps: ['f8959.withholdingWages'],
      formula: 'line 20 x 1.45%',
      cite: [A('21')],
      compute: (ctx) =>
        mulRate(
          ctx.node('f8959.withholdingWages'),
          ctx.param('medicareTaxRatePpm', params.medicareTaxRatePpm)
        ),
    }),
    defineNode({
      id: 'f8959.additionalWithheld',
      label: 'Additional Medicare Tax withholding on Medicare wages',
      deps: ['f8959.medicareWithheld', 'f8959.regularWithholding'],
      formula: 'max(0, line 19 - line 21)',
      cite: [A('22')],
      compute: (ctx) =>
        max0(
          ctx.node('f8959.medicareWithheld') -
            ctx.node('f8959.regularWithholding')
        ),
    }),
    defineNode({
      id: 'f8959.totalWithheld',
      label: 'Total Additional Medicare Tax withholding',
      deps: ['f8959.additionalWithheld'],
      formula: 'line 22 + line 23 (RRTA withholding not supported)',
      cite: [A('24')],
      compute: (ctx) => ctx.node('f8959.additionalWithheld'),
    }),
    defineNode({
      id: 'withholdingOther',
      label: 'Federal income tax withheld from other forms (Form 8959 line 24)',
      deps: ['f8959.totalWithheld'],
      formula: 'Form 8959 line 24',
      cite: [cite('i1040gi', 'Line 25c'), A('24')],
      compute: (ctx) => ctx.node('f8959.totalWithheld'),
    }),
  ];
}

export function f8960Nodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const status = statusOf(facts);
  return [
    defineNode({
      id: 'f8960.taxableInterest',
      label: 'Taxable interest',
      deps: ['taxableInterest'],
      formula: 'Form 1040 line 2b',
      cite: [N('1')],
      compute: (ctx) => ctx.node('taxableInterest'),
    }),
    defineNode({
      id: 'f8960.ordinaryDividends',
      label: 'Ordinary dividends',
      deps: ['ordinaryDividends'],
      formula: 'Form 1040 line 3b',
      cite: [N('2')],
      compute: (ctx) => ctx.node('ordinaryDividends'),
    }),
    defineNode({
      id: 'f8960.businessRentalIncome',
      label: 'Rental real estate, royalties, trades or businesses',
      deps: ['businessIncome', 'rentalRoyaltyIncome'],
      formula: 'Schedule 1 line 3 + line 5',
      cite: [
        N(
          '4a—Income From Trades/Businesses/Farming, Rental Real Estate, Royalties'
        ),
      ],
      compute: (ctx) =>
        ctx.node('businessIncome') + ctx.node('rentalRoyaltyIncome'),
    }),
    defineNode({
      id: 'f8960.nonSection1411Adjustment',
      label:
        'Adjustment for nonpassive trade or business income taken into account for self-employment tax',
      deps: ['businessIncome'],
      formula:
        '- Schedule 1 line 3 (Schedule C income subject to SE tax is not investment income; a loss is added back)',
      cite: [
        N(
          '4b—Adjustment for Net Income or Loss Derived in the Ordinary Course of a Non-Section 1411 Trade or Business'
        ),
      ],
      compute: (ctx) => -ctx.node('businessIncome'),
    }),
    defineNode({
      id: 'f8960.netBusinessRental',
      label: 'Net rental real estate and royalty income',
      deps: ['f8960.businessRentalIncome', 'f8960.nonSection1411Adjustment'],
      formula: 'line 4a + line 4b',
      cite: [N('4c')],
      compute: (ctx) =>
        ctx.node('f8960.businessRentalIncome') +
        ctx.node('f8960.nonSection1411Adjustment'),
    }),
    defineNode({
      id: 'f8960.dispositionGain',
      label:
        'Net gain from disposition of property (capital gain distributions)',
      deps: ['capitalGainDistributions'],
      formula: 'Form 1040 line 7a (Schedule 1 line 4 not supported)',
      cite: [N('5a—Net Gain or Loss From Disposition of Property')],
      compute: (ctx) => ctx.node('capitalGainDistributions'),
    }),
    defineNode({
      id: 'f8960.netGain',
      label: 'Net gain or loss from dispositions',
      deps: ['f8960.dispositionGain'],
      formula: 'line 5a (lines 5b-5c do not apply in v1)',
      cite: [N('5d')],
      compute: (ctx) => ctx.node('f8960.dispositionGain'),
    }),
    defineNode({
      id: 'f8960.investmentIncome',
      label: 'Total investment income',
      deps: [
        'f8960.taxableInterest',
        'f8960.ordinaryDividends',
        'f8960.netBusinessRental',
        'f8960.netGain',
      ],
      formula: 'lines 1 + 2 + 3 + 4c + 5d + 6 + 7 (3, 6, 7 are 0 in v1)',
      cite: [N('8')],
      compute: (ctx) =>
        ctx.node('f8960.taxableInterest') +
        ctx.node('f8960.ordinaryDividends') +
        ctx.node('f8960.netBusinessRental') +
        ctx.node('f8960.netGain'),
    }),
    defineNode({
      id: 'f8960.deductions',
      label: 'Investment expenses and modifications',
      deps: [],
      formula:
        '0: v1 uses the standard deduction, so no investment interest, state income tax or other itemized expense is deducted (lines 9a-10)',
      cite: [N('9b—State, Local, and Foreign Income Tax'), N('11')],
      compute: () => 0,
    }),
    defineNode({
      id: 'f8960.netInvestmentIncome',
      label: 'Net investment income',
      deps: ['f8960.investmentIncome', 'f8960.deductions'],
      formula: 'max(0, line 8 - line 11)',
      cite: [N('12')],
      compute: (ctx) =>
        max0(ctx.node('f8960.investmentIncome') - ctx.node('f8960.deductions')),
    }),
    defineNode({
      id: 'f8960.magi',
      label: 'Modified adjusted gross income',
      deps: ['agi'],
      formula: 'AGI (no foreign earned income exclusion or CFC/PFIC in v1)',
      cite: [N('13—Modified Adjusted Gross Income (MAGI)')],
      compute: (ctx) => ctx.node('agi'),
    }),
    defineNode({
      id: 'f8960.threshold',
      label: 'Threshold for your filing status',
      deps: [],
      formula: '$250,000 MFJ; $200,000 single or head of household',
      cite: [N('14—Threshold Based on Filing Status')],
      compute: (ctx) =>
        ctx.param(`niitThreshold.${status}`, params.niitThreshold[status]),
    }),
    defineNode({
      id: 'f8960.magiOverThreshold',
      label: 'Modified AGI over the threshold',
      deps: ['f8960.magi', 'f8960.threshold'],
      formula: 'max(0, line 13 - line 14)',
      cite: [N('15')],
      compute: (ctx) =>
        max0(ctx.node('f8960.magi') - ctx.node('f8960.threshold')),
    }),
    defineNode({
      id: 'f8960.taxBase',
      label: 'Smaller of net investment income or MAGI over the threshold',
      deps: ['f8960.netInvestmentIncome', 'f8960.magiOverThreshold'],
      formula: 'min(line 12, line 15)',
      cite: [N('16')],
      compute: (ctx) =>
        Math.min(
          ctx.node('f8960.netInvestmentIncome'),
          ctx.node('f8960.magiOverThreshold')
        ),
    }),
    defineNode({
      id: 'f8960.tax',
      label: 'Net investment income tax',
      deps: ['f8960.taxBase'],
      formula: 'line 16 x 3.8%',
      cite: [N('17—Net Investment Income Tax for Individuals')],
      compute: (ctx) =>
        mulRate(
          ctx.node('f8960.taxBase'),
          ctx.param('niitRatePpm', params.niitRatePpm)
        ),
    }),
    defineNode({
      id: 'niit',
      label: 'Net investment income tax',
      deps: ['f8960.tax'],
      formula: 'Form 8960 line 17',
      cite: [N('17—Net Investment Income Tax for Individuals')],
      compute: (ctx) => ctx.node('f8960.tax'),
    }),
  ];
}
