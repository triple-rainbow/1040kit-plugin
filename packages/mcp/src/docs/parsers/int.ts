import {
  emptyParsed,
  read1099Header,
  readAmounts,
  WITHHELD,
  type ParsedDoc,
} from './common.ts';

export function parseInt1099(text: string, corrected: boolean): ParsedDoc {
  const out = emptyParsed(corrected);
  read1099Header(text, out);
  readAmounts(text, out, {
    interest: {
      label: /(?:^|\s)1\s+Interest income|Interest income/i,
      required: true,
    },
    earlyWithdrawalPenalty: { label: /Early withdrawal penalty/i },
    usSavingsBondInterest: { label: /Interest on U\.?\s?S\.? Savings Bonds/i },
    federalWithheld: WITHHELD,
    taxExemptInterest: { label: /Tax-exempt interest/i },
  });
  return out;
}
