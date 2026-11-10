/**
 * Schedule E, Part I (rental real estate and royalties), no depreciation.
 *
 * Columns A, B, C… follow `rentals` id order among the properties reported.
 * Per-property node ids: schE.<line name>.<rental id>, printed as "3:A" etc.
 * Losses (lines 21, 22, 25) are negative numbers; the form shows them in
 * parentheses.
 *
 * Not computed (scope.ts flags them): depreciation (line 18, Form 4562),
 * passive loss limits beyond the i1040se exception (Form 8582), vacation-home
 * expense limits (used as a home and rented 15+ days), self-rentals, more
 * than 3 properties.
 */
import { cite } from '../cite.ts';
import { statusOf } from '../facts.ts';
import { defineNode, type NodeContext, type NodeDef } from '../graph.ts';
import { max0, roundDiv, sumCents, toDollars } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import type {
  Form1099Misc,
  RentalProperty,
  ScheduleEExpense,
  TaxFacts,
} from '../types.ts';

const E = (section: string) => cite('i1040se', section);

const EXPENSE_LABELS: Record<ScheduleEExpense, string> = {
  advertising: 'Advertising',
  auto_travel: 'Auto and travel',
  cleaning_maintenance: 'Cleaning and maintenance',
  commissions: 'Commissions',
  insurance: 'Insurance',
  legal_professional: 'Legal and other professional fees',
  management_fees: 'Management fees',
  mortgage_interest: 'Mortgage interest paid to banks, etc.',
  other_interest: 'Other interest',
  repairs: 'Repairs',
  supplies: 'Supplies',
  taxes: 'Taxes',
  utilities: 'Utilities',
  other: 'Other',
};

/**
 * Expenses that belong only to the rental part and are not divided by days
 * (Pub. 527 ch. 5, Dividing Expenses: "You don't have to divide the expenses
 * that belong only to the rental part"; Worksheet 5-1 line 2d: rental agency
 * fees, advertising). Every other category is divided by rental days / total days.
 */
const RENTAL_ONLY: ReadonlySet<ScheduleEExpense> = new Set([
  'advertising',
  'commissions',
  'management_fees',
  'legal_professional',
]);

export interface RentalPlan {
  r: RentalProperty;
  royalty: boolean;
  fairDays: number;
  personalDays: number;
  /** Personal use more than the greater of 14 days or 10% of fair rental days (§280A(d)). */
  usedAsHome: boolean;
  /** Used as a home and rented fewer than 15 days: not reported at all (§280A(g)). */
  notReported: boolean;
  /** Column letter on Schedule E, or null when not reported. */
  column: string | null;
  miscs: Form1099Misc[];
}

const byId = (a: { id: string }, b: { id: string }) =>
  a.id.localeCompare(b.id, 'en', { numeric: true });

/** Rentals on this return: the taxpayer's, joint ones, and the spouse's on a joint return. */
export function rentalsOnReturn(facts: TaxFacts): RentalProperty[] {
  const mfj = statusOf(facts) === 'mfj';
  return (facts.rentals ?? [])
    .filter((r) => r.owner !== 'spouse' || mfj)
    .slice()
    .sort(byId);
}

/** 1099-MISC ids linked to a rental: its `misc1099Ids` and every 1099-MISC whose `rentalId` names it. */
export function rentalMiscIds(facts: TaxFacts, r: RentalProperty): string[] {
  const ids = new Set(r.misc1099Ids ?? []);
  for (const m of facts.misc1099s ?? []) if (m.rentalId === r.id) ids.add(m.id);
  return [...ids];
}

/** Non-business 1099-MISCs on the return whose box 1/2 a rental claims. */
export function linkedMiscs(
  facts: TaxFacts,
  r: RentalProperty
): Form1099Misc[] {
  const ids = new Set(rentalMiscIds(facts, r));
  const owners =
    statusOf(facts) === 'mfj' ? ['taxpayer', 'spouse'] : ['taxpayer'];
  return (facts.misc1099s ?? []).filter(
    (m) =>
      ids.has(m.id) && m.treatAsBusiness !== true && owners.includes(m.owner)
  );
}

export function planRentals(facts: TaxFacts, params: YearParams): RentalPlan[] {
  const v = params.vacationHome;
  const plans: RentalPlan[] = [];
  let col = 0;
  for (const r of rentalsOnReturn(facts)) {
    const royalty = r.propertyType === 6;
    const fairDays = Math.max(0, Math.floor(r.fairRentalDays ?? 0));
    const personalDays = Math.max(0, Math.floor(r.personalUseDays ?? 0));
    const usedAsHome =
      !royalty &&
      personalDays > v.minPersonalDays &&
      personalDays * 1_000_000 > fairDays * v.personalPpm;
    const notReported = usedAsHome && fairDays < v.minRentalDays;
    const column = notReported ? null : columnLetter(col++);
    plans.push({
      r,
      royalty,
      fairDays,
      personalDays,
      usedAsHome,
      notReported,
      column,
      miscs: linkedMiscs(facts, r),
    });
  }
  return plans;
}

function columnLetter(i: number): string {
  return String.fromCharCode(65 + i);
}

export function schENodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const plans = planRentals(facts, params).filter((p) => p.column !== null);
  const nodes: NodeDef[] = [];
  const net: string[] = [];
  const royaltyNet: string[] = [];
  const realEstateNet: string[] = [];
  const allowedLoss: string[] = [];
  const rents: string[] = [];
  const royalties: string[] = [];
  const mortgage: string[] = [];
  const totals: string[] = [];

  for (const p of plans) {
    const r = p.r;
    const c = p.column!;
    const rp = `rentals[${r.id}]`;
    const id = (name: string) => `schE.${name}.${r.id}`;
    const at = (line: string) => ({
      form: 'schE' as const,
      line: `${line}:${c}`,
    });
    const divide = !p.royalty && p.personalDays > 0 && p.fairDays > 0;
    const totalDays = p.fairDays + p.personalDays;

    nodes.push(
      defineNode({
        id: id('type'),
        label: `Property ${c}: type of property (code 1-8)`,
        deps: [],
        formula: 'Schedule E line 1b property type code',
        cite: [E('Line 1b')],
        at: at('1b'),
        compute: (ctx) => ctx.fact<number>(`${rp}.propertyType`) ?? 0,
      })
    );
    if (!p.royalty) {
      nodes.push(
        defineNode({
          id: id('fairRentalDays'),
          label: `Property ${c}: fair rental days`,
          deps: [],
          formula: 'days rented at a fair rental price',
          cite: [E('Line 2')],
          at: at('2.fair'),
          compute: (ctx) => {
            ctx.fact(`${rp}.fairRentalDays`);
            return p.fairDays;
          },
        }),
        defineNode({
          id: id('personalUseDays'),
          label: `Property ${c}: personal use days`,
          deps: [],
          formula: 'days of personal use',
          cite: [E('Line 2')],
          at: at('2.personal'),
          compute: (ctx) => {
            ctx.fact(`${rp}.personalUseDays`);
            return p.personalDays;
          },
        })
      );
    }
    const linked = p.miscs;
    nodes.push(
      defineNode({
        id: id('rents'),
        label: `Property ${c}: rents received`,
        deps: [],
        formula:
          '1099-MISC box 1 linked to this property + rents not on a 1099',
        cite: [E('Line 3')],
        at: at('3'),
        compute: (ctx) =>
          toDollars(
            sumCents([
              ...linked.map((m) => ctx.cents(`misc1099s[${m.id}].rents`)),
              ctx.cents(`${rp}.rentsOther`),
            ])
          ),
      }),
      defineNode({
        id: id('royalties'),
        label: `Property ${c}: royalties received`,
        deps: [],
        formula:
          '1099-MISC box 2 linked to this property + royalties not on a 1099',
        cite: [E('Line 4')],
        at: at('4'),
        compute: (ctx) =>
          toDollars(
            sumCents([
              ...linked.map((m) => ctx.cents(`misc1099s[${m.id}].royalties`)),
              ctx.cents(`${rp}.royaltiesOther`),
            ])
          ),
      })
    );
    rents.push(id('rents'));
    royalties.push(id('royalties'));

    const expenseIds: string[] = [];
    for (const cat of Object.keys(EXPENSE_LABELS) as ScheduleEExpense[]) {
      if (r.expenses?.[cat] === undefined) continue;
      const split = divide && !RENTAL_ONLY.has(cat);
      expenseIds.push(id(`expense.${cat}`));
      if (cat === 'mortgage_interest') mortgage.push(id(`expense.${cat}`));
      nodes.push(
        defineNode({
          id: id(`expense.${cat}`),
          label: `Property ${c}: ${EXPENSE_LABELS[cat].toLowerCase()}${split ? ' (rental share)' : ''}`,
          deps: [],
          formula: split
            ? 'amount paid x fair rental days / (fair rental days + personal use days)'
            : 'amount paid',
          cite: split
            ? [
                E(`Line ${params.schEExpenseLines[cat]}`),
                E('Line 2'),
                cite('p527', 'Dividing Expenses'),
              ]
            : [E(`Line ${params.schEExpenseLines[cat]}`)],
          at: at(params.schEExpenseLines[cat]),
          compute: (ctx) => {
            const cents = ctx.cents(`${rp}.expenses.${cat}`);
            if (!split) return toDollars(cents);
            ctx.param('rentalDays', p.fairDays);
            ctx.param('totalDays', totalDays);
            return roundDiv(cents * p.fairDays, totalDays * 100);
          },
        })
      );
    }
    nodes.push(
      defineNode({
        id: id('totalExpenses'),
        label: `Property ${c}: total expenses`,
        deps: expenseIds,
        formula:
          'lines 5 through 19 (line 18 depreciation is not computed in v1)',
        cite: [E('General Instructions for Lines 5 Through 21')],
        at: at('20'),
        compute: (ctx) => expenseIds.reduce((s, e) => s + ctx.node(e), 0),
      }),
      defineNode({
        id: id('net'),
        label: `Property ${c}: income or (loss)`,
        deps: [id('rents'), id('royalties'), id('totalExpenses')],
        formula: 'line 3 + line 4 - line 20',
        cite: [E('Line 21')],
        at: at('21'),
        compute: (ctx) =>
          ctx.node(id('rents')) +
          ctx.node(id('royalties')) -
          ctx.node(id('totalExpenses')),
      })
    );
    totals.push(id('totalExpenses'));
    net.push(id('net'));
    if (p.royalty) {
      royaltyNet.push(id('net'));
    } else {
      realEstateNet.push(id('net'));
      nodes.push(
        defineNode({
          id: id('deductibleLoss'),
          label: `Property ${c}: deductible rental real estate loss`,
          deps: [id('net')],
          formula:
            'the line 21 loss, allowed in full under the i1040se exception for rental real estate with active participation (no Form 8582); 0 when line 21 is not a loss',
          cite: [
            E('Line 22'),
            E('Exception for Certain Rental Real Estate Activities'),
            cite('p925', 'Special $25,000 allowance'),
          ],
          at: at('22'),
          compute: (ctx) => Math.min(0, ctx.node(id('net'))),
        })
      );
      allowedLoss.push(id('deductibleLoss'));
    }
  }

  const sum = (ids: string[]) => (ctx: NodeContext) =>
    ids.reduce((s, i) => s + ctx.node(i), 0);
  const royaltyPlans = plans
    .filter((p) => p.royalty)
    .map((p) => `schE.net.${p.r.id}`);

  nodes.push(
    defineNode({
      id: 'schE.totalRents',
      label: 'Total rents for all rental properties',
      deps: rents,
      formula: 'sum of line 3',
      cite: [E('General Instructions for Lines 5 Through 21')],
      compute: sum(rents),
    }),
    defineNode({
      id: 'schE.totalRoyalties',
      label: 'Total royalties for all royalty properties',
      deps: royalties,
      formula: 'sum of line 4',
      cite: [E('General Instructions for Lines 5 Through 21')],
      compute: sum(royalties),
    }),
    defineNode({
      id: 'schE.totalMortgageInterest',
      label: 'Total mortgage interest for all properties',
      deps: mortgage,
      formula: 'sum of line 12',
      cite: [E('General Instructions for Lines 5 Through 21')],
      compute: sum(mortgage),
    }),
    defineNode({
      id: 'schE.totalDepreciation',
      label: 'Total depreciation and depletion for all properties',
      deps: [],
      formula:
        'sum of line 18 (depreciation is not computed in v1; owned property is flagged)',
      cite: [E('Line 18')],
      compute: () => 0,
    }),
    defineNode({
      id: 'schE.totalExpenses',
      label: 'Total expenses for all properties',
      deps: totals,
      formula: 'sum of line 20',
      cite: [E('General Instructions for Lines 5 Through 21')],
      compute: sum(totals),
    }),
    defineNode({
      id: 'schE.income',
      label: 'Income: positive amounts on line 21',
      deps: net,
      formula: 'sum of line 21 amounts above 0',
      cite: [cite('f1040se', 'Line 24')],
      compute: (ctx) => net.reduce((s, i) => s + max0(ctx.node(i)), 0),
    }),
    defineNode({
      id: 'schE.losses',
      label:
        'Losses: royalty losses (line 21) and rental real estate losses (line 22), as a negative amount',
      deps: [...royaltyPlans, ...allowedLoss],
      formula: 'sum of royalty losses on line 21 + sum of line 22',
      cite: [cite('f1040se', 'Line 25'), E('Line 22')],
      compute: (ctx) =>
        royaltyPlans.reduce((s, i) => s + Math.min(0, ctx.node(i)), 0) +
        allowedLoss.reduce((s, i) => s + ctx.node(i), 0),
    }),
    defineNode({
      id: 'schE.total',
      label: 'Total rental real estate and royalty income or (loss)',
      deps: ['schE.income', 'schE.losses'],
      formula: 'line 24 + line 25',
      cite: [cite('f1040se', 'Line 26')],
      compute: (ctx) => ctx.node('schE.income') + ctx.node('schE.losses'),
    }),
    defineNode({
      id: 'rentalRoyaltyIncome',
      label: 'Rental real estate and royalty income or (loss) from Schedule E',
      deps: ['schE.total'],
      formula: 'Schedule E line 26 (no Parts II-IV in v1)',
      cite: [cite('i1040gi', 'Schedule 1, Line 5')],
      compute: (ctx) => ctx.node('schE.total'),
    }),
    defineNode({
      id: 'schE.royaltyNet',
      label: 'Net royalty income or (loss) (line 21, royalty properties)',
      deps: royaltyNet,
      formula: 'sum of line 21 for royalty properties (code 6)',
      cite: [E('Line 4'), cite('p596', 'Rule 6, Worksheet 1, lines 8-10')],
      compute: sum(royaltyNet),
    }),
    defineNode({
      id: 'schE.rentalRealEstateNet',
      label: 'Net rental real estate income or (loss) after line 22',
      deps: [...realEstateNet, ...allowedLoss],
      formula: 'sum of positive line 21 + line 22 for rental real estate',
      cite: [E('Line 22'), cite('p925')],
      compute: (ctx) =>
        realEstateNet.reduce((s, i) => s + max0(ctx.node(i)), 0) +
        allowedLoss.reduce((s, i) => s + ctx.node(i), 0),
    }),
    defineNode({
      id: 'schE.passiveMagi',
      label:
        'Modified AGI for the rental real estate loss exception (no passive income or loss, SE tax deduction or student loan interest)',
      deps: [
        'totalWages',
        'taxableInterest',
        'ordinaryDividends',
        'capitalGainDistributions',
        'businessIncome',
        'totalOtherIncome',
        'schE.royaltyNet',
        'sepDeduction',
        'sehiDeduction',
        'earlyWithdrawalPenalty',
      ],
      formula:
        'AGI figured without rental real estate income or loss, the deductible part of SE tax and the student loan interest deduction',
      cite: [
        cite(
          'p925',
          'Special $25,000 allowance, Modified adjusted gross income'
        ),
        E('Exception for Certain Rental Real Estate Activities'),
      ],
      compute: (ctx) =>
        ctx.node('totalWages') +
        ctx.node('taxableInterest') +
        ctx.node('ordinaryDividends') +
        ctx.node('capitalGainDistributions') +
        ctx.node('businessIncome') +
        ctx.node('totalOtherIncome') +
        ctx.node('schE.royaltyNet') -
        ctx.node('sepDeduction') -
        ctx.node('sehiDeduction') -
        ctx.node('earlyWithdrawalPenalty'),
    })
  );
  return nodes;
}
