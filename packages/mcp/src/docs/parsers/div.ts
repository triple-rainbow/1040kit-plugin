import {
  emptyParsed,
  read1099Header,
  readAmounts,
  WITHHELD,
  type ParsedDoc,
} from './common.ts';

export function parseDiv1099(text: string, corrected: boolean): ParsedDoc {
  const out = emptyParsed(corrected);
  read1099Header(text, out);
  readAmounts(text, out, {
    ordinaryDividends: { label: /Total ordinary dividends/i, required: true },
    qualifiedDividends: { label: /Qualified dividends/i, required: true },
    capitalGainDistributions: {
      label: /Total capital gain distr(?:ibutions|\.)?/i,
    },
    federalWithheld: WITHHELD,
    section199aDividends: { label: /Section 199A dividends/i },
    exemptInterestDividends: { label: /Exempt-interest dividends/i },
  });
  const a = out.amounts;
  if ((a.qualifiedDividends ?? 0) > (a.ordinaryDividends ?? 0)) {
    out.lowConfidence.push({
      field: 'qualifiedDividends',
      reason:
        'Qualified dividends (1b) are larger than total ordinary dividends (1a).',
    });
  }
  return out;
}
