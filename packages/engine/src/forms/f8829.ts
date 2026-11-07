/**
 * Form 8829 (Expenses for Business Use of Your Home), one per Schedule C with
 * an actual-expense home office. Node ids: f8829.<line name>.<owner>.
 *
 * v1 files the standard deduction, so per i8829 "Taxpayers claiming the
 * standard deduction" mortgage interest and real estate taxes go on lines 16
 * and 17 (column (b)), not lines 10-11, and lines 9-14 are empty. Casualty
 * losses (lines 9, 29, 35; Form 4684) are flagged by scope.ts.
 *
 * Percentages (lines 3, 7, 41) are integers in parts per million:
 * 125000 = 12.5%, 25640 = 2.564%.
 */
import { cite } from '../cite.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0, mulRate, roundDiv, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import { F8829_EXPENSE_LINES } from '../params/lines.ts';
import type {
  Business,
  HomeExpense,
  HomeOfficeActual,
  PersonId,
  TaxFacts,
  TaxYear,
} from '../types.ts';
import { businessesOnReturn } from './schC.ts';

const H = (section: string) => cite('i8829', section);

type LineExpense = keyof typeof F8829_EXPENSE_LINES;

const LABELS: Record<LineExpense, string> = {
  mortgage_interest:
    'Excess mortgage interest (all home mortgage interest for a standard-deduction filer)',
  real_estate_taxes:
    'Excess real estate taxes (all real estate taxes for a standard-deduction filer)',
  insurance: 'Insurance',
  rent: 'Rent',
  repairs_maintenance: 'Repairs and maintenance',
  utilities: 'Utilities',
  other: 'Other expenses',
};

/**
 * i8829 lines 10/11 and 16/17: a standard-deduction filer claims mortgage
 * interest and real estate taxes on lines 16-17 column (b); mortgage interest
 * is never a direct expense ("do not claim mortgage interest in column (a)").
 * Direct amounts the user entered for these two are moved to column (b).
 */
const ALWAYS_INDIRECT: ReadonlySet<HomeExpense> = new Set([
  'mortgage_interest',
  'real_estate_taxes',
]);

export function actualHomeOffice(b: Business): HomeOfficeActual | undefined {
  return b.homeOffice?.method === 'actual' ? b.homeOffice : undefined;
}

/** Businesses on the return that use Form 8829. */
export function f8829Businesses(facts: TaxFacts): Business[] {
  return businessesOnReturn(facts).filter((b) => actualHomeOffice(b));
}

export interface DepreciationPlan {
  /** Line 41 in ppm (0 when Part III doesn't apply). */
  pctPpm: number;
  /** Months the office was used this year (1-12). */
  months: number;
  note: string;
  /** Something v1 can't do (scope.ts flags it). */
  unsupported?: 'pre_1993' | 'recovery_year_40' | 'future_start';
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Months used and the line 41 percentage (i8829 line 41; Pub. 946 Table A-7a
 * and "Sale or Other Disposition Before the Recovery Period Ends").
 */
export function depreciationPlan(
  ho: HomeOfficeActual,
  year: TaxYear,
  params: YearParams
): DepreciationPlan {
  const d = params.homeDepreciation;
  const given = ho.monthsUsed;
  const clampMonths = (m: number) => Math.min(12, Math.max(1, Math.floor(m)));
  const start = ho.home?.businessUseStart;
  const m = start ? DATE.exec(start) : null;
  if (ho.ownership !== 'own' || !ho.home || !m) {
    return {
      pctPpm: 0,
      months: clampMonths(given ?? 12),
      note: 'no home depreciation (renter, or no basis given)',
    };
  }
  const startYear = Number(m[1]);
  const startMonth = Math.min(12, Math.max(1, Number(m[2])));
  if (startYear > year) {
    return {
      pctPpm: 0,
      months: clampMonths(given ?? 12),
      note: 'business use starts after this year',
      unsupported: 'future_start',
    };
  }
  if (start! < d.earliestStart) {
    return {
      pctPpm: 0,
      months: clampMonths(given ?? 12),
      note: 'first used before May 13, 1993: Pub. 946 or Pub. 534 rates',
      unsupported: 'pre_1993',
    };
  }
  if (startYear === year) {
    const inService = 13 - startMonth;
    const months = clampMonths(Math.min(given ?? inService, inService));
    if (months < inService) {
      // Placed in service and withdrawn in the same year: no MACRS depreciation (Pub. 946).
      return {
        pctPpm: 0,
        months,
        note: 'first used and stopped in the same year: no depreciation',
      };
    }
    return {
      pctPpm: d.firstYearPpmByMonth[startMonth - 1]!,
      months,
      note: `first used in month ${startMonth} of ${year}: i8829 line 41 table`,
    };
  }
  if (year - startYear >= d.recoveryYears) {
    return {
      pctPpm: 0,
      months: clampMonths(given ?? 12),
      note: 'recovery year 40 or later: Pub. 946 Table A-7a',
      unsupported: 'recovery_year_40',
    };
  }
  const months = clampMonths(given ?? 12);
  if (months < 12) {
    // Mid-month convention on withdrawal: full-year rate x (months - 1/2) / 12.
    return {
      pctPpm: roundDiv(d.laterYearPpm * (2 * months - 1), 24),
      months,
      note: `stopped business use after ${months} months: 2.564% x (${months} - 0.5) / 12 (Pub. 946)`,
    };
  }
  return {
    pctPpm: d.laterYearPpm,
    months,
    note: 'first used after May 12, 1993 and before this year: 2.564%',
  };
}

export function f8829Nodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const nodes: NodeDef[] = [];
  for (const b of f8829Businesses(facts))
    nodes.push(...oneForm(facts, params, b.owner, actualHomeOffice(b)!));
  return nodes;
}

function oneForm(
  facts: TaxFacts,
  params: YearParams,
  o: PersonId,
  ho: HomeOfficeActual
): NodeDef[] {
  const id = (name: string) => `f8829.${name}.${o}`;
  const hp = `businesses[${o}].homeOffice`;
  const plan = depreciationPlan(ho, facts.taxYear, params);
  const months = plan.months;

  const direct: string[] = [];
  const indirect: string[] = [];
  const lineNodes: NodeDef[] = [];
  for (const cat of Object.keys(F8829_EXPENSE_LINES) as LineExpense[]) {
    const line = F8829_EXPENSE_LINES[cat];
    const d = ho.direct?.[cat];
    const i = ho.indirect?.[cat];
    const moveToB = ALWAYS_INDIRECT.has(cat);
    if (d !== undefined && !moveToB) {
      direct.push(id(`expense.${cat}.direct`));
      lineNodes.push(
        defineNode({
          id: id(`expense.${cat}.direct`),
          label: `${LABELS[cat]} — direct`,
          deps: [],
          formula: 'expenses for the office area only, 100%',
          cite: [H('Columns (a) and (b)'), H(`Line ${line}`)],
          compute: (ctx) => toDollars(ctx.cents(`${hp}.direct.${cat}`)),
        })
      );
    }
    if (i !== undefined || (d !== undefined && moveToB)) {
      indirect.push(id(`expense.${cat}.indirect`));
      lineNodes.push(
        defineNode({
          id: id(`expense.${cat}.indirect`),
          label: `${LABELS[cat]} — indirect (whole home)`,
          deps: [],
          formula:
            months < 12
              ? 'whole-home amount x months used / 12 (part-year use)'
              : 'whole-home amount',
          cite: moveToB
            ? [
                H(`Line ${line}`),
                H(
                  'Lines 9, 10, and 11, Taxpayers claiming the standard deduction'
                ),
              ]
            : [H('Columns (a) and (b)'), H(`Line ${line}`)],
          compute: (ctx) => {
            const cents = sumCents([
              ctx.cents(`${hp}.indirect.${cat}`),
              moveToB ? ctx.cents(`${hp}.direct.${cat}`) : 0,
            ]);
            if (months >= 12) return toDollars(cents);
            ctx.param('monthsUsed', months);
            return roundDiv(cents * months, 1200);
          },
        })
      );
    }
  }

  const owner = ho.ownership === 'own' && !!ho.home;
  const partIII: NodeDef[] = owner
    ? [
        defineNode({
          id: id('homeBasis'),
          label:
            'Smaller of your home’s adjusted basis or its fair market value',
          deps: [],
          formula:
            'smaller of basis or FMV when first used for business (including land)',
          cite: [H('Lines 37 Through 40')],
          compute: (ctx) => toDollars(ctx.cents(`${hp}.home.basisOrValue`)),
        }),
        defineNode({
          id: id('landValue'),
          label: 'Value of land included on line 37',
          deps: [],
          formula: 'basis (or smaller FMV) of the land',
          cite: [H('Lines 37 Through 40')],
          compute: (ctx) => toDollars(ctx.cents(`${hp}.home.landValue`)),
        }),
        defineNode({
          id: id('buildingBasis'),
          label: 'Basis of building',
          deps: [id('homeBasis'), id('landValue')],
          formula: 'max(0, line 37 - line 38)',
          cite: [H('Lines 37 Through 40')],
          compute: (ctx) =>
            max0(ctx.node(id('homeBasis')) - ctx.node(id('landValue'))),
        }),
        defineNode({
          id: id('businessBasis'),
          label: 'Business basis of building',
          deps: [id('buildingBasis'), id('businessPct')],
          formula: 'line 39 x line 7',
          cite: [H('Lines 37 Through 40')],
          compute: (ctx) =>
            mulRate(ctx.node(id('buildingBasis')), ctx.node(id('businessPct'))),
        }),
        defineNode({
          id: id('depreciationPct'),
          label: 'Depreciation percentage (parts per million: 25,640 = 2.564%)',
          deps: [],
          formula: plan.note,
          cite: [
            H('Line 41'),
            cite('p946', 'Table A-7a'),
            cite(
              'p946',
              'Sale or Other Disposition Before the Recovery Period Ends'
            ),
          ],
          compute: (ctx) => {
            ctx.fact(`${hp}.home.businessUseStart`);
            ctx.fact(`${hp}.monthsUsed`);
            return plan.pctPpm;
          },
        }),
        defineNode({
          id: id('depreciationAllowable'),
          label: 'Depreciation allowable',
          deps: [id('businessBasis'), id('depreciationPct')],
          formula: 'line 40 x line 41',
          cite: [H('Line 42')],
          compute: (ctx) =>
            mulRate(
              ctx.node(id('businessBasis')),
              ctx.node(id('depreciationPct'))
            ),
        }),
      ]
    : [];
  const depDeps = owner ? [id('depreciationAllowable')] : [];

  return [
    defineNode({
      id: id('officeArea'),
      label: 'Area used regularly and exclusively for business (sq ft)',
      deps: [],
      formula: 'office square feet',
      cite: [H('Lines 1 and 2')],
      compute: (ctx) =>
        Math.max(
          0,
          Math.floor(ctx.fact<number>(`${hp}.officeSquareFeet`) ?? 0)
        ),
    }),
    defineNode({
      id: id('homeArea'),
      label: 'Total area of home (sq ft)',
      deps: [],
      formula: 'home square feet',
      cite: [H('Lines 1 and 2')],
      compute: (ctx) =>
        Math.max(0, Math.floor(ctx.fact<number>(`${hp}.homeSquareFeet`) ?? 0)),
    }),
    defineNode({
      id: id('businessPct'),
      label: 'Business percentage (parts per million: 125,000 = 12.5%)',
      deps: [id('officeArea'), id('homeArea')],
      formula: 'line 1 / line 2 (also line 7; no daycare in v1), at most 100%',
      cite: [cite('f8829', 'Lines 3 and 7'), H('Lines 1 and 2')],
      compute: (ctx) => {
        const home = ctx.node(id('homeArea'));
        if (home <= 0) return 0;
        return Math.min(
          1_000_000,
          roundDiv(ctx.node(id('officeArea')) * 1_000_000, home)
        );
      },
    }),
    defineNode({
      id: id('grossIncomeLimit'),
      label: 'Gross income limit (Schedule C line 29)',
      deps: [`schC.tentativeProfit.${o}`],
      formula:
        'Schedule C line 29 (all income assumed earned from the business use of the home; no Form 8949/4797 gains)',
      cite: [H('Line 8')],
      compute: (ctx) => ctx.node(`schC.tentativeProfit.${o}`),
    }),
    defineNode({
      id: id('homeDeductionsBusiness'),
      label:
        'Business part of casualty losses, mortgage interest and real estate taxes (lines 9-13)',
      deps: [],
      formula: '0: standard-deduction filers use lines 16, 17 and 29 instead',
      cite: [
        H('Lines 9, 10, and 11, Taxpayers claiming the standard deduction'),
      ],
      compute: () => 0,
    }),
    defineNode({
      id: id('limitAfterHomeDeductions'),
      label: 'Limit after lines 9-14',
      deps: [id('grossIncomeLimit'), id('homeDeductionsBusiness')],
      formula: 'max(0, line 8 - line 14)',
      cite: [cite('f8829', 'Line 15')],
      compute: (ctx) =>
        max0(
          ctx.node(id('grossIncomeLimit')) -
            ctx.node(id('homeDeductionsBusiness'))
        ),
    }),
    ...lineNodes,
    defineNode({
      id: id('operatingDirect'),
      label: 'Operating expenses, direct (lines 16-22, column (a))',
      deps: direct,
      formula: 'sum of column (a), lines 16-22',
      cite: [cite('f8829', 'Line 23')],
      compute: (ctx) => direct.reduce((s, n) => s + ctx.node(n), 0),
    }),
    defineNode({
      id: id('operatingIndirect'),
      label: 'Operating expenses, indirect (lines 16-22, column (b))',
      deps: indirect,
      formula: 'sum of column (b), lines 16-22',
      cite: [cite('f8829', 'Line 23')],
      compute: (ctx) => indirect.reduce((s, n) => s + ctx.node(n), 0),
    }),
    defineNode({
      id: id('operatingIndirectBusiness'),
      label: 'Business part of indirect operating expenses',
      deps: [id('operatingIndirect'), id('businessPct')],
      formula: 'line 23 column (b) x line 7',
      cite: [cite('f8829', 'Line 24')],
      compute: (ctx) =>
        mulRate(ctx.node(id('operatingIndirect')), ctx.node(id('businessPct'))),
    }),
    defineNode({
      id: id('operatingCarryover'),
      label: 'Carryover of prior year operating expenses',
      deps: [],
      formula: 'prior-year Form 8829 line 43',
      cite: [H('Line 25')],
      compute: (ctx) => toDollars(ctx.cents(`${hp}.carryover.operating`)),
    }),
    defineNode({
      id: id('operatingTotal'),
      label: 'Total operating expenses',
      deps: [
        id('operatingDirect'),
        id('operatingIndirectBusiness'),
        id('operatingCarryover'),
      ],
      formula: 'line 23 column (a) + line 24 + line 25',
      cite: [cite('f8829', 'Line 26')],
      compute: (ctx) =>
        ctx.node(id('operatingDirect')) +
        ctx.node(id('operatingIndirectBusiness')) +
        ctx.node(id('operatingCarryover')),
    }),
    defineNode({
      id: id('operatingAllowed'),
      label: 'Allowable operating expenses',
      deps: [id('limitAfterHomeDeductions'), id('operatingTotal')],
      formula: 'min(line 15, line 26)',
      cite: [cite('f8829', 'Line 27')],
      compute: (ctx) =>
        Math.min(
          ctx.node(id('limitAfterHomeDeductions')),
          ctx.node(id('operatingTotal'))
        ),
    }),
    defineNode({
      id: id('limitAfterOperating'),
      label: 'Limit on excess casualty losses and depreciation',
      deps: [id('limitAfterHomeDeductions'), id('operatingAllowed')],
      formula: 'line 15 - line 27',
      cite: [cite('f8829', 'Line 28')],
      compute: (ctx) =>
        ctx.node(id('limitAfterHomeDeductions')) -
        ctx.node(id('operatingAllowed')),
    }),
    ...partIII,
    defineNode({
      id: id('depreciation'),
      label: 'Depreciation of your home (line 42)',
      deps: depDeps,
      formula: 'line 42',
      cite: [cite('f8829', 'Line 30')],
      compute: (ctx) => (owner ? ctx.node(id('depreciationAllowable')) : 0),
    }),
    defineNode({
      id: id('depreciationCarryover'),
      label: 'Carryover of prior year excess casualty losses and depreciation',
      deps: [],
      formula: 'prior-year Form 8829 line 44',
      cite: [H('Line 31')],
      compute: (ctx) =>
        toDollars(ctx.cents(`${hp}.carryover.casualtyAndDepreciation`)),
    }),
    defineNode({
      id: id('depreciationTotal'),
      label: 'Excess casualty losses and depreciation',
      deps: [id('depreciation'), id('depreciationCarryover')],
      formula: 'line 29 (0) + line 30 + line 31',
      cite: [cite('f8829', 'Line 32')],
      compute: (ctx) =>
        ctx.node(id('depreciation')) + ctx.node(id('depreciationCarryover')),
    }),
    defineNode({
      id: id('depreciationAllowed'),
      label: 'Allowable excess casualty losses and depreciation',
      deps: [id('limitAfterOperating'), id('depreciationTotal')],
      formula: 'min(line 28, line 32)',
      cite: [cite('f8829', 'Line 33')],
      compute: (ctx) =>
        Math.min(
          ctx.node(id('limitAfterOperating')),
          ctx.node(id('depreciationTotal'))
        ),
    }),
    defineNode({
      id: id('totalAllowed'),
      label: 'Total allowable home expenses',
      deps: [
        id('homeDeductionsBusiness'),
        id('operatingAllowed'),
        id('depreciationAllowed'),
      ],
      formula: 'line 14 + line 27 + line 33',
      cite: [cite('f8829', 'Line 34')],
      compute: (ctx) =>
        ctx.node(id('homeDeductionsBusiness')) +
        ctx.node(id('operatingAllowed')) +
        ctx.node(id('depreciationAllowed')),
    }),
    defineNode({
      id: id('allowable'),
      label: 'Allowable expenses for business use of your home',
      deps: [id('totalAllowed')],
      formula:
        'line 34 - line 35 (no casualty loss in v1); to Schedule C line 30',
      cite: [H('Line 36'), cite('i1040sc', 'Line 30')],
      compute: (ctx) => ctx.node(id('totalAllowed')),
    }),
    defineNode({
      id: id('operatingCarryoverOut'),
      label: `Operating expenses carried over to ${facts.taxYear + 1}`,
      deps: [id('operatingTotal'), id('operatingAllowed')],
      formula: 'max(0, line 26 - line 27)',
      cite: [H('Line 43')],
      compute: (ctx) =>
        max0(ctx.node(id('operatingTotal')) - ctx.node(id('operatingAllowed'))),
    }),
    defineNode({
      id: id('depreciationCarryoverOut'),
      label: `Excess casualty losses and depreciation carried over to ${facts.taxYear + 1}`,
      deps: [id('depreciationTotal'), id('depreciationAllowed')],
      formula: 'max(0, line 32 - line 33)',
      cite: [H('Line 44')],
      compute: (ctx) =>
        max0(
          ctx.node(id('depreciationTotal')) -
            ctx.node(id('depreciationAllowed'))
        ),
    }),
  ];
}
