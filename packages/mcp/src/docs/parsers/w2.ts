import {
  EIN_RE,
  emptyParsed,
  readAmounts,
  tinAfter,
  valueAfter,
  type ParsedDoc,
} from './common.ts';

/** TY2025 Additional Medicare Tax withholding starts at $200,000 of wages. */
const ADDL_MEDICARE_THRESHOLD = 20_000_000;
const TOLERANCE = 100; // $1

export function parseW2(text: string, corrected: boolean): ParsedDoc {
  const out = emptyParsed(corrected);
  readAmounts(text, out, {
    wages: {
      label: /Wages,?\s*tips,?\s*other\s*comp(?:ensation|\.)?/i,
      required: true,
    },
    federalWithheld: { label: /Federal income tax withheld/i, required: true },
    ssWages: { label: /Social security wages/i, required: true },
    ssTax: { label: /Social security tax withheld/i, required: true },
    medicareWages: { label: /Medicare wages and tips/i, required: true },
    medicareTax: { label: /Medicare tax withheld/i, required: true },
    ssTips: { label: /Social security tips/i },
    allocatedTips: { label: /Allocated tips/i },
  });

  // The employee's SSN (box a) is never read: 1040kit doesn't store SSNs.
  const ein =
    tinAfter(text, /Employer identification number/i, EIN_RE) ??
    EIN_RE.exec(text)?.[1];
  if (ein) out.pii.payerTin = ein;

  const employer = valueAfter(
    text,
    /Employer['’]?s name, address,? and ZIP code/i
  );
  if (employer) out.names.payer = employer.slice(0, 80);
  const employee = valueAfter(
    text,
    /Employee['’]?s first name and initial\s*Last name(?:\s*Suff\.?)?/i
  );
  if (employee) out.names.recipient = employee.slice(0, 80);

  if (/Statutory employee\s*(?:X|\[X\]|☒)/i.test(text))
    out.flags.statutoryEmployee = true;
  if (/Retirement plan\s*(?:X|\[X\]|☒)/i.test(text))
    out.flags.retirementPlan = true;

  // Cross-checks (box 4 ≈ 6.2% of box 3; box 6 ≈ 1.45% of box 5 + 0.9% over $200k).
  const a = out.amounts;
  if (a.ssWages !== undefined && a.ssTax !== undefined && a.ssWages > 0) {
    if (Math.abs(a.ssTax - Math.round(a.ssWages * 0.062)) > TOLERANCE) {
      out.lowConfidence.push({
        field: 'ssTax',
        reason:
          'Box 4 is not 6.2% of box 3. Check both numbers against the W-2.',
      });
    }
  }
  if (
    a.medicareWages !== undefined &&
    a.medicareTax !== undefined &&
    a.medicareWages > 0
  ) {
    const base = Math.round(a.medicareWages * 0.0145);
    const addl = Math.round(
      Math.max(0, a.medicareWages - ADDL_MEDICARE_THRESHOLD) * 0.009
    );
    const ok =
      Math.abs(a.medicareTax - base) <= TOLERANCE ||
      Math.abs(a.medicareTax - base - addl) <= TOLERANCE;
    if (!ok) {
      out.lowConfidence.push({
        field: 'medicareTax',
        reason:
          'Box 6 is not 1.45% of box 5. Check both numbers against the W-2.',
      });
    }
  }
  if (
    a.wages !== undefined &&
    a.federalWithheld !== undefined &&
    a.federalWithheld > a.wages &&
    a.wages > 0
  ) {
    out.lowConfidence.push({
      field: 'federalWithheld',
      reason: 'Withholding (box 2) is larger than wages (box 1).',
    });
  }
  return out;
}
