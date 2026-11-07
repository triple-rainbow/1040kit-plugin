/**
 * reviewChecks: consistency checks on the documents and the result, in the
 * spirit of IRS math-error checks, plus "unusual vs last year" flags.
 */
import {
  CHILD_RELATIONSHIPS,
  classifyDependent,
  hohQualifyingPerson,
} from '../dependents.ts';
import {
  ageAtYearEnd,
  ownedOnReturn,
  ownersOnReturn,
  statusOf,
} from '../facts.ts';
import { f8829Businesses } from '../forms/f8829.ts';
import { planRentals, rentalsOnReturn } from '../forms/schE.ts';
import { mulRate, toDollars } from '../money.ts';
import { getParams } from '../params/index.ts';
import type {
  HomeOfficeActual,
  PriorYearSummary,
  ReturnResult,
  ReviewFinding,
  TaxFacts,
} from '../types.ts';

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function reviewChecks(
  facts: TaxFacts,
  result: ReturnResult,
  prior?: PriorYearSummary
): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const p = getParams(facts.taxYear);
  const w2s = ownedOnReturn(facts, facts.w2s);
  const baseCents = p.ssWageBase * 100;

  for (const w of w2s) {
    const ssWagesAndTips = w.ssWages + (w.ssTips ?? 0);
    // Box 3 + box 7 normally equals box 5 up to the wage base.
    const expectedSs = Math.min(w.medicareWages, baseCents);
    if (ssWagesAndTips > baseCents + 100) {
      out.push({
        severity: 'error',
        code: 'ss_wages_over_wage_base',
        message: `W-2 ${w.id}: social security wages and tips (boxes 3 + 7) are over the ${p.year} wage base of $${p.ssWageBase.toLocaleString('en-US')}. Check the form.`,
        nodeIds: ['wages'],
      });
    } else if (Math.abs(ssWagesAndTips - expectedSs) > 100) {
      out.push({
        severity: 'info',
        code: 'ss_wages_vs_medicare_wages',
        message: `W-2 ${w.id}: boxes 3 + 7 (${usd(ssWagesAndTips)}) differ from box 5 (${usd(w.medicareWages)}). That can be right (e.g. some government jobs), but check the numbers were read correctly.`,
        nodeIds: ['wages'],
      });
    }
    const expectedSsTax = mulRate(
      Math.min(ssWagesAndTips, baseCents),
      p.ssTaxRatePpm
    );
    if (Math.abs(w.ssTax - expectedSsTax) > 100) {
      out.push({
        severity: 'warning',
        code: 'ss_tax_mismatch',
        message: `W-2 ${w.id}: social security tax (box 4, ${usd(w.ssTax)}) is not 6.2% of boxes 3 + 7 (${usd(expectedSsTax)}). Check the form or ask the employer for a corrected W-2.`,
        nodeIds: ['wages'],
      });
    }
    const extra = Math.max(
      0,
      w.medicareWages - p.additionalMedicareWithholdingThreshold * 100
    );
    const expectedMedicare =
      mulRate(w.medicareWages, p.medicareTaxRatePpm) +
      mulRate(extra, p.additionalMedicareRatePpm);
    if (Math.abs(w.medicareTax - expectedMedicare) > 100) {
      out.push({
        severity: 'warning',
        code: 'medicare_tax_mismatch',
        message: `W-2 ${w.id}: Medicare tax (box 6, ${usd(w.medicareTax)}) is not 1.45% of box 5 (${usd(expectedMedicare)} expected).`,
        nodeIds: ['wages'],
      });
    }
    if (w.federalWithheld > w.wages) {
      out.push({
        severity: 'error',
        code: 'withholding_exceeds_wages',
        message: `W-2 ${w.id}: federal income tax withheld (box 2) is more than wages (box 1). Boxes may have been swapped.`,
        nodeIds: ['withholdingW2', 'wages'],
      });
    }
  }

  // Corrected and duplicate W-2s from the same employer.
  const byEmployer = new Map<string, typeof w2s>();
  for (const w of w2s) {
    if (!w.employerEinToken) continue;
    const key = `${w.owner}|${w.employerEinToken}`;
    byEmployer.set(key, [...(byEmployer.get(key) ?? []), w]);
  }
  for (const group of byEmployer.values()) {
    if (group.length < 2) continue;
    if (group.some((w) => w.corrected) && group.some((w) => !w.corrected)) {
      out.push({
        severity: 'warning',
        code: 'corrected_w2_with_original',
        message: `A corrected W-2 (${group
          .filter((w) => w.corrected)
          .map((w) => w.id)
          .join(
            ', '
          )}) is included next to the original from the same employer. Keep only the corrected one unless they cover different jobs.`,
        nodeIds: ['wages'],
      });
    }
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.wages === b.wages && a.federalWithheld === b.federalWithheld) {
          out.push({
            severity: 'warning',
            code: 'possible_duplicate_w2',
            message: `W-2s ${a.id} and ${b.id} are from the same employer with the same amounts. Is one a duplicate?`,
            nodeIds: ['wages'],
          });
        }
      }
    }
  }

  // 1099 business income with no Schedule C.
  for (const o of ownersOnReturn(facts)) {
    const has1099 =
      facts.k1099s.some((k) => k.owner === o) ||
      facts.nec1099s.some((n) => n.owner === o);
    if (has1099 && !facts.businesses.some((b) => b.owner === o)) {
      out.push({
        severity: 'error',
        code: '1099_income_without_schedule_c',
        message: `There is 1099-NEC or 1099-K income for ${o === 'taxpayer' ? 'you' : 'your spouse'} but no Schedule C business, so it is not on the return yet.`,
        nodeIds: ['businessIncome'],
      });
    }
  }

  // Dependents.
  for (const d of facts.dependents) {
    const age = ageAtYearEnd(d.dateOfBirth, facts.taxYear);
    if (
      age !== undefined &&
      age >= 24 &&
      d.relationship !== undefined &&
      CHILD_RELATIONSHIPS.has(d.relationship) &&
      !d.permanentlyDisabled
    ) {
      out.push({
        severity: 'info',
        code: 'dependent_over_24',
        message: `Dependent ${d.id} is ${age} at year end, too old to be a qualifying child unless permanently disabled. They can count only as a qualifying relative ($500 credit for other dependents).`,
        nodeIds: ['odc', 'ctc'],
      });
    }
    if (classifyDependent(d, facts, p).credit === 'none') {
      out.push({
        severity: 'warning',
        code: 'dependent_may_not_qualify',
        message: `Dependent ${d.id} does not appear to meet the qualifying child or qualifying relative tests, so no credit is claimed for them.`,
        nodeIds: ['odc'],
      });
    }
  }

  // Car loan interest that doesn't qualify.
  if (
    (facts.obbba?.carLoanInterest ?? 0) > 0 &&
    (result.nodes.carLoanInterestDeduction?.value ?? 0) === 0
  ) {
    const v = facts.obbba?.carLoanVehicle;
    if (v) {
      const why = [
        !v.newVehicle && 'the vehicle was not new',
        !v.finalAssemblyInUS && 'final assembly was not in the U.S.',
        !v.personalUse && 'it is not mainly for personal use',
        v.purchaseDate &&
          v.purchaseDate <= p.sch1a.carLoan.purchasedAfter &&
          'the loan is from before 2025',
      ].filter(Boolean);
      out.push({
        severity: 'info',
        code: 'car_loan_not_eligible',
        message: `Car loan interest is not deductible on Schedule 1-A${why.length ? ` because ${why.join(', ')}` : ' (phased out by income)'}.`,
        nodeIds: ['carLoanInterestDeduction'],
      });
    }
  }

  // Mid-year mileage rate change.
  if (p.mileageRateNote && facts.businesses.some((b) => b.vehicle)) {
    out.push({
      severity: 'warning',
      code: 'mileage_rate_midyear',
      message: p.mileageRateNote,
      nodeIds: ownersOnReturn(facts)
        .map((o) => `schC.expense.car_truck.${o}`)
        .filter((id) => result.nodes[id]),
    });
  }

  // Form 8829 inputs.
  for (const b of f8829Businesses(facts)) {
    const ho = b.homeOffice as HomeOfficeActual;
    const o = b.owner;
    const ids = [`f8829.allowable.${o}`, `schC.homeOffice.${o}`];
    if (!(ho.homeSquareFeet > 0)) {
      out.push({
        severity: 'error',
        code: 'home_area_missing',
        message: `Home office (${o}): the total area of the home must be more than 0 square feet.`,
        nodeIds: ids,
      });
    } else if (ho.officeSquareFeet > ho.homeSquareFeet) {
      out.push({
        severity: 'error',
        code: 'office_larger_than_home',
        message: `Home office (${o}): the office (${ho.officeSquareFeet} sq ft) is larger than the whole home (${ho.homeSquareFeet} sq ft).`,
        nodeIds: ids,
      });
    }
    if (
      ho.monthsUsed !== undefined &&
      (ho.monthsUsed < 1 || ho.monthsUsed > 12)
    ) {
      out.push({
        severity: 'error',
        code: 'home_office_months',
        message: `Home office (${o}): months used must be 1 to 12 (got ${ho.monthsUsed}).`,
        nodeIds: ids,
      });
    }
    if (ho.ownership === 'rent' && ho.home) {
      out.push({
        severity: 'warning',
        code: 'renter_with_home_basis',
        message: `Home office (${o}): a renter cannot depreciate the home; the home basis is ignored.`,
        nodeIds: ids,
      });
    }
    if (
      ho.ownership === 'own' &&
      (ho.indirect?.rent ?? 0) + (ho.direct?.rent ?? 0) > 0
    ) {
      out.push({
        severity: 'warning',
        code: 'owner_paying_rent',
        message: `Home office (${o}): rent is entered for a home you own. Check the ownership answer.`,
        nodeIds: ids,
      });
    }
    if (ho.home) {
      if (ho.home.landValue > ho.home.basisOrValue) {
        out.push({
          severity: 'error',
          code: 'land_over_basis',
          message: `Home office (${o}): the land value is more than the home's basis or value (Form 8829 lines 37-38).`,
          nodeIds: [`f8829.buildingBasis.${o}`],
        });
      }
      if (ho.home.businessUseStart > `${facts.taxYear}-12-31`) {
        out.push({
          severity: 'error',
          code: 'business_use_after_year',
          message: `Home office (${o}): business use starts after ${facts.taxYear}.`,
          nodeIds: [`f8829.depreciationPct.${o}`],
        });
      }
    }
    if (
      (ho.direct?.mortgage_interest ?? 0) > 0 ||
      (ho.direct?.real_estate_taxes ?? 0) > 0
    ) {
      out.push({
        severity: 'info',
        code: 'mortgage_interest_direct',
        message: `Home office (${o}): mortgage interest and real estate taxes are whole-home (indirect) expenses for a standard-deduction filer (i8829 lines 16-17), so they were moved to column (b).`,
        nodeIds: [`f8829.operatingIndirect.${o}`],
      });
    }
  }

  // Schedule E inputs.
  const p8 = getParams(facts.taxYear);
  for (const plan of planRentals(facts, p8)) {
    const r = plan.r;
    const rentNode = `schE.rents.${r.id}`;
    const income =
      (r.rentsOther ?? 0) +
      (r.royaltiesOther ?? 0) +
      plan.miscs.reduce((s, m) => s + (m.rents ?? 0) + (m.royalties ?? 0), 0);
    if (plan.column !== null && income === 0) {
      out.push({
        severity: 'warning',
        code: 'rental_without_income',
        message: `Rental ${r.id}: no rent or royalties are entered. A property with only expenses may not be a rental activity; check the amounts.`,
        nodeIds: [rentNode],
      });
    }
    if (!plan.royalty && plan.fairDays === 0 && income > 0) {
      out.push({
        severity: 'warning',
        code: 'rent_without_rental_days',
        message: `Rental ${r.id}: rent is entered but no fair rental days.`,
        nodeIds: [rentNode],
      });
    }
    if (plan.fairDays + plan.personalDays > 366) {
      out.push({
        severity: 'error',
        code: 'rental_days_over_year',
        message: `Rental ${r.id}: rental days plus personal use days are more than a year.`,
        nodeIds: [`schE.fairRentalDays.${r.id}`],
      });
    }
    for (const id of r.misc1099Ids ?? []) {
      const m = facts.misc1099s.find((x) => x.id === id);
      if (!m) {
        out.push({
          severity: 'error',
          code: 'rental_misc_missing',
          message: `Rental ${r.id} lists 1099-MISC ${id}, which is not in the documents.`,
          nodeIds: [rentNode],
        });
      } else if (m.treatAsBusiness === true) {
        out.push({
          severity: 'error',
          code: 'misc_business_and_rental',
          message: `1099-MISC ${id} is marked as business income (Schedule C) and also linked to rental ${r.id}; it is reported on Schedule C only.`,
          nodeIds: [rentNode, `schC.grossReceipts.${m.owner}`],
        });
      }
    }
  }
  const linkCount = new Map<string, number>();
  for (const r of facts.rentals ?? [])
    for (const id of r.misc1099Ids ?? [])
      linkCount.set(id, (linkCount.get(id) ?? 0) + 1);
  for (const [id, count] of linkCount) {
    if (count > 1)
      out.push({
        severity: 'error',
        code: 'misc_linked_twice',
        message: `1099-MISC ${id} is linked to ${count} rental properties, so it would be counted twice.`,
        nodeIds: ['schE.totalRents'],
      });
  }
  for (const m of ownedOnReturn(facts, facts.misc1099s)) {
    if (m.treatAsBusiness === true) continue;
    if ((m.rents ?? 0) <= 0 && (m.royalties ?? 0) <= 0) continue;
    if (linkCount.has(m.id)) continue;
    out.push({
      severity: 'error',
      code: 'misc_rents_not_on_return',
      message: `1099-MISC ${m.id} has rents or royalties (boxes 1-2) that are not on the return yet: link it to a Schedule E property or mark it as business income.`,
      nodeIds: ['rentalRoyaltyIncome'],
    });
  }
  if (rentalsOnReturn(facts).length > 0) {
    out.push({
      severity: 'info',
      code: 'rental_not_qbi',
      message:
        'Rental and royalty income is not included in the QBI deduction (Form 8995). A rental can count only if it is a trade or business (i8995; Rev. Proc. 2019-38 safe harbor), which 1040kit does not evaluate.',
      nodeIds: ['qbiDeduction', 'rentalRoyaltyIncome'],
    });
  }

  // Student loan interest.
  for (const e of ownedOnReturn(facts, facts.e1098s ?? [])) {
    if (e.box2Checked) {
      out.push({
        severity: 'info',
        code: '1098e_box2',
        message: `Form 1098-E ${e.id} has box 2 checked: box 1 leaves out loan origination fees or capitalized interest that may also be deductible (Pub. 970). Add them as interest paid with no 1098-E if they apply.`,
        nodeIds: ['studentLoanInterestDeduction'],
      });
    }
  }
  if (
    (result.nodes['studentLoan.interestPaid']?.value ?? 0) >=
    p8.studentLoanInterest.cap
  ) {
    const paid = toDollars(
      ownedOnReturn(facts, facts.e1098s ?? []).reduce(
        (s, e) => s + e.interest,
        0
      ) + (facts.adjustments?.studentLoanInterestOther ?? 0)
    );
    if (paid > p8.studentLoanInterest.cap)
      out.push({
        severity: 'info',
        code: 'student_loan_interest_cap',
        message: `Student loan interest paid ($${paid.toLocaleString('en-US')}) is over the $${p8.studentLoanInterest.cap.toLocaleString('en-US')} limit; only $${p8.studentLoanInterest.cap.toLocaleString('en-US')} is deductible.`,
        nodeIds: ['studentLoanInterestDeduction'],
      });
  }

  // Unusual vs last year.
  if (prior?.refundOrOwed !== undefined) {
    const now = result.summary.refundOrOwed;
    const diff = Math.abs(now - prior.refundOrOwed);
    if (diff >= 100 && diff > Math.abs(prior.refundOrOwed) * 0.5) {
      const fmt = (n: number) =>
        n >= 0
          ? `a $${n.toLocaleString('en-US')} refund`
          : `$${(-n).toLocaleString('en-US')} owed`;
      out.push({
        severity: 'warning',
        code: 'refund_swing_vs_prior_year',
        message: `This year shows ${fmt(now)}; last year (${prior.taxYear}) was ${fmt(prior.refundOrOwed)}. A change this large is worth a second look.`,
        nodeIds: ['refundOrOwed'],
      });
    }
  }
  if (prior?.agi !== undefined && prior.agi > 0) {
    const agi = result.summary.agi;
    if (
      Math.abs(agi - prior.agi) > prior.agi * 0.5 &&
      Math.abs(agi - prior.agi) >= 1000
    ) {
      out.push({
        severity: 'info',
        code: 'agi_swing_vs_prior_year',
        message: `Adjusted gross income changed by more than half compared with ${prior.taxYear}. Check that no income document is missing or duplicated.`,
        nodeIds: ['agi'],
      });
    }
  }

  // Single with someone who could make the filer head of household (the user decides).
  if (
    statusOf(facts) === 'single' &&
    facts.taxpayer.canBeClaimedAsDependent !== true &&
    facts.dependents.some((d) => hohQualifyingPerson(d, facts, p))
  ) {
    out.push({
      severity: 'warning',
      code: 'head_of_household_may_apply',
      message:
        'You file as single but claim a dependent who could make you head of household, which has a larger standard deduction and lower tax. Ask whether you were unmarried at year end and paid more than half the cost of keeping up the home (see the head_of_household deduction item).',
      nodeIds: ['standardDeduction'],
    });
  }

  return out;
}
