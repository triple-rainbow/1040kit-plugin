import {
  emptyParsed,
  read1099Header,
  readAmounts,
  type ParsedDoc,
} from './common.ts';

/**
 * Form 1098-E, Student Loan Interest Statement: box 1 (interest received by
 * the lender) and the box 2 checkbox (box 1 excludes origination fees and/or
 * capitalized interest). The borrower's SSN and the account number are never
 * read.
 */
export function parse1098E(text: string, corrected: boolean): ParsedDoc {
  const out = emptyParsed(corrected);
  read1099Header(text, out, 'LENDER');
  readAmounts(text, out, {
    interest: {
      label: /Student loan interest received by lender/i,
      required: true,
    },
  });
  if (
    /origination fees[^\n]*?(?:\[X\]|\(X\)|☒|\sX\s*$)/im.test(text) ||
    /(?:\[X\]|☒)\s*2\b/.test(text)
  ) {
    out.flags.box2Checked = true;
  }
  return out;
}
