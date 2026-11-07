import {
  emptyParsed,
  read1099Header,
  readAmounts,
  WITHHELD,
  type ParsedDoc,
} from './common.ts';

export function parseMisc1099(text: string, corrected: boolean): ParsedDoc {
  const out = emptyParsed(corrected);
  read1099Header(text, out);
  readAmounts(text, out, {
    rents: { label: /(?:^|\s)1\s+Rents|\bRents\b/i },
    royalties: { label: /\bRoyalties\b/i },
    otherIncome: { label: /\bOther income\b/i },
    federalWithheld: WITHHELD,
  });
  if (
    !out.amounts.rents &&
    !out.amounts.royalties &&
    !out.amounts.otherIncome
  ) {
    out.lowConfidence.push({
      field: 'otherIncome',
      reason:
        'No amount found in boxes 1–3. Ask the user what this 1099-MISC reports.',
    });
  }
  return out;
}
