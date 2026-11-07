import {
  emptyParsed,
  read1099Header,
  readAmounts,
  WITHHELD,
  type ParsedDoc,
} from './common.ts';

export function parseK1099(text: string, corrected: boolean): ParsedDoc {
  const out = emptyParsed(corrected);
  read1099Header(text, out);
  readAmounts(text, out, {
    grossAmount: {
      label:
        /Gross amount of payment card\/third party network transactions|1a\s+Gross amount/i,
      required: true,
    },
    federalWithheld: WITHHELD,
  });
  return out;
}
