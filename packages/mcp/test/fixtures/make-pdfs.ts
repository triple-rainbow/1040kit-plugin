/**
 * Synthetic tax documents, generated at test time with pdf-lib.
 * Every identity here is fake: "Pat Example", SSN 123-45-6789 / 987-65-4320,
 * EIN 12-3456789. Never put real documents in fixtures.
 */
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  StandardFonts,
} from 'pdf-lib';

export const FAKE = {
  ssn: '123-45-6789',
  spouseSsn: '987-65-4320',
  ein: '12-3456789',
  ein2: '98-7654321',
  name: 'Pat Example',
} as const;

async function textPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  let y = 760;
  for (const line of lines) {
    page.drawText(line, { x: 40, y, size: 10, font });
    y -= 16;
  }
  return doc.save();
}

export interface W2Opts {
  ssn?: string;
  ein?: string;
  employer?: string;
  employee?: string;
  box1?: string;
  box2?: string;
  box3?: string;
  box4?: string;
  box5?: string;
  box6?: string;
  corrected?: boolean;
  /** Distinguishes otherwise identical files (different sha256). */
  tag?: string;
}

export function w2Lines(o: W2Opts = {}): string[] {
  return [
    o.corrected
      ? 'Form W-2c Corrected Wage and Tax Statement 2025'
      : 'Form W-2 Wage and Tax Statement 2025',
    'Department of the Treasury - Internal Revenue Service',
    `a Employee's social security number ${o.ssn ?? FAKE.ssn}`,
    `b Employer identification number (EIN) ${o.ein ?? FAKE.ein}`,
    `c Employer's name, address, and ZIP code ${o.employer ?? 'Example Widgets LLC'}`,
    `e Employee's first name and initial Last name ${o.employee ?? FAKE.name}`,
    `1 Wages, tips, other compensation ${o.box1 ?? '52,345.67'}`,
    `2 Federal income tax withheld ${o.box2 ?? '6,123.45'}`,
    `3 Social security wages ${o.box3 ?? '52,345.67'}`,
    `4 Social security tax withheld ${o.box4 ?? '3,245.43'}`,
    `5 Medicare wages and tips ${o.box5 ?? '52,345.67'}`,
    `6 Medicare tax withheld ${o.box6 ?? '759.01'}`,
    "Copy B To Be Filed With Employee's FEDERAL Tax Return",
    o.tag ? `ref ${o.tag}` : '',
  ];
}

export const w2Pdf = (o: W2Opts = {}) => textPdf(w2Lines(o));

export function necPdf(
  o: {
    amount?: string;
    withheld?: string;
    ssn?: string;
    ein?: string;
    payer?: string;
    corrected?: boolean;
  } = {}
) {
  return textPdf([
    o.corrected ? 'CORRECTED' : '',
    'Form 1099-NEC Nonemployee Compensation 2025',
    `PAYER'S name ${o.payer ?? 'Acme Clients Inc'}`,
    `PAYER'S TIN ${o.ein ?? FAKE.ein2}`,
    `RECIPIENT'S TIN ${o.ssn ?? FAKE.ssn}`,
    `RECIPIENT'S name ${FAKE.name}`,
    `1 Nonemployee compensation $ ${o.amount ?? '18,250.00'}`,
    `4 Federal income tax withheld $ ${o.withheld ?? '0.00'}`,
    'Copy B For Recipient',
  ]);
}

export function intPdf(o: { interest?: string; account?: string } = {}) {
  return textPdf([
    'Form 1099-INT Interest Income 2025',
    `PAYER'S name Example Savings Bank`,
    `PAYER'S TIN ${FAKE.ein2}`,
    `RECIPIENT'S TIN ${FAKE.ssn}`,
    `Account number (see instructions) ${o.account ?? '0000987654321'}`,
    `1 Interest income $ ${o.interest ?? '1,234.56'}`,
    `4 Federal income tax withheld $ 0.00`,
  ]);
}

export function divPdf(o: { ordinary?: string; qualified?: string } = {}) {
  return textPdf([
    'Form 1099-DIV Dividends and Distributions 2025',
    `PAYER'S name Example Brokerage`,
    `PAYER'S TIN ${FAKE.ein2}`,
    `RECIPIENT'S TIN ${FAKE.ssn}`,
    `1a Total ordinary dividends $ ${o.ordinary ?? '800.00'}`,
    `1b Qualified dividends $ ${o.qualified ?? '600.00'}`,
    `2a Total capital gain distr. $ 50.00`,
    `4 Federal income tax withheld $ 0.00`,
  ]);
}

export function e1098Pdf(
  o: { interest?: string; box2?: boolean; tag?: string } = {}
) {
  return textPdf([
    'Form 1098-E Student Loan Interest Statement 2025',
    "RECIPIENT'S/LENDER'S name, street address, city or town, state, ZIP code, and telephone number",
    'Example Student Loans',
    `RECIPIENT'S TIN ${FAKE.ein2}`,
    `BORROWER'S TIN ${FAKE.ssn}`,
    `BORROWER'S name ${FAKE.name}`,
    'Account number (see instructions) 0000987654321',
    `1 Student loan interest received by lender $ ${o.interest ?? '1,845.00'}`,
    `2 If checked, box 1 does not include loan origination fees and/or capitalized interest made before September 1, 2004 ${o.box2 ? '[X]' : '[ ]'}`,
    'Copy B For Borrower',
    o.tag ? `ref ${o.tag}` : '',
  ]);
}

export function miscPdf(
  o: { rents?: string; royalties?: string; payer?: string } = {}
) {
  return textPdf([
    'Form 1099-MISC Miscellaneous Information 2025',
    `PAYER'S name ${o.payer ?? 'Example Property Management'}`,
    `PAYER'S TIN ${FAKE.ein2}`,
    `RECIPIENT'S TIN ${FAKE.ssn}`,
    `RECIPIENT'S name ${FAKE.name}`,
    `1 Rents $ ${o.rents ?? '14,400.00'}`,
    `2 Royalties $ ${o.royalties ?? '250.75'}`,
    '3 Other income $',
    '4 Federal income tax withheld $ 0.00',
    'Copy B For Recipient',
  ]);
}

export function r1099Pdf() {
  return textPdf([
    'Form 1099-R Distributions From Pensions, Annuities, Retirement or Profit-Sharing Plans, IRAs, Insurance Contracts, etc. 2025',
    `PAYER'S TIN ${FAKE.ein2}`,
    '1 Gross distribution $ 5,000.00',
  ]);
}

export function randomPdf() {
  return textPdf([
    'Grocery list',
    'Milk, eggs, bread, coffee',
    'Pick up dry cleaning on Tuesday',
  ]);
}

/** A page with drawings but no text layer, like a scan. */
export async function imageOnlyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawRectangle({ x: 40, y: 600, width: 300, height: 120 });
  return doc.save();
}

/**
 * A PDF with a standard-security /Encrypt dictionary whose user password is
 * not empty, so readers ask for a password. pdf-lib can't encrypt, so the
 * dictionary is written by hand (the content itself is irrelevant).
 */
export async function encryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const ctx = doc.context;
  const enc = PDFDict.withContext(ctx);
  enc.set(PDFName.of('Filter'), PDFName.of('Standard'));
  enc.set(PDFName.of('V'), PDFNumber.of(1));
  enc.set(PDFName.of('R'), PDFNumber.of(2));
  enc.set(PDFName.of('O'), PDFHexString.of('11'.repeat(32)));
  enc.set(PDFName.of('U'), PDFHexString.of('22'.repeat(32)));
  enc.set(PDFName.of('P'), PDFNumber.of(-4));
  ctx.trailerInfo.Encrypt = ctx.register(enc);
  const id = PDFHexString.of('ab'.repeat(16));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  return doc.save({ useObjectStreams: false });
}
