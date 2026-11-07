/**
 * findDeductions: rule-based scan for deductions and credits (spec §4).
 * Every opportunity states its eligibility test and the question to ask.
 * estimatedSavings comes from recomputing the return with a best-case fact
 * patch (never a hand formula); null when no best case can be inferred.
 */
import { cite } from '../cite.ts';
import { computeReturn } from '../compute.ts';
import { hohQualifyingPerson } from '../dependents.ts';
import {
  bornBefore,
  ownedOnReturn,
  ownersOnReturn,
  peopleOnReturn,
  statusOf,
} from '../facts.ts';
import { eicChildren } from '../forms/eic.ts';
import { businessesOnReturn } from '../forms/schC.ts';
import { max0, mulRate, sumCents, toDollars } from '../money.ts';
import { getParams } from '../params/index.ts';
import { eicCompleted } from '../tax/eic.ts';
import type {
  DeductionOpportunity,
  DeepPartial,
  PersonId,
  ReturnResult,
  TaxFacts,
} from '../types.ts';
import { deepMerge } from './scenario.ts';

type Opp = DeductionOpportunity;

export function findDeductions(facts: TaxFacts, result: ReturnResult): Opp[] {
  const p = getParams(facts.taxYear);
  const status = statusOf(facts);
  const owners = ownersOnReturn(facts);
  const w2s = ownedOnReturn(facts, facts.w2s);
  const biz = businessesOnReturn(facts);
  const node = (id: string) => result.nodes[id]?.value ?? 0;
  const out: Opp[] = [];

  const savings = (patch: DeepPartial<TaxFacts>): number | null => {
    const next = computeReturn(deepMerge(facts, patch));
    const diff = next.summary.refundOrOwed - result.summary.refundOrOwed;
    return diff > 0 ? diff : 0;
  };
  const perOwner = <T>(
    fn: (o: PersonId) => T | undefined
  ): Partial<Record<PersonId, T>> => {
    const r: Partial<Record<PersonId, T>> = {};
    for (const o of owners) {
      const v = fn(o);
      if (v !== undefined) r[o] = v;
    }
    return r;
  };

  // ------------------------------------------------------- filing status
  if (
    (status === 'single' || status === 'hoh') &&
    facts.taxpayer.canBeClaimedAsDependent !== true &&
    facts.dependents.some((d) => hohQualifyingPerson(d, facts, p))
  ) {
    const claimed = status === 'hoh';
    out.push({
      id: 'head_of_household',
      title: 'Head of household filing status',
      eligibility: `You were unmarried on December 31, ${p.year}; you paid more than half the cost of keeping up your home for the year (rent or mortgage interest, property taxes, insurance, repairs, utilities and food eaten at home); and a qualifying person lived with you in that home for more than half the year (temporary absences, such as school, count as time at home). A dependent parent does not have to live with you if you paid more than half the cost of the parent's home. Head of household has a larger standard deduction and wider tax brackets than single.`,
      question:
        'Were you unmarried at the end of the year, and did you pay more than half the cost of keeping up the home you shared with your dependent (rent or mortgage, utilities, repairs, insurance, groceries)?',
      docsNeeded: [],
      estimatedSavings: claimed ? null : savings({ filingStatus: 'hoh' }),
      status: claimed ? 'claimed' : 'possible',
      citations: [
        cite('i1040gi', 'Head of Household'),
        cite('p501', 'Head of Household'),
      ],
      factPaths: ['filingStatus'],
    });
  }

  // ------------------------------------------------------------ W-2 users
  if (w2s.length > 0 || biz.length > 0) {
    const claimed = owners.some(
      (o) => (facts.obbba?.qualifiedTips?.[o] ?? 0) > 0
    );
    const box7 = perOwner((o) => {
      const c = sumCents(w2s.filter((w) => w.owner === o).map((w) => w.ssTips));
      return c > 0 ? c : undefined;
    });
    out.push({
      id: 'tips',
      title: 'No tax on tips (Schedule 1-A)',
      eligibility:
        'Qualified tips received in an occupation on the IRS list of occupations that customarily received tips, reported on a W-2 (box 7) or 1099; the person who received them has a valid SSN; not married filing separately. Up to $25,000 per return, reduced by $100 per $1,000 of MAGI over $150,000 ($300,000 MFJ).',
      question:
        'Did you receive tips in a job where tipping is customary, such as a server, bartender, hairstylist or delivery driver?',
      docsNeeded: [
        'Form W-2 (box 7, social security tips)',
        'Tip records or Form 4070 reports',
      ],
      estimatedSavings: claimed
        ? null
        : Object.keys(box7).length > 0
          ? savings({ obbba: { qualifiedTips: box7 } })
          : null,
      status: claimed ? 'claimed' : 'possible',
      citations: [cite('f1040s1a', 'Part II'), cite('pl11921')],
      factPaths: ['obbba.qualifiedTips.<owner>'],
    });
  }
  if (w2s.length > 0) {
    const claimed = owners.some(
      (o) => (facts.obbba?.qualifiedOvertime?.[o] ?? 0) > 0
    );
    out.push({
      id: 'overtime',
      title: 'No tax on overtime (Schedule 1-A)',
      eligibility:
        'The overtime premium (the "half" in time-and-a-half) required by the Fair Labor Standards Act, included in W-2 box 1; valid SSN; not married filing separately. Up to $12,500 ($25,000 MFJ), reduced by $100 per $1,000 of MAGI over $150,000 ($300,000 MFJ).',
      question:
        'Were you paid overtime at time-and-a-half for hours over 40 a week, and does your employer report the extra half separately?',
      docsNeeded: [
        'Form W-2 or an employer statement showing qualified overtime',
        'Pay stubs',
      ],
      estimatedSavings: null,
      status: claimed ? 'claimed' : 'possible',
      citations: [cite('f1040s1a', 'Part III'), cite('pl11921')],
      factPaths: ['obbba.qualifiedOvertime.<owner>'],
    });
  }
  {
    const claimed = node('carLoanInterestDeduction') > 0;
    out.push({
      id: 'car_loan_interest',
      title: 'Car loan interest on a new U.S.-assembled vehicle (Schedule 1-A)',
      eligibility:
        'Interest on a loan taken out after 2024 to buy a new car, SUV, van, pickup or motorcycle for personal use, with final assembly in the U.S. and secured by the vehicle. Up to $10,000, reduced by $200 per $1,000 of MAGI over $100,000 ($200,000 MFJ).',
      question:
        'Did you buy a new vehicle with a loan in or after 2025, for personal use, assembled in the U.S.?',
      docsNeeded: [
        'Lender statement of interest paid',
        'Vehicle identification number (VIN)',
      ],
      estimatedSavings: null,
      status: claimed ? 'claimed' : 'possible',
      citations: [cite('f1040s1a', 'Part IV'), cite('pl11921')],
      factPaths: ['obbba.carLoanInterest', 'obbba.carLoanVehicle'],
    });
  }
  {
    const people = peopleOnReturn(facts);
    const unknown = people.filter((x) => !x.dateOfBirth);
    const senior = people.some((x) =>
      bornBefore(x.dateOfBirth, p.age65BornBefore)
    );
    if (node('seniorDeduction') > 0) {
      out.push(
        seniorOpp(
          'claimed',
          null,
          people.map((x) => `${x.id}.dateOfBirth`)
        )
      );
    } else if (unknown.length > 0 && !senior) {
      const patch: DeepPartial<TaxFacts> = {};
      for (const x of unknown)
        (patch as Record<string, unknown>)[x.id] = {
          dateOfBirth: '1940-01-01',
        };
      out.push(
        seniorOpp(
          'possible',
          savings(patch),
          unknown.map((x) => `${x.id}.dateOfBirth`)
        )
      );
    }
  }
  {
    const claimed = node('childCredits') + node('actc') > 0;
    if (claimed || facts.dependents.length === 0) {
      out.push({
        id: 'ctc_odc',
        title: 'Child tax credit and credit for other dependents',
        eligibility:
          'A child under 17 at year end with an SSN valid for work who lived with you more than half the year ($2,200 credit, up to $1,700 refundable), or another dependent such as an older child or a parent you support ($500). You need a valid SSN for the child tax credit.',
        question:
          'Do you have children or other relatives you support who lived with you, or a parent you support?',
        docsNeeded: [
          'Each dependent’s Social Security card or ITIN',
          'Date of birth',
        ],
        estimatedSavings: null,
        status: claimed ? 'claimed' : 'possible',
        citations: [
          cite('i1040s8'),
          cite('i1040gi', 'Who Qualifies as Your Dependent'),
        ],
        factPaths: ['dependents'],
      });
    }
  }
  {
    const h = facts.hints;
    if (
      h &&
      (h.mortgageInterest ||
        h.stateLocalTaxes ||
        h.charitableGifts ||
        h.medicalExpenses)
    ) {
      const agi = node('agi');
      const reduction = mulRate(
        max0(agi - p.saltCap.magiThreshold),
        p.saltCap.reductionPpm
      );
      const saltCap = Math.max(p.saltCap.floor, p.saltCap.cap - reduction);
      const itemized =
        toDollars(h.mortgageInterest ?? 0) +
        Math.min(toDollars(h.stateLocalTaxes ?? 0), saltCap) +
        toDollars(h.charitableGifts ?? 0) +
        max0(
          toDollars(h.medicalExpenses ?? 0) - mulRate(agi, p.medicalAgiFloorPpm)
        );
      if (itemized > node('standardDeduction')) {
        out.push({
          id: 'itemize_flag',
          title: 'Itemizing may beat your standard deduction',
          eligibility: `Your mortgage interest, state and local taxes (capped at $${saltCap.toLocaleString('en-US')}), gifts to charity and medical costs over 7.5% of AGI add up to about $${itemized.toLocaleString('en-US')}, more than your $${node('standardDeduction').toLocaleString('en-US')} standard deduction. Schedule A is not supported in v1.`,
          question:
            'Do you want to itemize? 1040kit v1 can only use the standard deduction, so itemizing would need another tool. Is that OK?',
          docsNeeded: [
            'Form 1098 (mortgage interest)',
            'Property and state tax records',
            'Charity receipts',
          ],
          estimatedSavings: null,
          status: 'flag_only',
          citations: [cite('i1040sca'), cite('i1040gi', 'Line 12e')],
          factPaths: ['outOfScope.wantsToItemize'],
        });
      }
    }
  }
  {
    // Earned income credit (Form 1040 line 27a), computed by the engine.
    const claimed = node('eic') > 0;
    const kids = Math.min(3, eicChildren(facts).length);
    const limit = eicCompleted(status, kids, p);
    const earned = node('earnedIncome');
    if (claimed || (earned > 0 && earned < limit && node('agi') < limit)) {
      const col = p.eitc.byChildren[kids]!;
      const mfj = status === 'mfj';
      const filers: PersonId[] = mfj ? ['taxpayer', 'spouse'] : ['taxpayer'];
      out.push({
        id: 'eitc',
        title: 'Earned income credit (EIC)',
        eligibility: `Earned income and AGI under $${limit.toLocaleString('en-US')} with ${kids} qualifying child(ren) (credit up to $${col.maxCredit.toLocaleString('en-US')}); investment income $${p.eitc.investmentIncomeLimit.toLocaleString('en-US')} or less; an SSN valid for work for you (and your spouse) and each counted child; main home in the U.S. over half the year; not the qualifying child of another person. Without a qualifying child: age 25 to 64 and not a dependent.`,
        question: claimed
          ? 'Do the children listed for the EIC each have an SSN and live with you in the U.S. more than half the year?'
          : 'Did your children live with you in the U.S. for more than half the year, and do you and they have SSNs valid for work?',
        docsNeeded: [
          'Social Security cards for you, your spouse and each child',
          'School, medical or lease records showing where each child lived',
        ],
        estimatedSavings: null,
        status: claimed ? 'claimed' : 'possible',
        citations: [
          cite(
            'i1040gi',
            'Lines 27a, 27b, and 27c— Earned Income Credit (EIC)'
          ),
          cite('p596'),
        ],
        factPaths: [
          ...filers.flatMap((o) => [
            `${o}.hasValidSsn`,
            `${o}.livedInUsOverHalfYear`,
            `${o}.dateOfBirth`,
          ]),
          ...(mfj ? [] : ['taxpayer.qualifyingChildOfAnother']),
          'eitc.priorDisallowance',
          'dependents[<id>].hasValidSsn',
          'dependents[<id>].monthsLivedWithTaxpayer',
          'dependents[<id>].fullTimeStudent',
          'dependents[<id>].permanentlyDisabled',
        ],
      });
    }
  }
  {
    // Student loan interest (Schedule 1 line 21).
    const claimed = node('studentLoanInterestDeduction') > 0;
    const loans = ownedOnReturn(facts, facts.e1098s ?? []);
    const paid =
      loans.some((e) => e.interest > 0) ||
      (facts.adjustments?.studentLoanInterestOther ?? 0) > 0;
    const blocked = paid && !claimed;
    const sl = p.studentLoanInterest;
    out.push({
      id: 'student_loan_interest',
      title: 'Student loan interest deduction',
      eligibility: `Interest paid on a qualified student loan you are legally obligated to pay, taken out only for college costs of you, your spouse or a dependent; not if anyone can claim you as a dependent. Up to $${sl.cap.toLocaleString('en-US')}, phased out over MAGI $${sl.phaseoutStart.single.toLocaleString('en-US')}-$${(sl.phaseoutStart.single + sl.phaseoutRange.single).toLocaleString('en-US')} ($${sl.phaseoutStart.mfj.toLocaleString('en-US')}-$${(sl.phaseoutStart.mfj + sl.phaseoutRange.mfj).toLocaleString('en-US')} MFJ).`,
      question:
        'Did you pay interest on a student loan this year (your loan servicer sends Form 1098-E when it is $600 or more)?',
      docsNeeded: ['Form 1098-E', 'Loan servicer statement if no 1098-E'],
      estimatedSavings: blocked
        ? savings({
            studentLoan: { legallyObligated: true, qualifiedLoan: true },
          })
        : null,
      status: claimed ? 'claimed' : 'possible',
      citations: [
        cite('i1040gi', 'Schedule 1, Line 21'),
        cite('p970', 'Student Loan Interest Deduction'),
      ],
      factPaths: [
        'e1098s',
        'adjustments.studentLoanInterestOther',
        'studentLoan.legallyObligated',
        'studentLoan.qualifiedLoan',
      ],
    });
  }
  if (p.year >= 2026 && (facts.hints?.charitableGifts ?? 0) > 0) {
    out.push({
      id: 'charitable_nonitemizer',
      title: 'Charitable deduction for non-itemizers',
      eligibility:
        'Cash gifts to qualifying charities, up to $1,000 ($2,000 MFJ), deductible with the standard deduction starting in 2026 (Form 1040 line 12f). Not computed in v1.',
      question:
        'Did you give cash to a qualifying charity this year? 1040kit v1 does not compute the new line 12f deduction yet.',
      docsNeeded: ['Charity receipts'],
      estimatedSavings: null,
      status: 'flag_only',
      citations: [cite('pl11921'), cite('i1040gi', 'Line 12f')],
      factPaths: [],
    });
  }

  // ------------------------------------------------------------ 1099 users
  if (biz.length > 0 || node('reitDividends') > 0) {
    const claimed = node('qbiDeduction') > 0;
    out.push({
      id: 'qbi',
      title: 'Qualified business income deduction (Form 8995)',
      eligibility:
        'Up to 20% of net business income from a sole proprietorship (after the SE tax deduction, SE health insurance and retirement contributions), limited to 20% of taxable income before it. Computed automatically when taxable income is under the Form 8995 threshold.',
      question:
        'Is your business something you actively run (not a passive investment)?',
      docsNeeded: [],
      estimatedSavings: null,
      status: claimed ? 'claimed' : 'possible',
      citations: [cite('i8995')],
      factPaths: [],
    });
  }
  const profitable = biz.filter((b) => node(`schC.netProfit.${b.owner}`) > 0);
  if (profitable.length > 0) {
    const sehiClaimed = profitable.some(
      (b) =>
        (facts.adjustments?.selfEmployedHealthInsurance?.[b.owner] ?? 0) > 0
    );
    out.push({
      id: 'se_health_insurance',
      title: 'Self-employed health insurance deduction',
      eligibility:
        'Health, dental or long-term care premiums you paid for yourself, your spouse and dependents, in a month you (or your spouse) were not eligible for an employer-subsidized plan. Limited to business net profit less the SE tax deduction and retirement contributions.',
      question:
        'Did you pay your own health insurance premiums (for example a marketplace plan) while self-employed?',
      docsNeeded: ['Premium statements', 'Form 1095-A if from the marketplace'],
      estimatedSavings: null,
      status: sehiClaimed ? 'claimed' : 'possible',
      citations: [cite('i1040gi', 'Schedule 1, Line 17')],
      factPaths: ['adjustments.selfEmployedHealthInsurance.<owner>'],
    });
    const sepClaimed = profitable.some(
      (b) => (facts.adjustments?.sepContributions?.[b.owner] ?? 0) > 0
    );
    out.push({
      id: 'sep_ira',
      title: 'SEP-IRA contribution (what-if)',
      eligibility:
        'A SEP-IRA can be opened and funded up to the filing deadline (including extensions). Self-employed limit: 20% of net earnings after the SE tax deduction, up to the annual limit.',
      question:
        'Would you consider putting money into a SEP-IRA before the filing deadline, and how much could you afford?',
      docsNeeded: ['SEP-IRA contribution confirmation'],
      estimatedSavings: sepClaimed
        ? null
        : savings({
            adjustments: {
              sepContributions: Object.fromEntries(
                profitable.map((b) => [b.owner, 100_000_000_00])
              ),
            },
          }),
      status: sepClaimed ? 'claimed' : 'possible',
      citations: [
        cite('p560', 'Deduction Worksheet for Self-Employed'),
        cite('i1040gi', 'Schedule 1, Line 16'),
      ],
      factPaths: ['adjustments.sepContributions.<owner>'],
    });
  }
  if (biz.length > 0) {
    const homeClaimed = biz.some((b) => b.homeOffice !== undefined);
    const homePatch: DeepPartial<TaxFacts> = {
      businesses: facts.businesses.map((b) =>
        biz.includes(b) && !b.homeOffice
          ? {
              ...b,
              homeOffice: {
                method: 'simplified' as const,
                squareFeet: p.homeOffice.maxSqFt,
              },
            }
          : b
      ),
    };
    out.push({
      id: 'home_office',
      title: 'Home office (simplified method)',
      eligibility:
        'Part of your home used regularly and exclusively for the business, as your principal place of business or to meet clients. Simplified method: $5 per square foot, up to 300 square feet, limited to the business profit.',
      question:
        'Do you use a part of your home only for your business? About how many square feet is it?',
      docsNeeded: ['Floor plan or measurement of the office area'],
      estimatedSavings: homeClaimed ? null : savings(homePatch),
      status: homeClaimed ? 'claimed' : 'possible',
      citations: [cite('i1040sc', 'Line 30'), cite('p587')],
      factPaths: ['businesses[<owner>].homeOffice'],
    });
    // Actual expenses (Form 8829) vs the simplified method, by recomputing the other way.
    const withOffice = biz.filter((b) => b.homeOffice !== undefined);
    if (withOffice.length > 0) {
      const usingActual = withOffice.some(
        (b) => b.homeOffice!.method === 'actual'
      );
      let est: number | null = null;
      if (usingActual) {
        // Would the simplified method do better?
        const patch: DeepPartial<TaxFacts> = {
          businesses: facts.businesses.map((b) =>
            withOffice.includes(b) && b.homeOffice!.method === 'actual'
              ? {
                  ...b,
                  homeOffice: {
                    method: 'simplified' as const,
                    squareFeet: b.homeOffice!.officeSquareFeet,
                  },
                }
              : b
          ),
        };
        est = savings(patch);
      }
      out.push({
        id: 'home_office_actual',
        title:
          'Home office: actual expenses (Form 8829) vs the simplified method',
        eligibility:
          'Same use test as the simplified method. Actual expenses: the business share (office area / home area) of rent or mortgage interest, real estate taxes, insurance, utilities and repairs, plus depreciation of an owned home over 39 years, limited to the business profit; unused amounts carry over (Form 8829 lines 43-44). The simplified method allows no depreciation or carryovers that year.',
        question: usingActual
          ? 'You use actual expenses. Do you want to compare with the simplified method ($5 per square foot, up to 300)?'
          : 'Do you rent or own your home, and what did you pay this year for rent or mortgage interest, taxes, insurance and utilities?',
        docsNeeded: [
          'Lease or mortgage statement (Form 1098)',
          'Property tax, insurance and utility bills',
          'Home purchase price and land value (owners)',
        ],
        estimatedSavings: est,
        status: usingActual ? 'claimed' : 'possible',
        citations: [cite('i8829'), cite('p587'), cite('i1040sc', 'Line 30')],
        factPaths: [
          'businesses[<owner>].homeOffice.method',
          'businesses[<owner>].homeOffice.officeSquareFeet',
          'businesses[<owner>].homeOffice.homeSquareFeet',
          'businesses[<owner>].homeOffice.ownership',
          'businesses[<owner>].homeOffice.direct',
          'businesses[<owner>].homeOffice.indirect',
          'businesses[<owner>].homeOffice.home',
          'businesses[<owner>].homeOffice.carryover',
        ],
      });
    }
    const expenseRule = (
      id: string,
      title: string,
      category: 'car_truck' | 'utilities' | 'other',
      claimed: boolean,
      eligibility: string,
      question: string,
      docsNeeded: string[],
      section: string,
      factPath: string
    ): Opp => ({
      id,
      title,
      eligibility,
      question,
      docsNeeded,
      estimatedSavings: null,
      status: claimed ? 'claimed' : 'possible',
      citations: [cite('i1040sc', section)],
      factPaths: [factPath],
      scheduleCCategory: category,
    });
    out.push(
      expenseRule(
        'mileage',
        'Business mileage (standard mileage rate)',
        'car_truck',
        biz.some((b) => b.vehicle || (b.expenses.car_truck ?? 0) > 0),
        `Miles driven for the business (not commuting), with a log of dates, places and purpose; ${p.mileageRateTenthCents / 10} cents per mile in ${p.year}.`,
        'Did you drive your car for the business (not counting your commute)? About how many miles?',
        ['Mileage log'],
        'Line 9',
        'businesses[<owner>].vehicle.businessMiles'
      ),
      expenseRule(
        'phone_internet',
        'Phone and internet (business share)',
        'utilities',
        biz.some((b) => (b.expenses.utilities ?? 0) > 0),
        'The business-use percentage of your phone and internet bills. You cannot deduct the base rate of the first landline into your home (i1040sc line 25).',
        'Do you use your phone or internet for the business? About what share of the use is for business?',
        ['Phone and internet bills'],
        'Line 25',
        'businesses[<owner>].expenses.utilities'
      ),
      expenseRule(
        'software_subscriptions',
        'Software and subscriptions',
        'other',
        biz.some((b) => (b.expenses.other ?? 0) > 0),
        'Technology and software tools that are ordinary and necessary for the business and do not have to be depreciated or amortized; reported as other expenses (i1040sc Part V, "Technology and software tools").',
        'Do you pay for software, apps or online services you use for the business?',
        ['Receipts or statements'],
        'Line 48 (Part V), Technology and software tools',
        'businesses[<owner>].expenses.other'
      ),
      expenseRule(
        'equipment_de_minimis',
        'Equipment under the de minimis safe harbor',
        'other',
        biz.some((b) => (b.expenses.other ?? 0) > 0),
        'Business equipment costing up to $2,500 per item or invoice ($5,000 with an applicable financial statement), expensed under the de minimis safe harbor election; deducted only as other expenses (i1040sc Part V).',
        'Did you buy equipment for the business, such as a laptop, camera or tools, costing $2,500 or less per item?',
        ['Receipts or invoices'],
        'Line 48 (Part V), De minimis safe harbor for tangible property',
        'businesses[<owner>].expenses.other'
      )
    );
  }
  const ks = ownedOnReturn(facts, facts.k1099s);
  if (ks.length > 0) {
    const claimed = ks.some((k) => (k.personalPortion ?? 0) > 0);
    const answered = ks.every((k) => k.personalPortion !== undefined);
    out.push({
      id: '1099k_reconciliation',
      title: 'Form 1099-K reconciliation',
      eligibility:
        'Amounts on a 1099-K that are not business income (gifts, reimbursements, shared bills, personal items sold at a loss) are not taxable; they are entered at the top of Schedule 1 instead.',
      question:
        'Was any of the money on your 1099-K personal, like friends paying you back or selling your own used items for less than you paid?',
      docsNeeded: ['Payment app transaction history'],
      estimatedSavings: null,
      status: claimed || answered ? 'claimed' : 'possible',
      citations: [
        cite('i1040gi', 'Schedule 1, Form(s) 1099-K'),
        cite('i1099k'),
      ],
      factPaths: ['k1099s[<id>].personalPortion'],
    });
  }

  return out.sort((a, b) => {
    if (a.estimatedSavings === null && b.estimatedSavings === null) return 0;
    if (a.estimatedSavings === null) return 1;
    if (b.estimatedSavings === null) return -1;
    return b.estimatedSavings - a.estimatedSavings;
  });

  function seniorOpp(
    status: Opp['status'],
    est: number | null,
    paths: string[]
  ): Opp {
    return {
      id: 'senior',
      title: 'Enhanced deduction for seniors (Schedule 1-A)',
      eligibility: `Age 65 or older by the end of ${p.year} (born before ${p.age65BornBefore}), valid SSN, not married filing separately. $6,000 per person, reduced by 6% of MAGI over $75,000 ($150,000 MFJ).`,
      question: 'What are your (and your spouse’s) dates of birth?',
      docsNeeded: [],
      estimatedSavings: est,
      status,
      citations: [cite('f1040s1a', 'Part V'), cite('pl11921')],
      factPaths: paths,
    };
  }
}
