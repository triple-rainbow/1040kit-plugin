/** Student loan interest deduction (i1040gi 2025 Schedule 1 line 21 worksheet). */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReturn } from '../src/compute.ts';
import { requiredFacts } from '../src/required.ts';
import type { TaxFacts } from '../src/types.ts';
import { makeFacts, w2 } from './helpers.ts';

const loan = (patch: Partial<TaxFacts> = {}, year: 2025 | 2026 = 2025) =>
  makeFacts(
    {
      e1098s: [{ id: 'e1098_1', owner: 'taxpayer', interest: 300000 }],
      studentLoan: { legallyObligated: true, qualifiedLoan: true },
      ...patch,
    },
    year
  );
const sli = (f: TaxFacts) => computeReturn(f).nodes;

test('capped at $2,500, no phase-out under $85,000', () => {
  const n = sli(loan({ w2s: [w2('w2_1', 6000000)] }));
  assert.equal(n['studentLoan.interestPaid']?.value, 2500);
  assert.equal(n.studentLoanInterestDeduction?.value, 2500);
  assert.equal(n.studentLoanInterestDeduction?.line, '21');
  assert.equal(n.adjustments?.value, 2500);
  assert.equal(n.agi?.value, 57500);
});

test('phase-out: single MAGI 90,000 -> ratio 0.333 -> 2,500 - 833 = 1,667', () => {
  const n = sli(loan({ w2s: [w2('w2_1', 9000000)] }));
  assert.equal(n['studentLoan.magi']?.value, 90000);
  assert.equal(n['studentLoan.phaseoutRatio']?.value, 333);
  assert.equal(n.studentLoanInterestDeduction?.value, 1667);
  assert.equal(
    sli(loan({ w2s: [w2('w2_1', 10000000)] })).studentLoanInterestDeduction
      ?.value,
    0
  );
});

test('MFJ: 2025 phase-out from 170,000; 2026 from 175,000 (Rev. Proc. 2025-32 §4.29)', () => {
  const mfj = (year: 2025 | 2026) =>
    loan(
      {
        filingStatus: 'mfj',
        spouse: {
          id: 'spouse',
          dateOfBirth: '1990-01-01',
          hasValidSsn: true,
          canBeClaimedAsDependent: false,
        },
        w2s: [w2('w2_1', 18000000)],
      },
      year
    );
  assert.equal(sli(mfj(2025)).studentLoanInterestDeduction?.value, 1667); // 10,000 / 30,000 = 0.333
  assert.equal(sli(mfj(2026)).studentLoanInterestDeduction?.value, 2082); // 5,000 / 30,000 = 0.167 -> 418
});

test('interest without a 1098-E counts; dependents and non-qualified loans get nothing', () => {
  const other = makeFacts({
    w2s: [w2('w2_1', 4000000)],
    adjustments: { studentLoanInterestOther: 45050 },
    studentLoan: { legallyObligated: true, qualifiedLoan: true },
  });
  assert.equal(sli(other).studentLoanInterestDeduction?.value, 451);
  const dep = loan({ w2s: [w2('w2_1', 4000000)] });
  dep.taxpayer.canBeClaimedAsDependent = true;
  assert.equal(sli(dep).studentLoanInterestDeduction?.value, 0);
  assert.equal(
    sli(loan({ studentLoan: { legallyObligated: false, qualifiedLoan: true } }))
      .studentLoanInterestDeduction?.value,
    0
  );
  assert.equal(
    sli(loan({ studentLoan: { legallyObligated: true, qualifiedLoan: false } }))
      .studentLoanInterestDeduction?.value,
    0
  );
  // A spouse's 1098-E does not count on a single return.
  const spouse = loan({
    e1098s: [{ id: 'e1098_1', owner: 'spouse', interest: 100000 }],
  });
  assert.equal(sli(spouse).studentLoanInterestDeduction?.value, 0);
});

test('required facts: loan questions when interest exists, 1098-E question after a yes screening answer', () => {
  const f = makeFacts({
    e1098s: [{ id: 'e1098_1', owner: 'taxpayer', interest: 100000 }],
  });
  const paths = requiredFacts(f).map((m) => m.path);
  assert.ok(paths.includes('studentLoan.legallyObligated'));
  assert.ok(paths.includes('studentLoan.qualifiedLoan'));
  const yes = makeFacts({ screening: { paidStudentLoanInterest: true } });
  const m = requiredFacts(yes).find((x) => x.path === 'e1098s');
  assert.equal(m?.blocking, true);
});
