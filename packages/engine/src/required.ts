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
import { rentalsOnReturn } from './forms/schE.ts';
import { getParams } from './params/index.ts';
import { eicCompleted } from './tax/eic.ts';
import type {
  MissingFact,
  OutOfScopeFlags,
  PersonId,
  Screening,
  TaxFacts,
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
    why: 'Retirement distributions are not supported in v1.',
  },
  {
    key: 'socialSecurityBenefits',
    question:
      'Did you receive Social Security benefits (Form SSA-1099) this year?',
    why: 'Social Security benefits are not supported in v1.',
  },
  {
    key: 'stockOrCryptoSales',
    question:
      'Did you sell any stocks, funds or crypto this year (Form 1099-B)?',
    why: 'Sales of investments need Form 8949 and Schedule D, not supported in v1.',
  },
  {
    key: 'screening.hasRentalOrRoyaltyIncome',
    question:
      'Did you receive rent from a property, or royalties (for example from a book, music, or oil and gas), this year?',
    why: 'Rents and royalties are reported on Schedule E, Part I.',
  },
  {
    key: 'k1Income',
    question:
      'Did you receive a Schedule K-1 from a partnership, S corporation, estate or trust?',
    why: 'K-1 income is not supported in v1.',
  },
  {
    key: 'foreignIncomeOrAccounts',
    question:
      'Did you have income from outside the U.S., pay foreign taxes, or hold foreign bank accounts?',
    why: 'Foreign income and accounts are not supported in v1.',
  },
  {
    key: 'unemploymentCompensation',
    question: 'Did you receive unemployment benefits this year (Form 1099-G)?',
    why: 'Unemployment compensation is not supported in v1.',
  },
  {
    key: 'hsa',
    question:
      'Did you or your employer put money into a health savings account (HSA), or did you take money out of one?',
    why: 'HSAs need Form 8889, not supported in v1.',
  },
  {
    key: 'educationExpenses',
    question:
      'Did you pay college tuition for yourself or a dependent and want an education credit (Form 1098-T)?',
    why: 'Education credits need Form 8863, not supported in v1.',
  },
  {
    key: 'screening.paidStudentLoanInterest',
    question: 'Did you pay interest on a student loan this year (Form 1098-E)?',
    why: 'Student loan interest can be deducted on Schedule 1, line 21 (up to $2,500).',
  },
  {
    key: 'wantsToItemize',
    question:
      'Do you want to itemize deductions (mortgage interest, state taxes, gifts to charity) instead of the standard deduction?',
    why: 'Itemized deductions (Schedule A) are not supported in v1.',
  },
  {
    key: 'marriedFilingSeparately',
    question:
      'If you are married, do you plan to file separately from your spouse?',
    why: 'Married filing separately is not supported in v1.',
  },
  {
    key: 'other',
    question:
      'Any other income or tax situation not covered yet, such as gambling winnings, alimony, or a household employee?',
    why: 'v1 covers a limited set of situations; anything else must be flagged, not guessed.',
  },
  {
    key: 'digitalAssetActivity',
    question:
      'Did you receive, sell, swap or otherwise dispose of any digital assets (crypto, NFTs) this year?',
    why: 'Form 1040 asks this question; digital asset transactions are not supported in v1.',
  },
];

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
      question:
        'What is your filing status: single, married filing jointly, or head of household?',
      why: 'Filing status sets the standard deduction, tax brackets and credit limits.',
      blocking: true,
      priority: 0,
    });
  }

  if (!facts.taxpayer.dateOfBirth) {
    add({
      path: 'taxpayer.dateOfBirth',
      question: 'What is your date of birth?',
      why: 'People 65 or older get a larger standard deduction and the senior deduction (Schedule 1-A).',
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
      why: 'A spouse 65 or older adds to the standard deduction and can get the senior deduction (Schedule 1-A).',
      blocking: false,
      priority: 11,
    });
  }

  // Dependents.
  if (status === 'hoh' && facts.dependents.length === 0) {
    add({
      path: 'dependents',
      question:
        'Who is the qualifying person (a child or relative) who lived with you for more than half the year? Their first and last name, how they are related to you, date of birth, months they lived with you, and whether they have a Social Security number valid for work.',
      why: 'Head of household requires a qualifying person.',
      blocking: true,
      priority: 19,
    });
  } else if (
    facts.screening?.hasDependents === true &&
    facts.dependents.length === 0
  ) {
    add({
      path: 'dependents',
      question:
        'Who lives with you or depends on you? For each person: first and last name, how they are related to you, date of birth, months they lived with you, and whether they have a Social Security number valid for work.',
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
        why: 'Age decides the child tax credit and whether they can be a qualifying child.',
        blocking: true,
        priority: 20,
      });
    }
    if (!d.relationship) {
      add({
        path: `${base}.relationship`,
        question: `How is ${n} related to you (child, stepchild, foster child, sibling, grandchild, niece/nephew, parent, other)?`,
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
        why: 'The child tax credit and the earned income credit count a child only with a valid SSN; otherwise only the $500 credit for other dependents applies.',
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
        why: 'A child 19-23 is a qualifying child only as a full-time student.',
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
        why: 'The child tax credit and the tips, overtime and senior deductions require a valid SSN.',
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
        why: 'Freelance and gig income is reported on Schedule C, where business expenses reduce it.',
        blocking: true,
        priority: 30,
      });
    }
  }
  for (const m of ownedOnReturn(facts, facts.misc1099s)) {
    if (m.treatAsBusiness !== undefined) continue;
    const rentsOrRoyalties = (m.rents ?? 0) > 0 || (m.royalties ?? 0) > 0;
    if (rentsOrRoyalties || (m.otherIncome ?? 0) > 0) {
      add({
        path: `misc1099s[${m.id}].treatAsBusiness`,
        question: `Is the income on the 1099-MISC ${who(m.owner)} received part of a business ${who(m.owner)} run?`,
        why: rentsOrRoyalties
          ? 'Business receipts go on Schedule C; otherwise rents and royalties go on Schedule E, Part I.'
          : 'Business receipts go on Schedule C (with SE tax); otherwise box 3 is other income on Schedule 1.',
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
        why: 'Personal amounts reported on a 1099-K are not business income (i1040gi, Schedule 1, Form(s) 1099-K).',
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
      why: 'Only interest on a new, U.S.-assembled personal vehicle qualifies (Schedule 1-A Part IV).',
      blocking: true,
      priority: 40,
    });
  }

  // 1099-MISC rents/royalties that are not business receipts must belong to a Schedule E property.
  const rentals = rentalsOnReturn(facts);
  const linked = new Set(rentals.flatMap((r) => r.misc1099Ids ?? []));
  for (const m of ownedOnReturn(facts, facts.misc1099s)) {
    if (m.treatAsBusiness !== false) continue;
    if ((m.rents ?? 0) <= 0 && (m.royalties ?? 0) <= 0) continue;
    if (linked.has(m.id)) continue;
    add({
      path: 'rentals[<id>].misc1099Ids',
      question: `Which rental property or royalty source is the 1099-MISC with rents or royalties ${who(m.owner)} received for?`,
      why: `Rents (box 1) and royalties (box 2) on 1099-MISC ${m.id} are reported on Schedule E with the property they come from.`,
      blocking: true,
      priority: 32,
    });
  }

  // Schedule E.
  if (
    facts.screening?.hasRentalOrRoyaltyIncome === true &&
    rentals.length === 0
  ) {
    add({
      path: 'rentals',
      question:
        'What rental property or royalty source did you have, and how much rent or royalties did you receive?',
      why: 'Each rental property or royalty source is one column of Schedule E, Part I.',
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
      priority: number
    ) =>
      add({
        path: `${base}.${field}`,
        question,
        why,
        blocking: true,
        priority,
      });
    if (r.propertyType === undefined)
      ask(
        'propertyType',
        `What kind of property is ${n}: a house, apartment building, vacation rental, commercial, land, or royalties?`,
        'Schedule E line 1b needs the property type; royalties follow different rules.',
        51
      );
    if (r.propertyType === 6) return;
    if (r.fairRentalDays === undefined)
      ask(
        'fairRentalDays',
        `How many days was ${n} rented at a fair price this year?`,
        'Schedule E line 2: rental days decide the vacation-home rules (Pub. 527).',
        52
      );
    if (r.personalUseDays === undefined)
      ask(
        'personalUseDays',
        `How many days did you, your family, or anyone paying below fair rent use ${n}?`,
        'Personal use days split the expenses and can make the property a home (Pub. 527).',
        53
      );
    if (r.ownsDepreciableProperty === undefined)
      ask(
        'ownsDepreciableProperty',
        `Do you own the building or equipment you rent out for ${n}, rather than subletting it?`,
        'Owned rental property must be depreciated (Form 4562), which 1040kit does not compute yet.',
        54
      );
    if (r.priorYearUnallowedLoss === undefined)
      ask(
        'priorYearUnallowedLoss',
        'Do you have a rental loss from an earlier year that you could not deduct then (a Form 8582 carryover)?',
        'A prior-year unallowed passive loss needs Form 8582 (i1040se, Line 22).',
        55
      );
    if (realEstateNet < 0 && r.activeParticipation === undefined)
      ask(
        'activeParticipation',
        `Did you make the management decisions for ${n}, such as approving tenants, rent and repairs?`,
        'A rental loss is deductible without Form 8582 only with active participation (Pub. 925).',
        56
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
      why: 'Student loan interest (up to $2,500) is deducted on Schedule 1, line 21.',
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
        why: 'Only interest you are legally obligated to pay is deductible (i1040gi Schedule 1 line 21; Pub. 970).',
        blocking: true,
        priority: 45,
      });
    if (facts.studentLoan?.qualifiedLoan === undefined)
      add({
        path: 'studentLoan.qualifiedLoan',
        question:
          'Was the loan used only for college costs of you, your spouse or a dependent, and not from a relative?',
        why: 'Only a qualified student loan counts (i1040gi Schedule 1 line 21, Qualified student loan).',
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
          why: 'The earned income credit requires a main home (and a qualifying child’s home) in the U.S. for over half the year.',
          blocking: true,
          priority: 60,
        });
    }
    if (!mfj && facts.taxpayer.qualifyingChildOfAnother === undefined)
      add({
        path: 'taxpayer.qualifyingChildOfAnother',
        question:
          'Could you be claimed as the qualifying child of another person, such as a parent you lived with, this year?',
        why: 'You can’t take the earned income credit if you are the qualifying child of another taxpayer (i1040gi line 27a).',
        blocking: true,
        priority: 61,
      });
    if (facts.eitc?.priorDisallowance === undefined)
      add({
        path: 'eitc.priorDisallowance',
        question:
          'Was your earned income credit ever reduced or denied by the IRS for a reason other than a math error?',
        why: 'A past EIC disallowance requires Form 8862 (i1040gi, Form 8862, who must file).',
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
        blocking: true,
        priority: 100 + i,
      });
    }
  });

  return out.sort(
    (a, b) => Number(b.blocking) - Number(a.blocking) || a.priority - b.priority
  );
}
