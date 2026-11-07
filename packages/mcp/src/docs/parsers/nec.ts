import {
  emptyParsed,
  read1099Header,
  readAmounts,
  WITHHELD,
  type ParsedDoc,
} from './common.ts';

export function parseNec1099(text: string, corrected: boolean): ParsedDoc {
  const out = emptyParsed(corrected);
  read1099Header(text, out);
  readAmounts(text, out, {
    nonemployeeComp: { label: /Nonemployee compensation/i, required: true },
    federalWithheld: WITHHELD,
  });
  return out;
}
