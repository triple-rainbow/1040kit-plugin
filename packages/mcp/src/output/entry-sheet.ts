import type { ReturnResult } from '@1040kit/engine';

import { printedLines } from '../calc.ts';
import type { StoreData } from '../store/types.ts';
import { FORM_TITLES, formName } from './field-maps.ts';
import {
  eicChildren,
  fullName,
  identifierBoxes,
  rentalColumns,
} from './identifiers.ts';

/** Marks a field the user types: 1040kit never stores SSNs or bank numbers. */
export const TYPE_YOURSELF = '**type this yourself**';

const usd = (v: number) =>
  v < 0 ? `-${Math.abs(v).toLocaleString('en-US')}` : v.toLocaleString('en-US');

/**
 * Line-by-line sheet for IRS Free File Fillable Forms. 1040kit never stores
 * SSNs or bank account numbers: every such field says "type this yourself".
 * Every non-zero printed line appears, in form order.
 */
export function entrySheetMarkdown(
  data: StoreData,
  result: ReturnResult
): string {
  const y = result.taxYear;
  const lines = printedLines(result).filter(
    (l) => l.value !== 0 && l.form !== 'schEIC'
  );
  const out: string[] = [];
  out.push(`# ${y} return — Free File Fillable Forms entry sheet`, '');
  out.push(
    'Free File Fillable Forms is the IRS’s free, no-income-limit way to e-file: electronic versions of the paper forms, with basic math. Open it from irs.gov/freefile ("Free File Fillable Forms"). Creating the account, signing and submitting are steps only you can do.',
    ''
  );
  out.push('## Steps', '');
  out.push(
    '1. Go to https://www.irs.gov/freefile and choose **Free File Fillable Forms**. Create an account (your email and a password you choose).',
    `2. Start Form 1040. Type your name, address and filing status. Every SSN (and bank account number) is marked "${TYPE_YOURSELF}": 1040kit never stores them, so type them from your own records.`,
    '3. Use **Add/View Forms** to add each form listed below, in this order, then type each line exactly as shown.',
    '4. Use **Do the Math** on each form and compare every total with this sheet. If a number differs, stop and ask before filing.',
    '5. Sign electronically: you need last year’s AGI (or last year’s self-select PIN) for identity verification.',
    '6. Submit. Save or print the confirmation and a copy of the return. Check your email for the acceptance or rejection notice.',
    ''
  );
  out.push('## Identity (Form 1040, top of page 1)', '');
  const id = data.identity;
  out.push(
    `- Your name: ${[id.taxpayer?.firstName, id.taxpayer?.lastName].filter(Boolean).join(' ') || '(your name)'}`
  );
  out.push(`- Your SSN: ${TYPE_YOURSELF}`);
  if (data.facts.filingStatus === 'mfj') {
    out.push(
      `- Spouse’s name: ${[id.spouse?.firstName, id.spouse?.lastName].filter(Boolean).join(' ') || '(spouse’s name)'}`
    );
    out.push(`- Spouse’s SSN: ${TYPE_YOURSELF}`);
  }
  if (id.address?.street) {
    out.push(
      `- Address: ${[id.address.street, id.address.apt, id.address.city, id.address.state, id.address.zip].filter(Boolean).join(', ')}`
    );
  }
  data.facts.dependents.forEach((d, i) => {
    const n = id.dependents?.[d.id];
    out.push(
      `- Dependent ${i + 1}: ${[n?.firstName, n?.lastName].filter(Boolean).join(' ') || d.id}, ${d.relationship ?? ''}, SSN: ${TYPE_YOURSELF}`
    );
  });
  out.push('');

  out.push('## Type these yourself', '');
  out.push(
    '1040kit leaves these fields empty. Type each one from your own records (Social Security cards, your bank):',
    ''
  );
  for (const b of identifierBoxes(data, result))
    out.push(`- ${formName(b.form)}, ${b.where}: ${b.what} — ${TYPE_YOURSELF}`);
  out.push('');

  const rentals = rentalColumns(data);
  if (result.forms.includes('schE') && rentals.length) {
    out.push('## Schedule E, lines 1a, 1b and 2', '');
    for (const { rental, column } of rentals) {
      const a = data.identity.rentals?.[rental.id]?.address;
      const addr =
        [a?.street, a?.city, [a?.state, a?.zip].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ') || '(property address)';
      out.push(
        `- Property ${column}: ${addr}; type ${rental.propertyType ?? '(type)'}; fair rental days ${rental.fairRentalDays ?? '—'}; personal use days ${rental.personalUseDays ?? '—'}`
      );
    }
    out.push('');
  }

  const kids = eicChildren(data, result);
  if (kids.length) {
    out.push('## Schedule EIC', '');
    kids.forEach((d, i) => {
      out.push(
        `- Child ${i + 1}: ${fullName(id.dependents?.[d.id]) ?? d.id}; SSN ${TYPE_YOURSELF}; year of birth ${d.dateOfBirth?.slice(0, 4) ?? '—'}; relationship ${d.relationship?.replace('_', ' ') ?? '—'}; months lived with you in the U.S. ${d.monthsLivedWithTaxpayer ?? '—'}; student ${d.fullTimeStudent ? 'yes' : 'no'}; permanently disabled ${d.permanentlyDisabled ? 'yes' : 'no'}`
      );
    });
    out.push('');
  }

  let current = '';
  for (const l of lines) {
    if (l.form !== current) {
      current = l.form;
      out.push(
        `## ${FORM_TITLES[l.form]}`,
        '',
        '| Form | Line | Description | Enter |',
        '|---|---|---|---:|'
      );
    }
    out.push(
      `| ${FORM_TITLES[l.form]} | ${l.line} | ${l.label.replace(/\|/g, '/')} | ${usd(l.value)} |`
    );
  }
  out.push('');
  out.push(
    'Amounts are whole dollars. Leave every line not listed here blank.',
    ''
  );
  return out.join('\n');
}
