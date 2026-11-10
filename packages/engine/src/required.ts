/**
 * requiredFacts: the facts the engine still needs, as plain-English questions.
 * Sorted blocking first, then by priority. Core facts use priorities < 100;
 * out-of-scope screening questions use 100+ so they are asked afterwards.
 */
import { computeCore, type CoreResult } from './compute.ts';
import { CHILD_RELATIONSHIPS } from './dependents.ts';
import {
  ageAtYearEnd,
  bornBefore,
  ownedOnReturn,
  ownersOnReturn,
  statusOf,
} from './facts.ts';
import { eicChildren, isEicQualifyingChild } from './forms/eic.ts';
import { rentalMiscIds, rentalsOnReturn } from './forms/schE.ts';
import { getParams } from './params/index.ts';
import { eicCompleted } from './tax/eic.ts';
import type {
  MissingFact,
  OutOfScopeFlags,
  PersonId,
  Screening,
  TaxFacts,
  VehicleUse,
} from './types.ts';

type ScreeningKey =
  | keyof OutOfScopeFlags
  | 'digitalAssetActivity'
  | 'screening.hasDependents'
  | 'screening.hasRentalOrRoyaltyIncome'
  | 'screening.paidStudentLoanInterest';

const SCREENING: {
  key: ScreeningKey;
  question: string;
  why: string;
  cite?: string;
}[] = [
  {
    key: 'screening.hasDependents',
    question:
      'Does anyone, such as a child or a relative, live with you or depend on you for support?',
    why: 'Dependents can mean the child tax credit, the credit for other dependents, head of household and a larger earned income credit.',
  },
  {
    key: 'retirementDistributions',
    question:
      'Did you receive a 1099-R (retirement, pension or IRA distribution) this year?',
    why: '1040kit can’t include retirement distributions yet.',
  },
  {
    key: 'socialSecurityBenefits',
    question:
      'Did you receive Social Security benefits (Form SSA-1099) this year?',
    why: '1040kit can’t include Social Security benefits yet.',
  },
  {
    key: 'stockOrCryptoSales',
    question:
      'Did you sell any stocks, funds or crypto this year (Form 1099-B)?',
    why: '1040kit can’t include sales of stocks, funds or crypto yet.',
    cite: 'Form 8949 and Schedule D',
  },
  {
    key: 'screening.hasRentalOrRoyaltyIncome',
    question:
      'Did you receive rent from a property, or royalties (for example from a book, music, or oil and gas), this year?',
    why: 'Rent and royalties are reported separately, with their own expenses.',
    cite: 'Schedule E, Part I',
  },
  {
    key: 'k1Income',
    question:
      'Did you receive a Schedule K-1 from a partnership, S corporation, estate or trust?',
    why: '1040kit can’t include K-1 income yet.',
  },
  {
    key: 'foreignIncomeOrAccounts',
    question:
      'Did you have income from outside the U.S., pay foreign taxes, or hold foreign bank accounts?',
    why: '1040kit can’t include foreign income or accounts yet.',
  },
  {
    key: 'unemploymentCompensation',
    question: 'Did you receive unemployment benefits this year (Form 1099-G)?',
    why: '1040kit can’t include unemployment benefits yet.',
  },
  {
    key: 'hsa',
    question:
      'Did you or your employer put money into a health savings account (HSA), or did you take money out of one?',
    why: '1040kit can’t include health savings accounts yet.',
    cite: 'Form 8889',
  },
  {
    key: 'educationExpenses',
    question:
      'Did you pay college tuition for yourself or a dependent and want an education credit (Form 1098-T)?',
    why: '1040kit can’t include education credits yet.',
    cite: 'Form 8863',
  },
  {
    key: 'screening.paidStudentLoanInterest',
    question: 'Did you pay interest on a student loan this year (Form 1098-E)?',
    why: 'You may be able to deduct up to $2,500 of student loan interest.',
    cite: 'Schedule 1, line 21',
  },
  {
    key: 'wantsToItemize',
    question:
      'Do you want to itemize deductions (mortgage interest, state taxes, gifts to charity) instead of the standard deduction?',
    why: '1040kit takes the standard deduction; it can’t itemize yet.',
    cite: 'Schedule A',
  },
  {
    key: 'marriedFilingSeparately',
    question:
      'If you are married, do you plan to file separately from your spouse?',
    why: '1040kit can’t prepare separate returns for a married couple yet.',
  },
  {
    key: 'other',
    question:
      'Any other income or tax situation not covered yet, such as gambling winnings, alimony, or a household employee?',
    why: 'Anything else has to be flagged now, so nothing is left out or guessed.',
  },
  {
    key: 'digitalAssetActivity',
    question:
      'Did you receive, sell, swap or otherwise dispose of any digital assets (crypto, NFTs) this year?',
    why: 'Every federal return asks this. 1040kit can’t include crypto sales or swaps yet.',
  },
];

/** "$1,500.00": an amount in cents, written out for a question (no arithmetic). */
function formatCents(c: number): string {
  const sign = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`;
}

function who(owner: PersonId): string {
  return owner === 'taxpayer' ? 'you' : 'your spouse';
}

export function requiredFacts(facts: TaxFacts): MissingFact[] {
  return requiredFactsFrom(facts, computeCore(facts));
}

/** EIC still possible with the facts known so far (decides whether to ask its questions). */
function eicPossible(
  facts: TaxFacts,
  core: CoreResult
): { possible: boolean; children: number } {
  const v = (id: string) => core.nodes[id]?.value ?? 0;
  const children = Math.min(3, eicChildren(facts).length);
  const limit = eicCompleted(statusOf(facts), children, core.params);
  const earned = v('earnedIncome');
  return {
    possible: earned > 0 && earned < limit && v('agi') < limit,
    children,
  };
}

export function requiredFactsFrom(
  facts: TaxFacts,
  core: CoreResult
): MissingFact[] {
  const out: MissingFact[] = [];
  const add = (m: MissingFact) => {
    if (!out.some((o) => o.path === m.path)) out.push(m);
  };
  const params = getParams(facts.taxYear);
  const eic = eicPossible(facts, core);
  const node = (id: string) => core.nodes[id]?.value ?? 0;
  const year = facts.taxYear;
  const status = facts.filingStatus;

  if (!status) {
    add({
      path: 'filingStatus',
      question: 'What is your filing status?',
      why: 'Filing status sets the standard deduction, tax brackets and credit limits.',
      blocking: true,
      priority: 0,
    });
  }

  if (!facts.taxpayer.dateOfBirth) {
    add({
      path: 'taxpayer.dateOfBirth',
      question: 'What is your date of birth?',
      why: 'People 65 or older get a larger standard deduction and an extra senior deduction.',
      cite: 'Schedule 1-A',
      blocking: false,
      priority: 10,
    });
  }
  if (facts.taxpayer.canBeClaimedAsDependent === undefined) {
    add({
      path: 'taxpayer.canBeClaimedAsDependent',
      question:
        'Can anyone, such as a parent, claim you as a dependent this year?',
      why: 'A dependent gets a smaller standard deduction and cannot claim dependents.',
      blocking: true,
      priority: 12,
    });
  }
  if (statusOf(facts) === 'mfj' && !facts.spouse?.dateOfBirth) {
    add({
      path: 'spouse.dateOfBirth',
      question: 'What is your spouse’s date of birth?',
      why: 'A spouse 65 or older adds to the standard deduction and can get the senior deduction.',
      cite: 'Schedule 1-A',
      blocking: false,
      priority: 11,
    });
  }

  // Blindness adds to the standard deduction. Most filers answer no, so it
  // is never blocking (the 1040kit card shows it as one small check box).
  if (facts.taxpayer.blind === undefined) {
    add({
      path: 'taxpayer.blind',
      question: 'Are you legally blind (most people aren’t)?',
      why: 'A legally blind filer gets a larger standard deduction.',
      cite: 'Form 1040 instructions, line 12e; Pub. 501',
      blocking: false,
      priority: 14,
    });
  }
  if (statusOf(facts) === 'mfj' && facts.spouse?.blind === undefined) {
    add({
      path: 'spouse.blind',
      question: 'Is your spouse legally blind (most people aren’t)?',
      why: 'A legally blind spouse adds to the standard deduction.',
      cite: 'Form 1040 instructions, line 12e; Pub. 501',
      blocking: false,
      priority: 14,
    });
  }

  // Dependents.
  if (status === 'hoh' && facts.dependents.length === 0) {
    add({
      path: 'dependents',
      question:
        'Who lived with you over half the year as your qualifying person? Name, relationship, date of birth, months with you, valid SSN?',
      why: 'Head of household needs a qualifying person, usually someone who lived with you.',
      blocking: true,
      priority: 19,
    });
  } else if (
    facts.screening?.hasDependents === true &&
    facts.dependents.length === 0
  ) {
    add({
      path: 'dependents',
      question: 'Who lives with you or depends on you?',
      why: 'Each dependent can bring a credit; the relationship and age decide which one.',
      blocking: true,
      priority: 19,
    });
  }
  let childUnder17 = false;
  facts.dependents.forEach((d, i) => {
    const n = `your dependent #${i + 1}`;
    const base = `dependents[${d.id}]`;
    if (!d.dateOfBirth) {
      add({
        path: `${base}.dateOfBirth`,
        question: `What is the date of birth of ${n}?`,
        why: 'Age decides the child tax credit and whether they count as a qualifying child.',
        blocking: true,
        priority: 20,
      });
    }
    if (!d.relationship) {
      add({
        path: `${base}.relationship`,
        question: `How is ${n} related to you?`,
        why: 'Relationship decides which dependency tests apply.',
        blocking: true,
        priority: 21,
      });
    }
    if (
      d.relationship !== 'parent' &&
      d.monthsLivedWithTaxpayer === undefined
    ) {
      add({
        path: `${base}.monthsLivedWithTaxpayer`,
        question: `How many months of the year did ${n} live with you?`,
        why: 'A qualifying child must live with you more than half the year.',
        blocking: true,
        priority: 22,
      });
    }
    const age = ageAtYearEnd(d.dateOfBirth, year);
    const under17 = age === undefined || age < 17;
    if (age !== undefined && age < 17) childUnder17 = true;
    const eicChild = eic.possible && isEicQualifyingChild(d, facts);
    if ((under17 || eicChild) && d.hasValidSsn === undefined) {
      add({
        path: `${base}.hasValidSsn`,
        question: `Does ${n} have a Social Security number valid for work, issued before the filing deadline?`,
        why: 'A child needs a valid SSN for the child tax credit and the earned income credit; without one, the $500 credit for other dependents can still apply.',
        blocking: true,
        priority: 23,
      });
    }
    if (
      d.relationship &&
      CHILD_RELATIONSHIPS.has(d.relationship) &&
      age !== undefined &&
      age >= 19 &&
      age < 24 &&
      d.fullTimeStudent === undefined &&
      !d.permanentlyDisabled
    ) {
      add({
        path: `${base}.fullTimeStudent`,
        question: `Was ${n} a full-time student for at least five months of the year?`,
        why: 'A child aged 19 to 23 counts as a qualifying child only if they were a full-time student.',
        blocking: true,
        priority: 24,
      });
    }
    const maybeRelative =
      (d.relationship !== undefined &&
        !CHILD_RELATIONSHIPS.has(d.relationship)) ||
      (age !== undefined &&
        age >= 19 &&
        !(age < 24 && d.fullTimeStudent) &&
        !d.permanentlyDisabled);
    if (maybeRelative && d.grossIncome === undefined) {
      add({
        path: `${base}.grossIncome`,
        question: `About how much income did ${n} have this year?`,
        why: `A qualifying relative must have gross income under $${params.qualifyingRelativeGrossIncome.toLocaleString('en-US')}.`,
        blocking: true,
        priority: 25,
      });
    }
    if (d.providedOverHalfOwnSupport === undefined) {
      add({
        path: `${base}.providedOverHalfOwnSupport`,
        question: `Did ${n} pay for more than half of their own support this year?`,
        why: 'A child who provides over half their own support is not a qualifying child.',
        blocking: false,
        priority: 26,
      });
    }
  });

  // Valid SSN of the filer(s): needed for the CTC (2025+) and Schedule 1-A deductions.
  const owners = ownersOnReturn(facts);
  const people = owners.map((o) =>
    o === 'taxpayer' ? facts.taxpayer : facts.spouse
  );
  const needsSsn = (o: PersonId) => {
    const person = o === 'taxpayer' ? facts.taxpayer : facts.spouse;
    return (
      (o === 'taxpayer' && childUnder17) ||
      // Asked up front with the dependents, so it doesn't need a round of its own.
      facts.screening?.hasDependents === true ||
      eic.possible ||
      (facts.obbba?.qualifiedTips?.[o] ?? 0) > 0 ||
      (facts.obbba?.qualifiedOvertime?.[o] ?? 0) > 0 ||
      bornBefore(person?.dateOfBirth, params.age65BornBefore)
    );
  };
  owners.forEach((o, i) => {
    const person = people[i];
    if (needsSsn(o) && person?.hasValidSsn === undefined) {
      add({
        path: `${o}.hasValidSsn`,
        question:
          o === 'taxpayer'
            ? 'Do you have a Social Security number that is valid for work?'
            : 'Does your spouse have a Social Security number that is valid for work?',
        why: 'A valid SSN is needed for the child tax credit and the tips, overtime and senior deductions.',
        blocking: true,
        priority: 13,
      });
    }
  });

  // Self-employment income needs a Schedule C business for its owner.
  for (const o of owners) {
    const hasBizIncome =
      ownedOnReturn(facts, facts.nec1099s).some((n) => n.owner === o) ||
      ownedOnReturn(facts, facts.k1099s).some((k) => k.owner === o) ||
      ownedOnReturn(facts, facts.misc1099s).some(
        (m) => m.owner === o && m.treatAsBusiness
      );
    if (hasBizIncome && !facts.businesses.some((b) => b.owner === o)) {
      add({
        path: `businesses[${o}]`,
        question: `What business or side gig is the 1099 income ${o === 'taxpayer' ? 'you' : 'your spouse'} received from, and what does it do?`,
        why: 'Freelance and gig income is reported with your business, where its expenses reduce it.',
        cite: 'Schedule C',
        blocking: true,
        priority: 30,
      });
    }
  }
  // Schedule C header (items B and F-J) and line 30(a): the form asks them,
  // the engine needs only line G (a "No" is out of scope).
  for (const o of owners) {
    const b = facts.businesses.find((x) => x.owner === o);
    if (!b) continue;
    const base = `businesses[${o}]`;
    const you = who(o);
    // On a joint return both businesses get the same questions: name each.
    const theBiz = b.name
      ? `“${b.name}”`
      : o === 'spouse'
        ? 'your spouse’s business'
        : 'your business';
    const mfj = statusOf(facts) === 'mfj';
    const ask = (
      field: string,
      question: string,
      why: string,
      cite: string,
      priority: number
    ) =>
      add({
        path: `${base}.${field}`,
        question,
        why,
        cite,
        blocking: true,
        priority,
      });
    if (b.materiallyParticipated === undefined)
      ask(
        'materiallyParticipated',
        `Did ${you}${mfj ? (o === 'spouse' ? ' (with your help)' : ' (with your spouse’s help)') : ''} work in ${theBiz} regularly, e.g. over 500 hours or nearly all the work?`,
        'Most people who run their own business do. If not, the business counts as passive, with loss rules 1040kit can’t handle yet.',
        'Schedule C, line G; Pub. 925, Material Participation',
        34
      );
    if (!b.principalBusinessCode)
      ask(
        'principalBusinessCode',
        `Which 6-digit IRS business code fits ${theBiz}? If you don’t know it, ask and I’ll suggest one.`,
        'Your business form asks for a code that names the main kind of work the business does.',
        'Schedule C, line B; Schedule C instructions, Principal Business or Professional Activity Codes',
        35
      );
    if (b.accountingMethod === undefined)
      ask(
        'accountingMethod',
        `Does ${theBiz} count income and expenses when paid (cash) or when billed (accrual)?`,
        'Your business form asks which method the business uses. Most freelancers use cash.',
        'Schedule C, line F; Pub. 334, Accounting Methods',
        36
      );
    else if (b.accountingMethod === 'other' && !b.accountingMethodOther)
      ask(
        'accountingMethodOther',
        'In a few words, what accounting method does the business use?',
        'Your business form asks you to describe a method other than cash or accrual.',
        'Schedule C, line F',
        36
      );
    if (b.startedOrAcquiredThisYear === undefined)
      ask(
        'startedOrAcquiredThisYear',
        `Did ${you} start or buy ${theBiz} during ${year}?`,
        'Your business form has a box for a business that is new this year.',
        'Schedule C, line H',
        37
      );
    if (b.madePaymentsRequiring1099 === undefined)
      ask(
        'madePaymentsRequiring1099',
        `Did ${theBiz} make payments this year that require a Form 1099, such as paying a contractor?`,
        'Your business form asks whether the business had to send any 1099s.',
        'Schedule C, line I; General Instructions for Certain Information Returns',
        38
      );
    else if (b.madePaymentsRequiring1099 && b.filedRequired1099s === undefined)
      ask(
        'filedRequired1099s',
        `Did ${theBiz} file, or will it file, all the Forms 1099 it has to send?`,
        'Your business form asks this after a Yes on the 1099 question.',
        'Schedule C, line J',
        38
      );
    if (b.operatedFromHome === undefined)
      ask(
        'operatedFromHome',
        `Did ${you} run ${theBiz} from your home address?`,
        'If the business has its own address, your business form asks for it.',
        'Schedule C, line E',
        37
      );
    if (b.expensesReviewed === undefined)
      ask(
        'expensesReviewed',
        `Which of these did ${theBiz} pay for in ${year}? Enter the total for each.`,
        'Each business expense lowers the profit you pay income tax and self-employment tax on. Keep the receipts, invoices or statements; you don’t send them with the return.',
        'Schedule C, Part II; Pub. 334',
        40
      );
    if (node(`schC.netProfit.${o}`) < 0 && b.allInvestmentAtRisk === undefined)
      ask(
        'allInvestmentAtRisk',
        `The business had a loss. Was all the money ${you} put into it ${you === 'you' ? 'your' : 'your spouse’s'} own, at risk of being lost?`,
        'A loss counts in full only when all the money in the business was at risk. Most small businesses are.',
        'Schedule C, line 32; Form 6198',
        39
      );
    // Part IV, when car or truck expenses are claimed on line 9.
    if (b.vehicle || (b.expenses.car_truck ?? 0) > 0) {
      const v = b.vehicleUse ?? {};
      const car = (
        field: keyof VehicleUse,
        question: string,
        why: string,
        line: string
      ) => {
        if (v[field] === undefined)
          ask(
            `vehicleUse.${field}`,
            question,
            why,
            `Schedule C, line ${line}`,
            41
          );
      };
      car(
        'placedInService',
        `When did you start using the vehicle for ${theBiz}?`,
        'Your business form asks for the date, when you claim car expenses.',
        '43'
      );
      if (!b.vehicle)
        car(
          'businessMiles',
          `How many miles did ${you} drive the vehicle for business in ${year}?`,
          'Your business form asks for the business miles behind the car expenses.',
          '44a'
        );
      car(
        'commutingMiles',
        'How many of its miles were commuting, between home and a regular workplace?',
        'Commuting doesn’t count as business driving; the form asks for it separately.',
        '44b'
      );
      car(
        'otherMiles',
        'How many other, personal miles did you drive it?',
        'The form asks for business, commuting and other miles.',
        '44c'
      );
      car(
        'availableOffDuty',
        'Was the vehicle available for personal use when you weren’t working?',
        'The form asks this about any vehicle used for the business.',
        '45'
      );
      car(
        'anotherVehicle',
        'Do you (or your spouse) have another vehicle for personal use?',
        'The form asks this about any vehicle used for the business.',
        '46'
      );
      car(
        'hasEvidence',
        'Do you have records of the business driving, such as a mileage log?',
        'Car expenses need records to back them up.',
        '47a'
      );
      // Asked with 47a (ignored after a No), so it doesn't need a round of its own.
      if (v.hasEvidence !== false)
        car(
          'evidenceWritten',
          'If you have records, are they written down, like a log or an app?',
          'The form asks whether the records are written.',
          '47b'
        );
    }
    if (
      b.homeOffice?.method === 'simplified' &&
      b.homeOffice.homeSquareFeet === undefined
    )
      ask(
        'homeOffice.homeSquareFeet',
        `How many square feet is the whole home where ${theBiz} has its office?`,
        'The simplified home office method asks for the size of your whole home next to the office.',
        'Schedule C, line 30(a)',
        39
      );
  }
  for (const m of ownedOnReturn(facts, facts.misc1099s)) {
    if (m.treatAsBusiness !== undefined) continue;
    const rentsOrRoyalties = (m.rents ?? 0) > 0 || (m.royalties ?? 0) > 0;
    if (rentsOrRoyalties || (m.otherIncome ?? 0) > 0) {
      add({
        path: `misc1099s[${m.id}].treatAsBusiness`,
        question: `Is the income on the 1099-MISC ${who(m.owner)} received part of a business ${who(m.owner)} run?`,
        why: rentsOrRoyalties
          ? 'Business income goes with your business; otherwise rent and royalties are reported separately.'
          : 'Business income goes with your business (and self-employment tax); otherwise it is other income.',
        blocking: rentsOrRoyalties,
        priority: 31,
      });
    }
  }
  for (const k of ownedOnReturn(facts, facts.k1099s)) {
    if (k.personalPortion === undefined) {
      add({
        path: `k1099s[${k.id}].personalPortion`,
        question:
          'Was any money on the 1099-K personal, such as gifts, shared bills, or personal items sold at a loss? How much?',
        why: 'Personal payments on a 1099-K, like friends paying you back, aren’t business income.',
        cite: 'Form 1040 instructions, Schedule 1, Form(s) 1099-K',
        blocking: false,
        priority: 33,
      });
    }
  }
  if ((facts.obbba?.carLoanInterest ?? 0) > 0 && !facts.obbba?.carLoanVehicle) {
    add({
      path: 'obbba.carLoanVehicle',
      question:
        'Was the car new, bought in or after 2025, assembled in the U.S., and used mainly for personal driving?',
      why: 'Only interest on a loan for a new personal vehicle assembled in the U.S. qualifies.',
      cite: 'Schedule 1-A, Part IV',
      blocking: true,
      priority: 40,
    });
  }

  // 1099-MISC rents/royalties that are not business receipts must belong to a Schedule E property.
  const rentals = rentalsOnReturn(facts);
  const linked = new Set(rentals.flatMap((r) => rentalMiscIds(facts, r)));
  const unlinked = ownedOnReturn(facts, facts.misc1099s).filter(
    (m) =>
      m.treatAsBusiness === false &&
      ((m.rents ?? 0) > 0 || (m.royalties ?? 0) > 0) &&
      !linked.has(m.id)
  );
  // With no property yet, ask for it first; then which one each 1099-MISC is for.
  for (const m of rentals.length > 0 ? unlinked : []) {
    add({
      path: `misc1099s[${m.id}].rentalId`,
      question: `Which rental property or royalty source is the 1099-MISC with rents or royalties ${who(m.owner)} received for?`,
      why: 'Rent and royalties on a 1099-MISC are reported with the property they come from.',
      cite: 'Schedule E; 1099-MISC boxes 1 and 2',
      blocking: true,
      priority: 56,
    });
  }

  // Schedule E.
  if (
    rentals.length === 0 &&
    (facts.screening?.hasRentalOrRoyaltyIncome === true || unlinked.length > 0)
  ) {
    add({
      path: 'rentals',
      question:
        'What rental property or royalty source did you have, and how much rent or royalties did you receive?',
      why: 'Each property or royalty source is reported on its own.',
      cite: 'Schedule E, Part I',
      blocking: true,
      priority: 50,
    });
  }
  const realEstateNet = rentals
    .filter((r) => r.propertyType !== 6)
    .reduce((s, r) => s + node(`schE.net.${r.id}`), 0);
  rentals.forEach((r, i) => {
    const base = `rentals[${r.id}]`;
    const n = `rental or royalty #${i + 1}`;
    const ask = (
      field: string,
      question: string,
      why: string,
      priority: number,
      cite?: string
    ) =>
      add({
        path: `${base}.${field}`,
        question,
        why,
        ...(cite ? { cite } : {}),
        blocking: true,
        priority,
      });
    if (r.propertyType === undefined)
      ask(
        'propertyType',
        `What kind of property is ${n}: a house, apartment building, vacation rental, commercial, land, or royalties?`,
        'The kind of property decides which rules apply; royalties work differently.',
        51,
        'Schedule E, line 1b'
      );
    if (r.expensesReviewed === undefined)
      ask(
        'expensesReviewed',
        `Which expenses did you pay for ${n}? Enter the total for each.`,
        'Rental expenses lower the rent you pay tax on. Keep the receipts and statements; you don’t send them with the return.',
        58,
        'Schedule E, lines 5-19; Pub. 527'
      );
    if (r.propertyType === 6) return;
    if (r.fairRentalDays === undefined)
      ask(
        'fairRentalDays',
        `How many days was ${n} rented at a fair price this year?`,
        'Rental days decide whether vacation-home rules apply.',
        52,
        'Schedule E, line 2; Pub. 527'
      );
    if (r.personalUseDays === undefined)
      ask(
        'personalUseDays',
        `How many days did you, your family, or anyone paying below fair rent use ${n}?`,
        'Personal use splits the expenses and can make the property count as a home.',
        53,
        'Pub. 527'
      );
    if (r.ownsDepreciableProperty === undefined)
      ask(
        'ownsDepreciableProperty',
        `Do you own the building or equipment you rent out for ${n}, rather than subletting it?`,
        'A rental you own has to be depreciated, which 1040kit can’t compute yet.',
        54,
        'Form 4562'
      );
    if (r.priorYearUnallowedLoss === undefined)
      ask(
        'priorYearUnallowedLoss',
        'Do you have a rental loss from an earlier year that you could not deduct then (a Form 8582 carryover)?',
        'An earlier loss carried forward needs a form 1040kit can’t prepare yet.',
        55,
        'Form 8582; i1040se, Line 22'
      );
    if (realEstateNet < 0 && r.activeParticipation === undefined)
      ask(
        'activeParticipation',
        `Did you make the management decisions for ${n}, such as approving tenants, rent and repairs?`,
        'A rental loss can be deducted here only if you actively managed the property.',
        56,
        'Pub. 925'
      );
  });

  // Student loan interest (Schedule 1 line 21).
  const e1098s = ownedOnReturn(facts, facts.e1098s ?? []);
  const loanInterest =
    e1098s.some((e) => e.interest > 0) ||
    (facts.adjustments?.studentLoanInterestOther ?? 0) > 0;
  if (facts.screening?.paidStudentLoanInterest === true && !loanInterest) {
    add({
      path: 'e1098s',
      question:
        'Do you have a Form 1098-E from your loan servicer? If not, how much student loan interest did you pay?',
      why: 'You may be able to deduct up to $2,500 of student loan interest.',
      cite: 'Schedule 1, line 21',
      blocking: true,
      priority: 44,
    });
  }
  if (loanInterest) {
    if (facts.studentLoan?.legallyObligated === undefined)
      add({
        path: 'studentLoan.legallyObligated',
        question:
          'Are you (or your spouse) the one legally required to pay the student loan, not a parent or someone else?',
        why: 'Only interest you were legally required to pay counts.',
        cite: 'Form 1040 instructions, Schedule 1 line 21; Pub. 970',
        blocking: true,
        priority: 45,
      });
    if (facts.studentLoan?.qualifiedLoan === undefined)
      add({
        path: 'studentLoan.qualifiedLoan',
        question:
          'Was the loan used only for college costs of you, your spouse or a dependent, and not from a relative?',
        why: 'Only a loan taken out just to pay for education, and not from a relative, counts.',
        cite: 'Form 1040 instructions, Schedule 1 line 21, Qualified student loan',
        blocking: true,
        priority: 46,
      });
  }

  // Earned income credit (i1040gi line 27a): asked only while the credit is possible.
  if (eic.possible) {
    const mfj = statusOf(facts) === 'mfj';
    const filers: PersonId[] = mfj ? ['taxpayer', 'spouse'] : ['taxpayer'];
    for (const o of filers) {
      const person = o === 'taxpayer' ? facts.taxpayer : facts.spouse;
      if (
        person?.livedInUsOverHalfYear === undefined &&
        (o === 'taxpayer' || eic.children === 0)
      )
        add({
          path: `${o}.livedInUsOverHalfYear`,
          question:
            o === 'taxpayer'
              ? 'Was your main home in the United States for more than half of the year?'
              : 'Was your spouse’s main home in the United States for more than half of the year?',
          why: 'The earned income credit needs your main home (and your child’s) to be in the U.S. for over half the year.',
          blocking: true,
          priority: 60,
        });
    }
    if (!mfj && facts.taxpayer.qualifyingChildOfAnother === undefined)
      add({
        path: 'taxpayer.qualifyingChildOfAnother',
        question:
          'Could you be claimed as the qualifying child of another person, such as a parent you lived with, this year?',
        why: 'You can’t get the earned income credit if someone else can claim you as their qualifying child.',
        cite: 'Form 1040 instructions, line 27a',
        blocking: true,
        priority: 61,
      });
    if (facts.eitc?.priorDisallowance === undefined)
      add({
        path: 'eitc.priorDisallowance',
        question:
          'Was your earned income credit ever reduced or denied by the IRS for a reason other than a math error?',
        why: 'After an earlier denial, the credit needs an extra form that 1040kit can’t prepare yet.',
        cite: 'Form 8862',
        blocking: true,
        priority: 62,
      });
    if (eic.children === 0) {
      // Without a qualifying child the age 25-64 test needs the dates of birth.
      for (const o of filers) {
        const m = out.find((x) => x.path === `${o}.dateOfBirth`);
        if (m) {
          m.blocking = true;
          m.why = `${m.why} Without a qualifying child, the earned income credit needs you (or your spouse) to be 25 to 64.`;
        }
      }
    }
  }

  // Tax already paid during the year (Form 1040 line 26).
  const receipts = facts.estimatedPayments ?? [];
  const paidEstimated = facts.screening?.paidEstimatedTax;
  if (paidEstimated === undefined && receipts.length === 0) {
    add({
      path: 'screening.paidEstimatedTax',
      question: `Did you${status === 'mfj' ? ' or your spouse' : ''} pay estimated tax for ${year} (Form 1040-ES, Direct Pay, EFTPS), or apply part of your ${year - 1} refund to it?`,
      why: 'Tax you paid during the year lowers what you owe now. Save any payment confirmations in the inbox folder and 1040kit reads them.',
      cite: 'Form 1040, line 26; Form 1040-ES',
      blocking: true,
      priority: 70,
    });
  }
  if (paidEstimated === true || receipts.length > 0) {
    if (facts.payments?.estimatedTaxPayments === undefined) {
      const list = receipts
        .map((p) => `${formatCents(p.amount)}${p.date ? ` on ${p.date}` : ''}`)
        .join(', ');
      add({
        path: 'payments.estimatedTaxPayments',
        question:
          receipts.length > 0
            ? `Besides the payment receipts in your documents, did you pay any other estimated tax for ${year}? Enter the total, or 0.`
            : `What was the total of your estimated tax payments for ${year}, including one made in January ${year + 1}?`,
        why:
          receipts.length > 0
            ? `Receipts read from your documents: ${list}. Every payment for the year lowers what you owe.`
            : `Every payment for the year lowers what you owe. Don’t count last year’s refund applied to ${year}; that is asked next.`,
        cite: 'Form 1040, line 26; Form 1040-ES',
        blocking: true,
        priority: 71,
      });
    }
    if (facts.payments?.priorYearOverpaymentApplied === undefined) {
      add({
        path: 'payments.priorYearOverpaymentApplied',
        question: `How much of your ${year - 1} refund did you apply to your ${year} estimated tax? Enter 0 if none.`,
        why: `A refund you applied to this year counts as a payment. It is on your ${year - 1} Form 1040, line 36.`,
        cite: 'Form 1040, line 26',
        blocking: true,
        priority: 72,
      });
    }
  }

  // Out-of-scope screening.
  SCREENING.forEach((s, i) => {
    let answered: boolean;
    let path: string;
    if (s.key === 'digitalAssetActivity') {
      answered = facts.digitalAssetActivity !== undefined;
      path = 'digitalAssetActivity';
    } else if (s.key.startsWith('screening.')) {
      const k = s.key.slice('screening.'.length) as keyof Screening;
      answered =
        facts.screening?.[k] !== undefined ||
        // Dependents already on the return answer it.
        (k === 'hasDependents' && facts.dependents.length > 0);
      path = s.key;
    } else {
      answered =
        facts.outOfScope?.[s.key as keyof OutOfScopeFlags] !== undefined;
      path = `outOfScope.${s.key}`;
    }
    if (!answered) {
      add({
        path,
        question: s.question,
        why: s.why,
        ...(s.cite ? { cite: s.cite } : {}),
        blocking: true,
        priority: 100 + i,
      });
    }
  });

  return out.sort(
    (a, b) => Number(b.blocking) - Number(a.blocking) || a.priority - b.priority
  );
}
