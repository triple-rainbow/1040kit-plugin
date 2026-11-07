/**
 * Earned income credit (Form 1040 line 27a) and Schedule EIC.
 *
 * Eligibility follows the i1040gi 2025 line 27 steps; the amount follows
 * Worksheet A/B: look up earned income in the EIC Table, and when AGI is
 * different and at or above the threshold phaseout amount, also look up AGI
 * and take the smaller (tax/eic.ts reproduces the table).
 *
 * Unknown answers are treated favorably; requiredFacts asks them as blocking
 * questions whenever the credit is possible, so the return can't be complete
 * until they are answered.
 */
import { cite } from '../cite.ts';
import { CHILD_RELATIONSHIPS } from '../dependents.ts';
import { ageAtYearEnd, statusOf } from '../facts.ts';
import { defineNode, type NodeDef } from '../graph.ts';
import { max0 } from '../money.ts';
import type { YearParams } from '../params/index.ts';
import { eicTableCredit, eicThreshold } from '../tax/eic.ts';
import type { Dependent, Person, TaxFacts } from '../types.ts';

const L = (section: string) => cite('i1040gi', section);
const STEP = (n: number, title: string) =>
  L(`Lines 27a, 27b, and 27c—Earned Income Credit (EIC), Step ${n}. ${title}`);

/** i1040gi line 27a Step 3: qualifying child for the EIC (no support or dependency test, unlike the CTC). */
export function isEicQualifyingChild(d: Dependent, facts: TaxFacts): boolean {
  if (d.relationship !== undefined && !CHILD_RELATIONSHIPS.has(d.relationship))
    return false;
  if ((d.monthsLivedWithTaxpayer ?? 12) <= 6) return false;
  // "lived with you in the United States": not possible when your main home was abroad.
  if (facts.taxpayer.livedInUsOverHalfYear === false) return false;
  if (d.permanentlyDisabled === true) return true;
  const age = ageAtYearEnd(d.dateOfBirth, facts.taxYear);
  const ageOk =
    age === undefined || age < 19 || (age < 24 && d.fullTimeStudent !== false);
  if (!ageOk) return false;
  // Younger than you (or your spouse if filing jointly).
  if (!d.dateOfBirth) return true;
  const filers: (Person | undefined)[] =
    statusOf(facts) === 'mfj'
      ? [facts.taxpayer, facts.spouse]
      : [facts.taxpayer];
  return filers.some((p) => !p?.dateOfBirth || d.dateOfBirth! > p.dateOfBirth);
}

export function eicChildren(facts: TaxFacts): Dependent[] {
  return facts.dependents.filter((d) => isEicQualifyingChild(d, facts));
}

export interface EicEligibility {
  eligible: boolean;
  /** Qualifying children with a valid SSN, capped at 3 (the table column). */
  children: number;
  reason: string;
}

/** The i1040gi line 27 steps (amount limits are applied by the table lookups). */
export function eicEligibility(
  facts: TaxFacts,
  params: YearParams,
  amounts: { earnedIncome: number; investmentIncome: number }
): EicEligibility {
  const status = statusOf(facts);
  const mfj = status === 'mfj';
  const filers = mfj
    ? [facts.taxpayer, facts.spouse ?? { id: 'spouse' as const }]
    : [facts.taxpayer];
  const kids = eicChildren(facts).filter((d) => d.hasValidSsn !== false);
  const children = Math.min(3, kids.length);
  const no = (reason: string): EicEligibility => ({
    eligible: false,
    children,
    reason,
  });

  if (amounts.earnedIncome <= 0) return no('no earned income');
  if (filers.some((p) => p.hasValidSsn === false))
    return no('a filer has no SSN valid for the EIC (Step 1, question 2)');
  if (amounts.investmentIncome > params.eitc.investmentIncomeLimit)
    return no(
      `investment income is more than $${params.eitc.investmentIncomeLimit.toLocaleString('en-US')} (Step 2)`
    );
  if (children > 0) {
    if (!mfj && facts.taxpayer.qualifyingChildOfAnother === true)
      return no(
        'you could be the qualifying child of another person (Step 3, question 6)'
      );
    return {
      eligible: true,
      children,
      reason: `${children} qualifying child(ren) with a valid SSN`,
    };
  }
  // Step 4: filers without a qualifying child (also when a qualifying child has no valid SSN).
  const { bornAfter, bornBefore } = params.eitc.noChildAge;
  const ageOk = filers.some(
    (p) =>
      !p.dateOfBirth ||
      (p.dateOfBirth > bornAfter && p.dateOfBirth < bornBefore)
  );
  if (!ageOk)
    return no(
      'without a qualifying child you (or your spouse) must be at least 25 and under 65 (Step 4, question 2)'
    );
  if (filers.some((p) => p.livedInUsOverHalfYear === false))
    return no(
      'main home not in the United States for more than half the year (Step 4, question 3)'
    );
  if (!mfj) {
    if (facts.taxpayer.qualifyingChildOfAnother === true)
      return no(
        'you could be the qualifying child of another person (Step 4, question 5)'
      );
    if (facts.taxpayer.canBeClaimedAsDependent === true)
      return no('you can be claimed as a dependent (Step 4, question 6)');
  }
  return {
    eligible: true,
    children: 0,
    reason: 'no qualifying child (Step 4 tests met)',
  };
}

export function eicNodes(facts: TaxFacts, params: YearParams): NodeDef[] {
  const status = statusOf(facts);
  const rows = eicChildren(facts).slice(0, 3);
  const readEligibilityFacts = (ctx: { fact(p: string): unknown }) => {
    for (const p of ['taxpayer', ...(status === 'mfj' ? ['spouse'] : [])]) {
      for (const f of [
        'hasValidSsn',
        'dateOfBirth',
        'livedInUsOverHalfYear',
        'qualifyingChildOfAnother',
        'canBeClaimedAsDependent',
      ])
        ctx.fact(`${p}.${f}`);
    }
    for (const d of facts.dependents) {
      for (const f of [
        'relationship',
        'dateOfBirth',
        'monthsLivedWithTaxpayer',
        'fullTimeStudent',
        'permanentlyDisabled',
        'hasValidSsn',
      ])
        ctx.fact(`dependents[${d.id}].${f}`);
    }
  };

  const nodes: NodeDef[] = [
    defineNode({
      id: 'eic.investmentIncome',
      label: 'Investment income for the EIC',
      deps: [
        'taxExemptInterest',
        'taxableInterest',
        'ordinaryDividends',
        'capitalGainDistributions',
        'schE.royaltyNet',
        'schE.rentalRealEstateNet',
      ],
      formula:
        'lines 2a + 2b + 3b + 7a (not below 0) + net royalties (not below 0) + net passive rental income (not below 0)',
      cite: [STEP(2, 'Investment Income'), cite('p596', 'Rule 6, Worksheet 1')],
      compute: (ctx) =>
        ctx.node('taxExemptInterest') +
        ctx.node('taxableInterest') +
        ctx.node('ordinaryDividends') +
        max0(ctx.node('capitalGainDistributions')) +
        max0(ctx.node('schE.royaltyNet')) +
        max0(ctx.node('schE.rentalRealEstateNet')),
    }),
    defineNode({
      id: 'eic.qualifyingChildren',
      label: 'Qualifying children for the EIC with a valid SSN (at most 3)',
      deps: ['earnedIncome', 'eic.investmentIncome'],
      formula:
        'count of EIC qualifying children (Step 3) with a valid SSN, at most 3; 0 when not eligible',
      cite: [STEP(3, 'Qualifying Child'), L('Social security number (SSN)')],
      compute: (ctx) => {
        readEligibilityFacts(ctx);
        const e = eicEligibility(facts, params, {
          earnedIncome: ctx.node('earnedIncome'),
          investmentIncome: ctx.node('eic.investmentIncome'),
        });
        ctx.param('eic.eligibility', e.reason);
        return e.eligible ? e.children : 0;
      },
    }),
    defineNode({
      id: 'eic.eligible',
      label: 'Eligible for the EIC (1 = yes, 0 = no)',
      deps: ['earnedIncome', 'eic.investmentIncome'],
      formula: 'i1040gi line 27a Steps 1-5',
      cite: [
        STEP(1, 'All Filers'),
        STEP(2, 'Investment Income'),
        STEP(3, 'Qualifying Child'),
        STEP(4, 'Filers Without a Qualifying Child'),
        STEP(5, 'Earned Income'),
      ],
      compute: (ctx) => {
        readEligibilityFacts(ctx);
        const e = eicEligibility(facts, params, {
          earnedIncome: ctx.node('earnedIncome'),
          investmentIncome: ctx.node('eic.investmentIncome'),
        });
        ctx.param('eic.eligibility', e.reason);
        return e.eligible ? 1 : 0;
      },
    }),
    defineNode({
      id: 'eic.creditOnEarnedIncome',
      label:
        'EIC Table credit on earned income (Worksheet A line 2 / B line 7)',
      deps: ['earnedIncome', 'eic.qualifyingChildren', 'eic.eligible'],
      formula: 'EIC Table(earned income, filing status, qualifying children)',
      cite: [
        L('Worksheet A—2025 EIC—Line 27a'),
        L('Worksheet B—2025 EIC —Lines 27a'),
        L('EIC Table'),
      ],
      compute: (ctx) =>
        ctx.node('eic.eligible') === 1
          ? eicTableCredit(
              ctx.node('earnedIncome'),
              status,
              ctx.node('eic.qualifyingChildren'),
              params
            )
          : 0,
    }),
    defineNode({
      id: 'eic.creditOnAgi',
      label: 'EIC Table credit on AGI (Worksheet A line 5 / B line 10)',
      deps: [
        'agi',
        'earnedIncome',
        'eic.qualifyingChildren',
        'eic.creditOnEarnedIncome',
      ],
      formula:
        'when AGI differs from earned income and is at least the threshold phaseout amount: EIC Table(AGI); otherwise the line 2 amount',
      cite: [
        L('Worksheet A—2025 EIC—Line 27a'),
        L('Worksheet B—2025 EIC —Lines 27a'),
      ],
      compute: (ctx) => {
        const agi = ctx.node('agi');
        const kids = ctx.node('eic.qualifyingChildren');
        const l2 = ctx.node('eic.creditOnEarnedIncome');
        if (l2 === 0) return 0;
        if (agi === ctx.node('earnedIncome')) return l2;
        const th = ctx.param(
          `eitc.threshold.${status}.${kids}`,
          eicThreshold(status, kids, params)
        );
        if (agi < th) return l2;
        return eicTableCredit(agi, status, kids, params);
      },
    }),
    defineNode({
      id: 'eic',
      label: 'Earned income credit (EIC)',
      deps: ['eic.creditOnEarnedIncome', 'eic.creditOnAgi'],
      formula:
        'smaller of Worksheet line 2 and line 5 (A) / line 7 and line 10 (B)',
      cite: [
        L('Lines 27a, 27b, and 27c— Earned Income Credit (EIC)'),
        cite('p596'),
      ],
      compute: (ctx) =>
        Math.min(
          ctx.node('eic.creditOnEarnedIncome'),
          ctx.node('eic.creditOnAgi')
        ),
    }),
  ];

  // Schedule EIC rows (child n = 1..3, in dependents order). Names and SSNs are printed by the MCP.
  rows.forEach((d, i) => {
    const n = i + 1;
    const dp = `dependents[${d.id}]`;
    const at = (line: string) => ({
      form: 'schEIC' as const,
      line: `${line}:${n}`,
    });
    const birthYear = d.dateOfBirth ? Number(d.dateOfBirth.slice(0, 4)) : 0;
    const filerDob = [
      facts.taxpayer.dateOfBirth,
      status === 'mfj' ? facts.spouse?.dateOfBirth : undefined,
    ].filter(Boolean) as string[];
    const younger =
      !d.dateOfBirth ||
      filerDob.length === 0 ||
      filerDob.some((x) => d.dateOfBirth! > x);
    const skip4 = birthYear > facts.taxYear - 19 && younger;
    nodes.push(
      defineNode({
        id: `schEIC.yearOfBirth.${d.id}`,
        label: `Child ${n}: year of birth`,
        deps: [],
        formula: 'year of the date of birth',
        cite: [cite('f1040sei', 'Line 3')],
        at: at('3'),
        compute: (ctx) => {
          ctx.fact(`${dp}.dateOfBirth`);
          return birthYear;
        },
      })
    );
    if (!skip4) {
      nodes.push(
        defineNode({
          id: `schEIC.student.${d.id}`,
          label: `Child ${n}: under 24, a student, and younger than you (1 = yes, 0 = no)`,
          deps: [],
          formula:
            'full-time student under 24 at year end and younger than you (or your spouse)',
          cite: [cite('f1040sei', 'Line 4a'), L('Full-time student.')],
          at: at('4a'),
          compute: (ctx) => {
            const age = ageAtYearEnd(
              ctx.fact<string>(`${dp}.dateOfBirth`),
              facts.taxYear
            );
            return ctx.fact<boolean>(`${dp}.fullTimeStudent`) === true &&
              age !== undefined &&
              age < 24 &&
              younger
              ? 1
              : 0;
          },
        })
      );
      const student =
        d.fullTimeStudent === true &&
        (ageAtYearEnd(d.dateOfBirth, facts.taxYear) ?? 99) < 24 &&
        younger;
      if (!student) {
        nodes.push(
          defineNode({
            id: `schEIC.disabled.${d.id}`,
            label: `Child ${n}: permanently and totally disabled (1 = yes, 0 = no)`,
            deps: [],
            formula:
              'permanently and totally disabled during any part of the year',
            cite: [
              cite('f1040sei', 'Line 4b'),
              L('Permanently and totally disabled.'),
            ],
            at: at('4b'),
            compute: (ctx) =>
              ctx.fact<boolean>(`${dp}.permanentlyDisabled`) === true ? 1 : 0,
          })
        );
      }
    }
    nodes.push(
      defineNode({
        id: `schEIC.relationship.${d.id}`,
        label: `Child ${n}: relationship to you (see the fact in the trace; value is 0)`,
        deps: [],
        formula: 'relationship (text, printed from the dependent facts)',
        cite: [cite('f1040sei', 'Line 5')],
        at: at('5'),
        compute: (ctx) => {
          ctx.fact(`${dp}.relationship`);
          return 0;
        },
      }),
      defineNode({
        id: `schEIC.monthsLived.${d.id}`,
        label: `Child ${n}: months the child lived with you in the United States`,
        deps: [],
        formula:
          'months lived with you (more than 6 enters at least 7), at most 12',
        cite: [cite('f1040sei', 'Line 6')],
        at: at('6'),
        compute: (ctx) => {
          const m = ctx.fact<number>(`${dp}.monthsLivedWithTaxpayer`) ?? 12;
          return Math.min(12, Math.max(7, Math.floor(m)));
        },
      })
    );
  });
  return nodes;
}
