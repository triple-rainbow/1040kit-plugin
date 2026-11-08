import type { FormId, ReturnResult } from '@1040kit/engine';

import { compareLines, FORM_ORDER } from '../calc.ts';
import type { StoreData } from '../store/types.ts';
import { FORM_TITLES, formName } from './field-maps.ts';
import {
  dependentCreditBox,
  formLineValues,
  OTHER_EXPENSE_DESCRIPTION,
  sch8812Answers,
  schBRows,
  senior,
} from './fill.ts';
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
  // The same values the PDF prints: only forms on this return, with the
  // lines that repeat a value from another form.
  const lines = FORM_ORDER.filter(
    (f) => result.forms.includes(f) && f !== 'schEIC'
  )
    .flatMap((form) =>
      [...formLineValues(result, form).values()].map((v) => ({
        form,
        line: v.printed,
        label: v.label,
        value: v.value,
      }))
    )
    .filter((l) => l.value !== 0)
    .sort(compareLines);
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
  const STATUS: Record<string, string> = {
    single: 'Single',
    mfj: 'Married filing jointly',
    hoh: 'Head of household',
  };
  if (data.facts.filingStatus)
    out.push(
      `- Filing status: check **${STATUS[data.facts.filingStatus] ?? data.facts.filingStatus}**`
    );
  if (data.facts.digitalAssetActivity !== undefined)
    out.push(
      `- Digital assets question: check **${data.facts.digitalAssetActivity ? 'Yes' : 'No'}**`
    );
  // The same boxes the PDF checks (fill1040).
  const f = data.facts;
  const yes = (b: boolean | undefined) => (b ? '**Yes**' : 'No');
  out.push(
    `- Someone can claim you as a dependent: ${yes(f.taxpayer.canBeClaimedAsDependent)}`,
    `- You were born before January 2, ${y - 64}: ${yes(senior(f.taxpayer.dateOfBirth, y))}`,
    `- You are blind: ${yes(f.taxpayer.blind)}`
  );
  if (f.filingStatus === 'mfj' && f.spouse)
    out.push(
      `- Someone can claim your spouse as a dependent: ${yes(f.spouse.canBeClaimedAsDependent)}`,
      `- Spouse was born before January 2, ${y - 64}: ${yes(senior(f.spouse.dateOfBirth, y))}`,
      `- Spouse is blind: ${yes(f.spouse.blind)}`
    );
  const has8812 = result.forms.includes('sch8812');
  f.dependents.forEach((d, i) => {
    const n = id.dependents?.[d.id];
    const credit = has8812 ? dependentCreditBox(d, f) : 'none';
    const boxes = [
      (d.monthsLivedWithTaxpayer ?? 0) > 6
        ? 'check **Lived with you more than half the year**'
        : '',
      d.fullTimeStudent === true ? 'check **Full-time student**' : '',
      d.permanentlyDisabled === true ? 'check **Permanently disabled**' : '',
      credit === 'ctc'
        ? 'check **Child tax credit**'
        : credit === 'odc'
          ? 'check **Credit for other dependents**'
          : '',
    ].filter(Boolean);
    out.push(
      `- Dependent ${i + 1}: ${[n?.firstName, n?.lastName].filter(Boolean).join(' ') || d.id}, ${d.relationship?.replace(/_/g, ' ') ?? ''}, SSN: ${TYPE_YOURSELF}${boxes.length ? '; ' + boxes.join('; ') : ''}`
    );
  });
  if (id.taxpayer?.occupation)
    out.push(`- Your occupation (page 2): ${id.taxpayer.occupation}`);
  if (f.filingStatus === 'mfj' && id.spouse?.occupation)
    out.push(`- Spouse’s occupation (page 2): ${id.spouse.occupation}`);
  if (id.phone) out.push(`- Phone (page 2): ${id.phone}`);
  out.push('');

  // Free File Fillable Forms takes W-2s in "Step 2" (income documents), and
  // their federal withholding must match the 1040 before it will e-file.
  if (f.w2s.length) {
    out.push('## Step 2: your W-2s', '');
    out.push(
      'Free File Fillable Forms asks you to enter each W-2 separately (Step 2), and the withholding must match line 25a before it will e-file. Copy each one from the W-2 itself:',
      ''
    );
    const cents = (c: number | undefined) =>
      c === undefined ? '—' : (c / 100).toFixed(2);
    f.w2s.forEach((w, i) => {
      const who =
        w.owner === 'spouse' && f.filingStatus === 'mfj' ? ' (spouse)' : '';
      out.push(
        `- W-2 ${i + 1}${who}: ${data.labels[w.id] ?? 'the employer named on your W-2'}; employer EIN (box b) ${TYPE_YOURSELF} from the W-2; box 1 ${cents(w.wages)}; box 2 ${cents(w.federalWithheld)}; box 3 ${cents(w.ssWages)}; box 4 ${cents(w.ssTax)}; box 5 ${cents(w.medicareWages)}; box 6 ${cents(w.medicareTax)}` +
          (w.ssTips ? `; box 7 ${cents(w.ssTips)}` : '') +
          (w.allocatedTips ? `; box 8 ${cents(w.allocatedTips)}` : '') +
          (w.box12?.length
            ? `; box 12 ${w.box12.map((b) => `${b.code} ${cents(b.amount)}`).join(', ')}`
            : '') +
          (w.statutoryEmployee ? '; box 13 statutory employee' : '') +
          (w.retirementPlan ? '; box 13 retirement plan' : '')
      );
    });
    out.push('');
  }

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

  const extras = formTextEntries(data, result);
  const forms = FORM_ORDER.filter(
    (f) => result.forms.includes(f) && f !== 'schEIC'
  );
  for (const form of forms) {
    const rows = lines.filter((l) => l.form === form);
    const text = extras.get(form) ?? [];
    if (!rows.length && !text.length) continue;
    out.push(`## ${FORM_TITLES[form]}`, '');
    if (text.length) out.push(...text.map((t) => `- ${t}`), '');
    if (rows.length) {
      out.push('| Form | Line | Description | Enter |', '|---|---|---|---:|');
      for (const l of rows)
        out.push(
          `| ${FORM_TITLES[l.form]} | ${l.line} | ${l.label.replace(/\|/g, '/')} | ${usd(l.value)} |`
        );
      out.push('');
    }
  }
  out.push('');
  out.push(
    'Amounts are whole dollars. Leave every line not listed here blank.',
    ''
  );
  return out.join('\n');
}

/**
 * The non-amount entries each form prints, the same ones fill.ts writes:
 * names, codes, square feet, descriptions and yes/no boxes.
 */
function formTextEntries(
  data: StoreData,
  result: ReturnResult
): Map<FormId, string[]> {
  const out = new Map<FormId, string[]>();
  const add = (form: FormId, text: string) => {
    if (!result.forms.includes(form)) return;
    out.set(form, [...(out.get(form) ?? []), text]);
  };
  for (const owner of ['taxpayer', 'spouse'] as const) {
    const form: FormId = `schC.${owner}`;
    const biz = data.facts.businesses.find((b) => b.owner === owner);
    if (!biz) continue;
    if (biz.name) add(form, `Line C, business name: ${biz.name}`);
    const principal = data.identity[owner]?.occupation ?? biz.name;
    if (principal)
      add(form, `Line A, principal business or profession: ${principal}`);
    if (biz.principalBusinessCode)
      add(form, `Line B, business code: ${biz.principalBusinessCode}`);
    if (biz.homeOffice?.method === 'simplified')
      add(
        form,
        `Line 30, simplified method: business use of your home ${biz.homeOffice.squareFeet.toLocaleString('en-US')} square feet`
      );
    const other = formLineValues(result, form);
    if (other.get('48')?.value || other.get('27b')?.value)
      add(
        form,
        `Part V, other expenses: description "${OTHER_EXPENSE_DESCRIPTION}"`
      );
    if (biz.homeOffice?.method === 'actual') {
      const f8829: FormId = `f8829.${owner}`;
      const lines = formLineValues(result, f8829);
      if (!lines.has('1'))
        add(
          f8829,
          `Line 1, area used for business: ${biz.homeOffice.officeSquareFeet.toLocaleString('en-US')} square feet`
        );
      if (!lines.has('2'))
        add(
          f8829,
          `Line 2, total area of home: ${biz.homeOffice.homeSquareFeet.toLocaleString('en-US')} square feet`
        );
    }
  }
  for (const r of schBRows(data))
    add(
      'schB',
      `Part ${r.part === 'interest' ? 'I, line 1' : 'II, line 5'}: ${r.name} ${r.amount.toLocaleString('en-US')}`
    );
  if (data.facts.outOfScope?.foreignIncomeOrAccounts === false)
    add(
      'schB',
      'Part III, lines 7a and 8 (foreign accounts and trusts): check **No**'
    );
  // Capital gain distributions only: the line 7 box (Schedule D not required).
  const f1040 = formLineValues(result, 'f1040');
  if ((f1040.get('7')?.value || f1040.get('7a')?.value || 0) !== 0)
    add('f1040', 'Line 7: check the box "Schedule D not required"');
  for (const a of sch8812Answers(result))
    add('sch8812', `Line ${a.line}: check **${a.yes ? 'Yes' : 'No'}**`);
  (['taxpayer', 'spouse'] as const)
    .flatMap((o) =>
      result.forms.includes(`schC.${o}`)
        ? data.facts.businesses.filter((b) => b.owner === o).slice(0, 1)
        : []
    )
    .forEach((b, i) =>
      add(
        'f8995',
        `Line 1${['i', 'ii', 'iii'][i] ?? ''}, column (a), trade or business name: ${b.name ?? `Schedule C (${b.owner === 'taxpayer' ? 'you' : 'spouse'})`}`
      )
    );
  return out;
}
