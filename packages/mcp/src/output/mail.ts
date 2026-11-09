/**
 * Where to mail a paper Form 1040, by state of residence.
 *
 * Source: IRS, "Where to file paper tax returns with or without a payment",
 * https://www.irs.gov/filing/where-to-file-paper-tax-returns-with-or-without-a-payment
 * (page last reviewed 2026-06-08; read 2026-11-04). The same table is printed
 * in the 2025 Instructions for Form 1040 (i1040gi), "Where Do You File?".
 * [VERIFY] each filing season: the IRS moves these addresses.
 */
import type { Citation } from '@1040kit/engine';

export const WHERE_TO_FILE_CITATION: Citation = {
  docId: 'irs-where-to-file',
  section: 'Form 1040',
  url: 'https://www.irs.gov/filing/where-to-file-paper-tax-returns-with-or-without-a-payment',
};

const AUSTIN =
  'Department of the Treasury\nInternal Revenue Service\nAustin, TX 73301-0002';
const OGDEN =
  'Department of the Treasury\nInternal Revenue Service\nOgden, UT 84201-0002';
const KC =
  'Department of the Treasury\nInternal Revenue Service\nKansas City, MO 64999-0002';
const CHARLOTTE =
  'Internal Revenue Service\nP.O. Box 1214\nCharlotte, NC 28201-1214';
const LOUISVILLE =
  'Internal Revenue Service\nP.O. Box 931000\nLouisville, KY 40293-1000';

type Row = { name: string; noPayment: string; withPayment: string };

const r = (name: string, noPayment: string, withPayment: string): Row => ({
  name,
  noPayment,
  withPayment,
});

export const WHERE_TO_FILE_1040: Record<string, Row> = {
  AL: r('Alabama', AUSTIN, CHARLOTTE),
  AK: r('Alaska', OGDEN, LOUISVILLE),
  AZ: r('Arizona', AUSTIN, LOUISVILLE),
  AR: r('Arkansas', AUSTIN, LOUISVILLE),
  CA: r('California', OGDEN, LOUISVILLE),
  CO: r('Colorado', OGDEN, LOUISVILLE),
  CT: r('Connecticut', KC, LOUISVILLE),
  DE: r('Delaware', KC, LOUISVILLE),
  DC: r('District of Columbia', KC, LOUISVILLE),
  FL: r('Florida', AUSTIN, CHARLOTTE),
  GA: r('Georgia', AUSTIN, CHARLOTTE),
  HI: r('Hawaii', OGDEN, LOUISVILLE),
  ID: r('Idaho', OGDEN, LOUISVILLE),
  IL: r('Illinois', KC, LOUISVILLE),
  IN: r('Indiana', KC, LOUISVILLE),
  IA: r('Iowa', KC, LOUISVILLE),
  KS: r('Kansas', OGDEN, LOUISVILLE),
  KY: r('Kentucky', KC, LOUISVILLE),
  LA: r('Louisiana', AUSTIN, CHARLOTTE),
  ME: r('Maine', KC, LOUISVILLE),
  MD: r('Maryland', KC, LOUISVILLE),
  MA: r('Massachusetts', KC, LOUISVILLE),
  MI: r('Michigan', OGDEN, LOUISVILLE),
  MN: r('Minnesota', KC, LOUISVILLE),
  MS: r('Mississippi', AUSTIN, CHARLOTTE),
  MO: r('Missouri', KC, LOUISVILLE),
  MT: r('Montana', OGDEN, LOUISVILLE),
  NE: r('Nebraska', OGDEN, LOUISVILLE),
  NV: r('Nevada', OGDEN, LOUISVILLE),
  NH: r('New Hampshire', KC, LOUISVILLE),
  NJ: r('New Jersey', KC, LOUISVILLE),
  NM: r('New Mexico', AUSTIN, LOUISVILLE),
  NY: r('New York', KC, LOUISVILLE),
  NC: r('North Carolina', AUSTIN, CHARLOTTE),
  ND: r('North Dakota', OGDEN, LOUISVILLE),
  OH: r('Ohio', OGDEN, LOUISVILLE),
  OK: r('Oklahoma', AUSTIN, LOUISVILLE),
  OR: r('Oregon', OGDEN, LOUISVILLE),
  PA: r('Pennsylvania', KC, LOUISVILLE),
  RI: r('Rhode Island', KC, LOUISVILLE),
  SC: r('South Carolina', AUSTIN, CHARLOTTE),
  SD: r('South Dakota', OGDEN, LOUISVILLE),
  TN: r('Tennessee', AUSTIN, CHARLOTTE),
  TX: r('Texas', AUSTIN, CHARLOTTE),
  UT: r('Utah', OGDEN, LOUISVILLE),
  VT: r('Vermont', KC, LOUISVILLE),
  VA: r('Virginia', KC, LOUISVILLE),
  WA: r('Washington', OGDEN, LOUISVILLE),
  WV: r('West Virginia', KC, LOUISVILLE),
  WI: r('Wisconsin', KC, LOUISVILLE),
  WY: r('Wyoming', OGDEN, LOUISVILLE),
};

export function mailingAddress(state: string): Row | undefined {
  return WHERE_TO_FILE_1040[state.toUpperCase()];
}

const usd = (v: number) => `$${Math.abs(v).toLocaleString('en-US')}`;

export interface MailContext {
  taxYear: number;
  state: string;
  refundOrOwed: number;
  mfj: boolean;
  w2Count: number;
  now: Date;
  /** Attachments after Form 1040, in IRS attachment-sequence order. */
  attachments?: { title: string; sequence?: string }[];
  /** Boxes the user writes in by hand (SSNs, bank numbers). */
  identifiers?: string[];
}

/** Print-and-mail instructions. Never contains SSNs or account numbers. */
export function mailingMarkdown(c: MailContext): string {
  const row = mailingAddress(c.state);
  const due = `${c.taxYear + 1}-04-15`;
  const late = c.now.toISOString().slice(0, 10) > due;
  const out: string[] = [];
  out.push(`# Mailing your ${c.taxYear} federal return`, '');
  out.push('## 1. Print, write in your SSNs, and sign', '');
  out.push(
    `- Print \`${c.taxYear}-federal-return.pdf\` single-sided.`,
    '- 1040kit never stores Social Security numbers or bank account numbers, so those boxes are blank. Write them in by hand, in ink:',
    ...(c.identifiers ?? []).map((h) => `  - ${h}`),
    '- Check every page against the summary before you sign.',
    `- Sign and date page 2 of Form 1040${c.mfj ? '. Your spouse signs too (joint return)' : ''}. Add your occupation and phone number if they are blank.`,
    ''
  );
  out.push('## 2. Assemble', '');
  out.push(
    '- Form 1040 on top, then the schedules and forms in the order of the "Attachment Sequence No." printed at the top right of each:',
    ...(c.attachments ?? []).map(
      (a, i) =>
        `  ${i + 1}. ${a.title}${a.sequence ? ` (sequence no. ${a.sequence})` : ''}`
    ),
    c.w2Count > 0
      ? `- Attach Copy B of ${c.w2Count === 1 ? 'your W-2' : `each of your ${c.w2Count} W-2s`} to the front of page 1, where the form says "Attach Form(s) W-2 here". Keep your 1099s with your records.`
      : '- No W-2s to attach. Keep your 1099s with your records.',
    ''
  );
  out.push('## 3. Mail it', '');
  if (!row) {
    out.push(
      `1040kit has no address for "${c.state}". Look it up on the IRS page: ${WHERE_TO_FILE_CITATION.url}`,
      ''
    );
  } else if (c.refundOrOwed >= 0) {
    out.push(
      `You are due a refund of ${usd(c.refundOrOwed)}. Living in ${row.name}, mail it to:`,
      '',
      '```',
      row.noPayment,
      '```',
      ''
    );
  } else {
    out.push(
      `You owe ${usd(c.refundOrOwed)}.`,
      '',
      '- **If you pay online** (IRS Direct Pay at https://www.irs.gov/payments, EFTPS, or a debit/credit card), mail the return **without** a payment to:',
      '',
      '```',
      row.noPayment,
      '```',
      '',
      `- **If you enclose a check or money order** payable to "United States Treasury" (write your name, address, daytime phone, "${c.taxYear} Form 1040" and your SSN on it yourself, and include Form 1040-V), mail to:`,
      '',
      '```',
      row.withPayment,
      '```',
      ''
    );
  }
  out.push(
    `Source: IRS, "Where to file paper tax returns with or without a payment" (${WHERE_TO_FILE_CITATION.url}). Check it before mailing; the IRS changes these addresses.`,
    '',
    'Use certified mail with return receipt if you want proof of the mailing date.',
    ''
  );
  out.push('## 4. Deadline', '');
  out.push(
    late
      ? `The usual due date (April 15, ${c.taxYear + 1}) has passed. File as soon as you can: if you owe, penalties and interest grow each month; if you are due a refund, there is no late-filing penalty, but claim it within 3 years.`
      : `File by April 15, ${c.taxYear + 1} (the next business day if it falls on a weekend or holiday). An extension (Form 4868) extends the time to file, not to pay.`,
    ''
  );
  out.push('## 5. Afterwards', '');
  out.push(
    '- Keep a copy of the signed return and all documents for at least 3 years.',
    '- Track your refund at https://www.irs.gov/refunds (paper returns take several weeks).',
    '- Once you have written them in, the printed return contains your SSN. Store it safely.',
    ''
  );
  return out.join('\n');
}
