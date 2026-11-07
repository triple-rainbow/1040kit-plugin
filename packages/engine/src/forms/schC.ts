/**
 * Schedule C (Profit or Loss From Business), one per person in v1.
 * Node ids: schC.<line name>.<owner>.
 */
import { cite } from '../cite.ts';
import { ownersOnReturn } from '../facts.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import {
  centsTimesRateToDollars,
  max0,
  roundDiv,
  sumCents,
  toDollars,
} from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type {
  Business,
  PersonId,
  ScheduleCExpense,
  TaxFacts,
} from '../types.ts';

const C = (section: string) => cite('i1040sc', section);

const EXPENSE_LABELS: Record<ScheduleCExpense, string> = {
  advertising: 'Advertising',
  car_truck: 'Car and truck expenses',
  commissions: 'Commissions and fees',
  contract_labor: 'Contract labor',
  depreciation_section179: 'Depreciation and section 179 expense',
  insurance: 'Insurance (other than health)',
  interest_other: 'Interest (other)',
  legal_professional: 'Legal and professional services',
  office: 'Office expense',
  rent_equipment: 'Rent or lease: vehicles, machinery, and equipment',
  rent_property: 'Rent or lease: other business property',
  repairs: 'Repairs and maintenance',
  supplies: 'Supplies',
  taxes_licenses: 'Taxes and licenses',
  travel: 'Travel',
  meals: 'Deductible meals',
  utilities: 'Utilities',
  wages: 'Wages',
  other: 'Other expenses',
};

/** The (first) Schedule C business of each person on the return. */
export function businessesOnReturn(facts: TaxFacts): Business[] {
  const out: Business[] = [];
  for (const o of ownersOnReturn(facts)) {
    const b = facts.businesses.find((x) => x.owner === o);
    if (b) out.push(b);
  }
  return out;
}

export function schCNodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const nodes: NodeDef[] = [];
  for (const b of businessesOnReturn(facts))
    nodes.push(...oneBusiness(facts, params, b.owner, b));
  return nodes;
}

function oneBusiness(
  facts: TaxFacts,
  params: YearParams,
  o: PersonId,
  b: Business
): NodeDef[] {
  const id = (name: string) => `schC.${name}.${o}`;
  const bp = `businesses[${o}]`;
  const necs = facts.nec1099s.filter((n) => n.owner === o);
  const ks = facts.k1099s.filter((k) => k.owner === o);
  const miscs = facts.misc1099s.filter(
    (m) => m.owner === o && m.treatAsBusiness === true
  );

  const expenseNodes: NodeDef[] = [];
  const categories = new Set<ScheduleCExpense>(
    (Object.keys(b.expenses) as ScheduleCExpense[]).filter(
      (k) => b.expenses[k] !== undefined
    )
  );
  if (b.vehicle) categories.add('car_truck');
  for (const cat of Object.keys(EXPENSE_LABELS) as ScheduleCExpense[]) {
    if (!categories.has(cat)) continue;
    if (cat === 'car_truck' && b.vehicle) {
      expenseNodes.push(
        defineNode({
          id: id('expense.car_truck'),
          label: 'Car and truck expenses (standard mileage rate)',
          deps: [],
          formula:
            'business miles x standard mileage rate (replaces actual car expenses)',
          cite: [C('Line 9'), cite('p463', 'Standard Mileage Rate')],
          compute: (ctx) => {
            const miles = ctx.fact<number>(`${bp}.vehicle.businessMiles`) ?? 0;
            const rate = ctx.param(
              'mileageRateTenthCents',
              params.mileageRateTenthCents
            );
            return roundDiv(Math.round(miles) * rate, 1000);
          },
        })
      );
    } else if (cat === 'meals') {
      expenseNodes.push(
        defineNode({
          id: id('expense.meals'),
          label: 'Deductible meals (50%)',
          deps: [],
          formula: 'business meals paid x 50%',
          cite: [C('Line 24b')],
          compute: (ctx) =>
            centsTimesRateToDollars(
              ctx.cents(`${bp}.expenses.meals`),
              ctx.param('mealsPpm', params.mealsPpm)
            ),
        })
      );
    } else {
      expenseNodes.push(
        defineNode({
          id: id(`expense.${cat}`),
          label: EXPENSE_LABELS[cat],
          deps: [],
          formula: `${EXPENSE_LABELS[cat].toLowerCase()} paid`,
          cite: [
            C(
              `Line ${params.formLines[id(`expense.${cat}`)]?.line ?? ''}`.trim()
            ),
          ],
          compute: (ctx) => toDollars(ctx.cents(`${bp}.expenses.${cat}`)),
        })
      );
    }
  }

  return [
    defineNode({
      id: id('grossReceipts'),
      label: 'Gross receipts or sales',
      deps: [],
      formula:
        '1099-NEC box 1 + 1099-K box 1a - personal portion + 1099-MISC boxes 1-3 (business) + other receipts',
      cite: [C('Line 1'), cite('i1040gi', 'Schedule 1, Form(s) 1099-K')],
      compute: (ctx) =>
        toDollars(
          sumCents([
            ...necs.map((n) => ctx.cents(`nec1099s[${n.id}].nonemployeeComp`)),
            ...ks.flatMap((k) => [
              ctx.cents(`k1099s[${k.id}].grossAmount`),
              -ctx.cents(`k1099s[${k.id}].personalPortion`),
            ]),
            ...miscs.flatMap((m) => [
              ctx.cents(`misc1099s[${m.id}].rents`),
              ctx.cents(`misc1099s[${m.id}].royalties`),
              ctx.cents(`misc1099s[${m.id}].otherIncome`),
            ]),
            ctx.cents(`${bp}.grossReceiptsOther`),
          ])
        ),
    }),
    defineNode({
      id: id('returns'),
      label: 'Returns and allowances',
      deps: [],
      formula: 'returns and allowances',
      cite: [C('Line 2')],
      compute: (ctx) => toDollars(ctx.cents(`${bp}.returnsAllowances`)),
    }),
    defineNode({
      id: id('grossIncome'),
      label: 'Gross income',
      deps: [id('grossReceipts'), id('returns')],
      formula: 'line 1 - line 2 (no cost of goods sold or other income in v1)',
      cite: [C('Line 7')],
      compute: (ctx) => ctx.node(id('grossReceipts')) - ctx.node(id('returns')),
    }),
    ...expenseNodes,
    defineNode({
      id: id('totalExpenses'),
      label: 'Total expenses before business use of home',
      deps: expenseNodes.map((n) => n.id),
      formula: 'sum of lines 8 through 27b',
      cite: [C('Line 28')],
      compute: (ctx) => expenseNodes.reduce((s, n) => s + ctx.node(n.id), 0),
    }),
    defineNode({
      id: id('tentativeProfit'),
      label: 'Tentative profit or (loss)',
      deps: [id('grossIncome'), id('totalExpenses')],
      formula: 'line 7 - line 28',
      cite: [C('Line 29')],
      compute: (ctx) =>
        ctx.node(id('grossIncome')) - ctx.node(id('totalExpenses')),
    }),
    b.homeOffice?.method === 'actual'
      ? defineNode({
          id: id('homeOffice'),
          label: 'Expenses for business use of your home (Form 8829)',
          deps: [`f8829.allowable.${o}`],
          formula: 'Form 8829 line 36',
          cite: [C('Line 30'), cite('i8829', 'Line 36')],
          compute: (ctx) => ctx.node(`f8829.allowable.${o}`),
        })
      : defineNode({
          id: id('homeOffice'),
          label: 'Expenses for business use of your home (simplified method)',
          deps: [id('tentativeProfit')],
          formula: 'min(sq ft, 300) x $5, limited to line 29 (not below 0)',
          cite: [
            C('Line 30, Simplified Method Worksheet'),
            cite('p587', 'Simplified Amount'),
          ],
          compute: (ctx) => {
            const method = ctx.fact<string>(`${bp}.homeOffice.method`);
            if (method !== 'simplified') return 0;
            const sqft = Math.max(
              0,
              Math.floor(ctx.fact<number>(`${bp}.homeOffice.squareFeet`) ?? 0)
            );
            const maxSq = ctx.param(
              'homeOffice.maxSqFt',
              params.homeOffice.maxSqFt
            );
            const rate = ctx.param(
              'homeOffice.ratePerSqFt',
              params.homeOffice.ratePerSqFt
            );
            return Math.min(
              Math.min(sqft, maxSq) * rate,
              max0(ctx.node(id('tentativeProfit')))
            );
          },
        }),
    defineNode({
      id: id('netProfit'),
      label: 'Net profit or (loss)',
      deps: [id('tentativeProfit'), id('homeOffice')],
      formula:
        'line 29 - line 30 (a loss assumes all investment is at risk, line 32a)',
      cite: [C('Line 31')],
      compute: (ctx) =>
        ctx.node(id('tentativeProfit')) - ctx.node(id('homeOffice')),
    }),
  ];
}
