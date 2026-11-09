/**
 * checkScope: situations 1040kit v1 does not compute. Anything here makes the
 * return incomplete; the agent explains it and points to the deferral, never
 * guesses (spec §5).
 */
import { computeCore, type CoreResult } from './compute.ts';
import { ownedOnReturn, ownersOnReturn, statusOf } from './facts.ts';
import { depreciationPlan, f8829Businesses } from './forms/f8829.ts';
import { planRentals } from './forms/schE.ts';
import { mulRate, sumCents } from './money.ts';
import type {
  HomeOfficeActual,
  OutOfScopeFlags,
  TaxFacts,
  UnsupportedItem,
} from './types.ts';

type FlagKey = Exclude<keyof OutOfScopeFlags, 'other'>;

const FLAG_ITEMS: Record<FlagKey, UnsupportedItem> = {
  retirementDistributions: {
    code: 'retirement_distributions',
    message:
      'Retirement, pension or IRA distributions (Form 1099-R) are not supported yet.',
    deferredTo: 'v1.1',
  },
  socialSecurityBenefits: {
    code: 'social_security_benefits',
    message: 'Social Security benefits (Form SSA-1099) are not supported yet.',
    deferredTo: 'v1.1',
  },
  stockOrCryptoSales: {
    code: 'stock_or_crypto_sales',
    message:
      'Sales of stock, funds or crypto (Form 1099-B, Form 8949, Schedule D) are not supported yet.',
    deferredTo: 'v2',
  },
  k1Income: {
    code: 'k1_income',
    message:
      'Income from a partnership, S corporation, estate or trust (Schedule K-1) is not supported yet.',
    deferredTo: 'v2',
  },
  foreignIncomeOrAccounts: {
    code: 'foreign_income_or_accounts',
    message:
      'Foreign income, foreign taxes or foreign accounts are not supported yet.',
    deferredTo: 'v2',
  },
  unemploymentCompensation: {
    code: 'unemployment_compensation',
    message: 'Unemployment compensation (Form 1099-G) is not supported yet.',
    deferredTo: 'v1.1',
  },
  hsa: {
    code: 'hsa',
    message:
      'Health savings account activity (Form 8889) is not supported yet.',
    deferredTo: 'v1.1',
  },
  educationExpenses: {
    code: 'education_expenses',
    message: 'Education credits (Form 8863) are not supported yet.',
    deferredTo: 'v1.1',
  },
  wantsToItemize: {
    code: 'itemized_deductions',
    message:
      'Itemized deductions (Schedule A) are not supported yet; v1 uses the standard deduction.',
    deferredTo: 'v1.1',
  },
  marriedFilingSeparately: {
    code: 'married_filing_separately',
    message: 'Married filing separately is not supported yet.',
    deferredTo: 'v1.1',
  },
};

/** W-2 box 12 codes that need a form outside v1 (General Instructions for Forms W-2 and W-3, box 12 codes). */
const BOX12_ITEMS: Record<string, UnsupportedItem> = {
  W: FLAG_ITEMS.hsa,
  A: {
    code: 'uncollected_fica',
    message:
      'Uncollected social security or Medicare tax on tips or group-term life insurance (W-2 box 12 codes A, B, M, N) is not supported yet.',
    deferredTo: 'v1.1',
  },
  B: {
    code: 'uncollected_fica',
    message:
      'Uncollected social security or Medicare tax on tips or group-term life insurance (W-2 box 12 codes A, B, M, N) is not supported yet.',
    deferredTo: 'v1.1',
  },
  M: {
    code: 'uncollected_fica',
    message:
      'Uncollected social security or Medicare tax on tips or group-term life insurance (W-2 box 12 codes A, B, M, N) is not supported yet.',
    deferredTo: 'v1.1',
  },
  N: {
    code: 'uncollected_fica',
    message:
      'Uncollected social security or Medicare tax on tips or group-term life insurance (W-2 box 12 codes A, B, M, N) is not supported yet.',
    deferredTo: 'v1.1',
  },
  K: {
    code: 'golden_parachute_excise',
    message:
      'Excise tax on excess golden parachute payments (W-2 box 12 code K) is not supported.',
    deferredTo: 'v2',
  },
  R: {
    code: 'archer_msa',
    message:
      'Archer MSA contributions (W-2 box 12 code R, Form 8853) are not supported.',
    deferredTo: 'v2',
  },
  T: {
    code: 'adoption_benefits',
    message:
      'Employer-provided adoption benefits (W-2 box 12 code T, Form 8839) are not supported.',
    deferredTo: 'v2',
  },
  Z: {
    code: 'nqdc_409a',
    message:
      'Income under a nonqualified deferred compensation plan failing section 409A (W-2 box 12 code Z) is not supported.',
    deferredTo: 'v2',
  },
  H: {
    code: 'section_501c18_deferrals',
    message:
      'Elective deferrals to a section 501(c)(18)(D) plan (W-2 box 12 code H) are not supported.',
    deferredTo: 'v2',
  },
};

function push(out: UnsupportedItem[], item: UnsupportedItem) {
  if (!out.some((o) => o.code === item.code)) out.push(item);
}

/** Scope check against an already evaluated graph. */
export function scopeItems(
  facts: TaxFacts,
  core: CoreResult
): UnsupportedItem[] {
  const out: UnsupportedItem[] = [];
  const p = core.params;
  const status = statusOf(facts);
  const node = (id: string) => core.nodes[id]?.value ?? 0;

  if (p.provisional.length > 0) {
    out.push({
      code: 'provisional_params',
      message: `Tax year ${p.year} values are not final yet: ${p.provisional.map((x) => x.note).join(' ')}`,
      deferredTo: 'v1.1',
    });
  }

  for (const key of Object.keys(FLAG_ITEMS) as FlagKey[]) {
    if (facts.outOfScope?.[key] === true) push(out, FLAG_ITEMS[key]);
  }
  for (const other of facts.outOfScope?.other ?? []) {
    out.push({
      code: 'other',
      message: `Not supported in v1: ${other}`,
      deferredTo: 'not_planned',
    });
  }
  if (facts.digitalAssetActivity === true) {
    push(out, {
      code: 'digital_assets',
      message:
        'Digital asset transactions (the Form 1040 digital asset question answered "Yes") are not supported yet.',
      deferredTo: 'v2',
    });
  }

  const owners = ownersOnReturn(facts);
  const w2s = ownedOnReturn(facts, facts.w2s);
  const investment =
    node('taxableInterest') +
    node('ordinaryDividends') +
    node('capitalGainDistributions');

  // Schedule E, Part I (i1040se; Pub. 527; Pub. 925).
  const plans = planRentals(facts, p);
  const reported = plans.filter((x) => x.column !== null);
  if (reported.length > 3) {
    push(out, {
      code: 'rental_over_3',
      message:
        'More than three rental or royalty properties need extra Schedule E pages, which are not supported yet.',
      deferredTo: 'v1.1',
    });
  }
  if (reported.some((x) => x.r.ownsDepreciableProperty === true)) {
    push(out, {
      code: 'rental_depreciation',
      message:
        'You own rental property, which must be depreciated (Schedule E line 18, Form 4562); rental depreciation is not supported yet.',
      deferredTo: 'v2',
    });
  }
  if (reported.some((x) => x.usedAsHome)) {
    push(out, {
      code: 'vacation_home',
      message:
        'A rental you also used as a home (personal use over 14 days or 10% of rental days) and rented 15 days or more has limited expenses (Pub. 527 ch. 5), which is not supported yet.',
      deferredTo: 'v2',
    });
  }
  if (reported.some((x) => x.r.propertyType === 7)) {
    push(out, {
      code: 'self_rental',
      message:
        'Renting property to a business you materially participate in (self-rental, type 7) has special passive activity rules (Pub. 925), which are not supported.',
      deferredTo: 'v2',
    });
  }
  const realEstate = reported.filter((x) => !x.royalty);
  const realEstateNet = realEstate.reduce(
    (s, x) => s + node(`schE.net.${x.r.id}`),
    0
  );
  // i1040se "Exception for Certain Rental Real Estate Activities": no Form 8582 when rental real
  // estate is the only passive activity (a Schedule C with line G "No" is flagged as schedule_c_passive),
  // there is no prior-year unallowed loss, and any overall loss is <= $25,000 with active
  // participation and MAGI <= $100,000.
  const priorLoss = realEstate.some((x) => x.r.priorYearUnallowedLoss === true);
  const lossLimited =
    realEstateNet < 0 &&
    (realEstate.some((x) => x.r.activeParticipation === false) ||
      -realEstateNet > p.passiveLoss.specialAllowance ||
      node('schE.passiveMagi') > p.passiveLoss.magiLimit);
  if (priorLoss || lossLimited) {
    push(out, {
      code: 'passive_loss_8582',
      message:
        'This rental real estate loss does not meet the exception that skips Form 8582 (passive activity loss limits); Form 8582 is not supported yet, so the loss may be limited.',
      deferredTo: 'v2',
    });
  }

  // Form 8829 items v1 does not compute.
  for (const b of f8829Businesses(facts)) {
    const ho = b.homeOffice as HomeOfficeActual;
    if (
      (ho.direct?.casualty_losses ?? 0) > 0 ||
      (ho.indirect?.casualty_losses ?? 0) > 0
    ) {
      push(out, {
        code: 'home_office_casualty',
        message:
          'Casualty losses on a home office (Form 8829 lines 9, 29, 35 and Form 4684) are not supported yet.',
        deferredTo: 'v2',
      });
    }
    const dep = depreciationPlan(ho, facts.taxYear, p);
    if (
      dep.unsupported === 'pre_1993' ||
      dep.unsupported === 'recovery_year_40'
    ) {
      push(out, {
        code: 'home_depreciation_old',
        message:
          'A home first used for business before May 13, 1993, or 39 or more years ago, needs depreciation rates from Pub. 946 or Pub. 534 that are not supported.',
        deferredTo: 'not_planned',
      });
    }
  }

  // EIC after a prior disallowance (Form 8862).
  if (facts.eitc?.priorDisallowance === true && node('eic') > 0) {
    push(out, {
      code: 'eitc_8862',
      message:
        'Your earned income credit was reduced or denied in an earlier year, so you must file Form 8862 to claim it, which is not supported yet.',
      deferredTo: 'v2',
    });
  }

  // HoH needs a qualifying person who lived with you more than half the year
  // (a dependent parent need not live with you). Unknown months are asked by requiredFacts.
  if (status === 'hoh') {
    const qualifies = facts.dependents.some(
      (d) => d.relationship === 'parent' || (d.monthsLivedWithTaxpayer ?? 0) > 6
    );
    const unknown = facts.dependents.some(
      (d) =>
        d.relationship !== 'parent' && d.monthsLivedWithTaxpayer === undefined
    );
    if (!qualifies && !unknown) {
      push(out, {
        code: 'hoh_no_qualifying_person',
        message:
          'Head of household needs a qualifying person who lived with you more than half the year. Check the filing status.',
        deferredTo: 'not_planned',
      });
    }
  }

  // Schedule C limits.
  for (const o of owners) {
    const biz = facts.businesses.filter((b) => b.owner === o);
    if (biz.length > 1) {
      push(out, {
        code: 'multiple_schedule_c',
        message:
          'More than one Schedule C business for the same person is not supported yet.',
        deferredTo: 'v2',
      });
    }
    if (biz.some((b) => b.allInvestmentAtRisk === false)) {
      push(out, {
        code: 'schedule_c_at_risk',
        message:
          'A Schedule C loss where not all of the investment is at risk (line 32b) needs Form 6198 (at-risk limits), which is not supported yet.',
        deferredTo: 'v2',
      });
    }
    if (biz.some((b) => b.materiallyParticipated === false)) {
      push(out, {
        code: 'schedule_c_passive',
        message:
          'A business you did not materially participate in (Schedule C line G "No") is a passive activity with its own loss limits and Net Investment Income Tax rules (Pub. 925, Form 8582), which are not supported yet.',
        deferredTo: 'v2',
      });
    }
  }
  if (
    node('qbiTotal') + node('reitDividends') > 0 &&
    node('qbiTaxableIncome') > p.qbiThreshold[status]
  ) {
    push(out, {
      code: 'form_8995a',
      message:
        'Taxable income is above the Form 8995 threshold, so the QBI deduction needs Form 8995-A, which is not supported yet.',
      deferredTo: 'v1.1',
    });
  }

  // W-2 details that need other forms.
  for (const w of w2s) {
    for (const b of w.box12 ?? []) {
      const item = BOX12_ITEMS[b.code.toUpperCase()];
      if (item && b.amount > 0) push(out, item);
    }
    if (w.statutoryEmployee) {
      push(out, {
        code: 'statutory_employee',
        message:
          'Statutory employee wages (W-2 box 13) are reported on Schedule C, which v1 does not do for W-2 wages yet.',
        deferredTo: 'v1.1',
      });
    }
    if ((w.allocatedTips ?? 0) > 0) {
      push(out, {
        code: 'allocated_tips',
        message:
          'Allocated tips (W-2 box 8) need Form 4137, which is not supported yet.',
        deferredTo: 'v1.1',
      });
    }
  }

  // Excess social security tax withheld by two or more employers (Schedule 3 line 11).
  const maxSsTaxCents = mulRate(p.ssWageBase * 100, p.ssTaxRatePpm);
  for (const o of owners) {
    const mine = w2s.filter((w) => w.owner === o);
    if (mine.length > 1 && sumCents(mine.map((w) => w.ssTax)) > maxSsTaxCents) {
      push(out, {
        code: 'excess_social_security',
        message:
          'More than the maximum social security tax was withheld by two or more employers; the refund of the excess (Schedule 3) is not supported yet.',
        deferredTo: 'v1.1',
      });
    }
  }

  // Form 8615 (kiddie tax).
  if (
    facts.taxpayer.canBeClaimedAsDependent === true &&
    investment > p.kiddieTaxUnearnedThreshold
  ) {
    push(out, {
      code: 'kiddie_tax',
      message:
        'A dependent with more than the unearned income limit may owe tax at the parent’s rate (Form 8615), which is not supported.',
      deferredTo: 'v2',
    });
  }

  if (node('agi') < 0) {
    push(out, {
      code: 'net_operating_loss',
      message:
        'Adjusted gross income is negative, which may create a net operating loss; that is not supported.',
      deferredTo: 'v2',
    });
  }

  return out;
}

export function checkScope(facts: TaxFacts): UnsupportedItem[] {
  return scopeItems(facts, computeCore(facts));
}
