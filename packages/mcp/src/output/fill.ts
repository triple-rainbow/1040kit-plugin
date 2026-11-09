/**
 * Fill the official IRS PDFs from the last complete computation.
 *
 * 1040kit never stores SSNs, ITINs or bank account numbers: every such box is
 * left blank and listed in `handwrite` (see identifiers.ts). The output PDF
 * holds no SSNs, so it is not encrypted.
 */
import { readFile } from 'node:fs/promises';
import {
  classifyDependent,
  ownedOnReturn,
  getParams,
  type Dependent,
  type DependentCredit,
  type FormId,
  type PersonId,
  type ReturnResult,
  type TaxFacts,
} from '@1040kit/engine';
import {
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
  StandardFonts,
  type PDFField,
  type PDFForm,
} from 'pdf-lib';

import { FORM_ORDER } from '../calc.ts';
import type { StoreData } from '../store/types.ts';
import {
  assetPath,
  FORM_TITLES,
  loadFieldMap,
  normLine,
  PDF_FOR_FORM,
  type FieldMap,
} from './field-maps.ts';
import {
  eicChildren,
  handwriteText,
  identifierBoxes,
  rentalColumns,
} from './identifiers.ts';

export interface FilledForm {
  formId: FormId;
  pdf: string;
  /** Filled but not flattened (fields readable). */
  bytes: Uint8Array;
}

export interface FillOutput {
  forms: FilledForm[];
  /** All forms, flattened and merged in filing order. */
  merged: Uint8Array;
  /** Things the user must write in by hand. */
  handwrite: string[];
  /** Engine lines with no field in our map (reported, never dropped silently). */
  unmapped: { form: FormId; line: string; value: number }[];
}

const money = (v: number) =>
  v < 0 ? `-${Math.abs(v).toLocaleString('en-US')}` : v.toLocaleString('en-US');

class Filler {
  private readonly byName = new Map<string, PDFField>();
  constructor(
    readonly form: PDFForm,
    readonly title: string
  ) {
    for (const f of form.getFields()) this.byName.set(f.getName(), f);
  }

  /** Resolve a map entry (a full-name suffix) to exactly one field. */
  field(short: string): PDFField {
    const exact = this.byName.get(short);
    if (exact) return exact;
    const hits = [...this.byName.keys()].filter((n) => n.endsWith('.' + short));
    if (hits.length !== 1) {
      throw new Error(
        `${this.title}: field "${short}" matches ${hits.length} fields`
      );
    }
    return this.byName.get(hits[0]!)!;
  }

  text(short: string, value: string | undefined): void {
    if (value === undefined || value === '') return;
    const f = this.field(short);
    if (!(f instanceof PDFTextField))
      throw new Error(`${this.title}: ${short} is not a text field`);
    const max = f.getMaxLength();
    let v = value;
    if (max !== undefined && v.length > max)
      v = v.replace(/[^0-9A-Za-z]/g, '').slice(0, max);
    f.setText(v);
  }

  check(short: string, on = true): void {
    if (!on) return;
    const f = this.field(short);
    if (!(f instanceof PDFCheckBox))
      throw new Error(`${this.title}: ${short} is not a checkbox`);
    f.check();
    // IRS on-state appearances render blank once flattened; draw pdf-lib's own check mark.
    f.defaultUpdateAppearances();
  }
}

function fullName(
  data: StoreData,
  who: PersonId | 'dependent',
  depId?: string
): string | undefined {
  const n =
    who === 'dependent'
      ? data.identity.dependents?.[depId!]
      : data.identity[who];
  const s = [n?.firstName, n?.lastName].filter(Boolean).join(' ');
  return s || undefined;
}

function returnName(data: StoreData): string | undefined {
  const t = fullName(data, 'taxpayer');
  if (data.facts.filingStatus !== 'mfj') return t;
  const s = fullName(data, 'spouse');
  const tl = data.identity.taxpayer?.lastName;
  const sl = data.identity.spouse?.lastName;
  if (t && s && tl && tl === sl)
    return `${data.identity.taxpayer?.firstName} & ${data.identity.spouse?.firstName} ${tl}`;
  return [t, s].filter(Boolean).join(' & ') || undefined;
}

/**
 * Which Form 1040 dependent box to check, from the engine's own
 * classification (the same one Schedule 8812 counts): child tax credit,
 * credit for other dependents, or neither.
 */
export function dependentCreditBox(
  d: Dependent,
  facts: TaxFacts
): DependentCredit {
  return classifyDependent(d, facts, getParams(facts.taxYear)).credit;
}

/** Born before January 2 of (year − 64): 65 or older for the standard-deduction add-on. */
export function senior(dob: string | undefined, year: number): boolean {
  return !!dob && dob < `${year - 64}-01-02`;
}

/**
 * Every amount line one form prints: the engine's lines for that form, lines
 * that repeat a value printed elsewhere (`lineAliases`, e.g. Schedule 2 line
 * 21 = Form 1040 line 23) and the field map's `copies`, without the map's
 * `consumed` lines (printed by their own section). The PDF filler and
 * the Free File entry sheet both use this, so they always agree.
 */
export function formLineValues(
  result: ReturnResult,
  formId: FormId,
  map: FieldMap | null = loadFieldMap(result.taxYear, PDF_FOR_FORM[formId])
): Map<string, { value: number; label: string; printed: string }> {
  const values = new Map<
    string,
    { value: number; label: string; printed: string }
  >();
  for (const n of Object.values(result.nodes)) {
    if (n.form !== formId || !n.line) continue;
    values.set(normLine(n.line), {
      value: n.value,
      label: n.label,
      printed: n.line,
    });
  }
  const params = getParams(result.taxYear);
  for (const [where, nodeId] of Object.entries(params.lineAliases)) {
    const at = where.lastIndexOf(':');
    if (where.slice(0, at) !== formId) continue;
    const printed = where.slice(at + 1);
    const line = normLine(printed);
    const node = result.nodes[nodeId];
    if (node && !values.has(line))
      values.set(line, {
        value: node.value,
        // The node describes the line it computes; an alias may need its own words.
        label:
          params.lineAliasLabels[`${formId.split('.')[0]}:${printed}`] ??
          node.label,
        printed,
      });
  }
  for (const [target, sources] of Object.entries(map?.copies ?? {})) {
    if (values.has(target)) continue;
    const src = sources.find((s) => values.has(s));
    if (src) values.set(target, { ...values.get(src)!, printed: target });
  }
  // Lines the form prints in its own section (Schedule E 1a, 1b and 2:
  // address, property type, days), not as an amount on its line.
  for (const base of map?.consumed ?? []) {
    for (const line of [...values.keys()])
      if (line.split(/[:.]/)[0] === base) values.delete(line);
  }
  return values;
}

export async function fillReturn(
  data: StoreData,
  result: ReturnResult
): Promise<FillOutput> {
  const year = result.taxYear;
  // Identifier boxes first: the user's to-do list starts with the SSNs.
  const handwrite: string[] = identifierBoxes(data, result).map(handwriteText);
  const unmapped: FillOutput['unmapped'] = [];

  const forms = FORM_ORDER.filter((f) => result.forms.includes(f));
  const filled: FilledForm[] = [];
  const merged = await PDFDocument.create();
  const seenHandwrite = new Set<string>();

  for (const formId of forms) {
    const pdf = PDF_FOR_FORM[formId];
    const map = loadFieldMap(year, pdf);
    if (!map) throw new Error(`No field map for ${pdf} (${year})`);
    const doc = await PDFDocument.load(await readFile(assetPath(year, pdf)));
    const form = doc.getForm();
    const f = new Filler(form, FORM_TITLES[formId]);
    const owner: PersonId = formId.endsWith('.spouse') ? 'spouse' : 'taxpayer';

    const values = new Map(
      [...formLineValues(result, formId, map)].map(([l, v]) => [l, v.value])
    );
    for (const [line, value] of values) {
      if (value === 0) continue;
      const field = map.lines[line];
      if (!field) {
        unmapped.push({ form: formId, line, value });
        continue;
      }
      f.text(field, money(value));
    }

    // Header (schedules): name of the return, or of the owner for C/SE/8829.
    // The SSN box is left blank: the user writes it (see `handwrite`).
    if (map.header) {
      const isOwnerForm = /^(schC|schSE|f8829)\./.test(formId);
      f.text(
        map.header.name,
        isOwnerForm ? fullName(data, owner) : returnName(data)
      );
    }

    if (formId === 'f1040') fill1040(f, map, data, result, handwrite, year);
    if (formId === 'schB') fillSchB(f, map, data, handwrite);
    if (formId.startsWith('schC'))
      fillSchC(f, map, data, owner, values, handwrite);
    if (formId === 'f8995') fill8995(f, map, data, result);
    if (formId === 'sch8812') fill8812(f, map, result);
    if (formId === 'schE') fillSchE(f, map, data, values, handwrite, year);
    if (formId === 'schEIC')
      fillSchEIC(f, map, data, result, values, handwrite, year);
    if (formId.startsWith('f8829')) fill8829(f, map, data, owner, values);

    const helv = await doc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(helv);
    filled.push({ formId, pdf, bytes: await doc.save() });
    form.flatten();
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  const uniq = handwrite.filter(
    (h) => !seenHandwrite.has(h) && seenHandwrite.add(h)
  );
  merged.setTitle(`${year} federal income tax return`);
  merged.setProducer('1040kit');
  return {
    forms: filled,
    merged: await merged.save(),
    handwrite: uniq,
    unmapped,
  };
}

/** Every field named in a year's maps resolves to exactly one field of the right type. */
export async function validateMaps(
  year: ReturnResult['taxYear']
): Promise<string[]> {
  const errors: string[] = [];
  for (const pdf of new Set(Object.values(PDF_FOR_FORM))) {
    const map = loadFieldMap(year, pdf);
    if (!map) {
      errors.push(`${pdf}: no map`);
      continue;
    }
    const doc = await PDFDocument.load(await readFile(assetPath(year, pdf)));
    const f = new Filler(doc.getForm(), pdf);
    const texts = [
      ...Object.values(map.lines),
      ...Object.values(map.labels ?? {}),
      ...(map.header ? [map.header.name, map.header.ssn] : []),
      ...(map.interestRows ?? []).flat(),
      ...(map.dividendRows ?? []).flat(),
      ...(map.businessRows ?? []).flatMap((r) => [r.name, r.tin]),
      ...(map.rentalRows ?? []).flatMap((r) => Object.values(r)),
      ...(map.childRows ?? []).flatMap((r) => [
        r.name,
        r.ssn,
        ...r.year,
        r.relationship,
        r.months,
      ]),
    ];
    const boxes: string[] = (map.childRows ?? []).flatMap((r) => [
      r.studentYes,
      r.studentNo,
      r.disabledYes,
      r.disabledNo,
    ]);
    for (const [k, v] of Object.entries(map.fields ?? {})) {
      (/^(box\.|status|digitalAssets|line7|line12|line19|line20|dependentClaimable|senior|blind|foreign|q1099)/.test(
        k
      )
        ? boxes
        : texts
      ).push(v);
    }
    for (const row of map.dependents ?? []) {
      for (const [k, v] of Object.entries(row)) {
        (['firstName', 'lastName', 'ssn', 'relationship'].includes(k)
          ? texts
          : boxes
        ).push(v);
      }
    }
    for (const t of texts) {
      try {
        if (!(f.field(t) instanceof PDFTextField))
          errors.push(`${pdf}: ${t} is not a text field`);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    for (const b of boxes) {
      try {
        if (!(f.field(b) instanceof PDFCheckBox))
          errors.push(`${pdf}: ${b} is not a checkbox`);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  return errors;
}

function fill1040(
  f: Filler,
  map: FieldMap,
  data: StoreData,
  result: ReturnResult,
  handwrite: string[],
  year: number
): void {
  const F = map.fields!;
  const id = data.identity;
  const facts = data.facts;
  f.text(F['taxpayer.firstName']!, id.taxpayer?.firstName);
  f.text(F['taxpayer.lastName']!, id.taxpayer?.lastName);
  if (facts.filingStatus === 'mfj') {
    f.text(F['spouse.firstName']!, id.spouse?.firstName);
    f.text(F['spouse.lastName']!, id.spouse?.lastName);
  }
  if (!id.taxpayer?.lastName) handwrite.push('Your name');
  const a = id.address;
  if (!a?.street) handwrite.push('Your home address');
  f.text(F['address.street']!, a?.street);
  f.text(F['address.apt']!, a?.apt);
  f.text(F['address.city']!, a?.city);
  f.text(F['address.state']!, a?.state ?? facts.stateOfResidence);
  f.text(F['address.zip']!, a?.zip);
  if (facts.filingStatus) f.check(F[`status.${facts.filingStatus}`]!);
  if (facts.digitalAssetActivity === true) f.check(F['digitalAssets.yes']!);
  if (facts.digitalAssetActivity === false) f.check(F['digitalAssets.no']!);
  const line7 = Object.values(result.nodes).find(
    (n) => n.form === 'f1040' && /^7a?$/.test(normLine(n.line ?? ''))
  );
  if (line7 && line7.value !== 0) f.check(F['line7.noScheduleD']!);
  f.check(
    F['dependentClaimable.you']!,
    facts.taxpayer.canBeClaimedAsDependent === true
  );
  f.check(F['senior.you']!, senior(facts.taxpayer.dateOfBirth, year));
  f.check(F['blind.you']!, facts.taxpayer.blind === true);
  if (facts.filingStatus === 'mfj' && facts.spouse) {
    f.check(
      F['dependentClaimable.spouse']!,
      facts.spouse.canBeClaimedAsDependent === true
    );
    f.check(F['senior.spouse']!, senior(facts.spouse.dateOfBirth, year));
    f.check(F['blind.spouse']!, facts.spouse.blind === true);
    f.text(F['spouse.occupation']!, id.spouse?.occupation);
  }
  f.text(F['taxpayer.occupation']!, id.taxpayer?.occupation);
  f.text(F['phone']!, id.phone);

  const rows = map.dependents ?? [];
  const has8812 = result.forms.includes('sch8812');
  facts.dependents.forEach((d, i) => {
    const row = rows[i];
    if (!row) {
      if (i === rows.length)
        handwrite.push(
          'Dependents beyond the fourth: check the box and attach a statement (see the 1040 instructions)'
        );
      return;
    }
    const n = id.dependents?.[d.id];
    f.text(row.firstName!, n?.firstName);
    f.text(row.lastName!, n?.lastName);
    if (!n?.firstName) handwrite.push(`Name of ${d.id}`);
    f.text(
      row.relationship!,
      d.relationship ? RELATIONSHIP[d.relationship] : undefined
    );
    f.check(row.livedWith!, (d.monthsLivedWithTaxpayer ?? 0) > 6);
    f.check(row.student!, d.fullTimeStudent === true);
    f.check(row.disabled!, d.permanentlyDisabled === true);
    if (has8812) {
      const credit = dependentCreditBox(d, facts);
      if (credit !== 'none') f.check(credit === 'ctc' ? row.ctc! : row.odc!);
    }
  });
}

function fillSchB(
  f: Filler,
  map: FieldMap,
  data: StoreData,
  handwrite: string[]
): void {
  const all = schBRows(data);
  const rows = (
    part: 'interest' | 'dividend',
    slots: [string, string][] | undefined
  ) =>
    all
      .filter((r) => r.part === part)
      .forEach((r, i) => {
        const slot = slots?.[i];
        if (!slot) {
          if (i === slots?.length)
            handwrite.push(
              `Schedule B: more ${part} payers than lines; attach a statement`
            );
          return;
        }
        f.text(slot[0], r.name);
        f.text(slot[1], money(r.amount));
      });
  rows('interest', map.interestRows);
  rows('dividend', map.dividendRows);
  if (data.facts.outOfScope?.foreignIncomeOrAccounts === false) {
    f.check(map.fields!['foreignAccounts.no']!);
    f.check(map.fields!['foreignTrust.no']!);
  } else {
    handwrite.push(
      'Schedule B Part III (foreign accounts and trusts): answer lines 7a and 8'
    );
  }
}

/** Schedule C Part V: the one description 1040kit writes for other expenses. */
export const OTHER_EXPENSE_DESCRIPTION =
  'Software, subscriptions and other business expenses';

/** Schedule B Part I and II rows: payer name and whole-dollar amount, in order. */
export function schBRows(
  data: StoreData
): { part: 'interest' | 'dividend'; name: string; amount: number }[] {
  const rows = (
    part: 'interest' | 'dividend',
    list: { id: string; amount: number }[]
  ) =>
    list
      .filter((x) => x.amount > 0)
      .map((x) => ({
        part,
        name: data.labels[x.id] ?? 'Payer (see Form 1099)',
        amount: Math.round(x.amount / 100),
      }));
  return [
    ...rows(
      'interest',
      ownedOnReturn(data.facts, data.facts.int1099s).map((x) => ({
        id: x.id,
        amount: x.interest,
      }))
    ),
    ...rows(
      'dividend',
      // A spouse's 1099s are left off a non-joint return.
      ownedOnReturn(data.facts, data.facts.div1099s).map((x) => ({
        id: x.id,
        amount: x.ordinaryDividends,
      }))
    ),
  ];
}

/** One Schedule C entry: the field-map key, its text (none for a box) and how the entry sheet says it. */
export interface SchCEntry {
  field: string;
  text?: string;
  sheet: string;
}

/**
 * Every non-amount Schedule C entry, for the PDF filler and the Free File
 * entry sheet alike: header items A-J, line 30, line 32, Part IV and Part V.
 * `handwrite` lists what the user still has to write in.
 */
export function scheduleCEntries(
  data: StoreData,
  owner: PersonId,
  values: Map<string, number>
): { entries: SchCEntry[]; handwrite: string[] } {
  const biz = data.facts.businesses.find((b) => b.owner === owner);
  const entries: SchCEntry[] = [];
  const handwrite: string[] = [];
  if (!biz) return { entries, handwrite };
  const text = (
    field: string,
    value: string | undefined,
    sheet: string,
    sheetText = `${sheet}: ${value}`
  ) => {
    if (value) entries.push({ field, text: value, sheet: sheetText });
  };
  const sqft = (n: number) => `${n.toLocaleString('en-US')} square feet`;
  const box = (field: string, sheet: string) =>
    entries.push({ field, sheet: `${sheet}: check the box` });
  const yesNo = (key: string, v: boolean | undefined, sheet: string) => {
    if (v !== undefined)
      entries.push({
        field: `box.${key}.${v ? 'yes' : 'no'}`,
        sheet: `${sheet}: check **${v ? 'Yes' : 'No'}**`,
      });
  };
  text(
    'principalBusiness',
    data.identity[owner]?.occupation ?? biz.name,
    'Line A, principal business or profession'
  );
  text('businessCode', biz.principalBusinessCode, 'Line B, business code');
  text('businessName', biz.name, 'Line C, business name');
  // Backstop: a return computed before these were asked must not leave
  // them blank without saying so.
  const missing: [unknown, string][] = [
    [biz.principalBusinessCode, 'line B: write the 6-digit business code'],
    [biz.accountingMethod, 'line F: check the accounting method'],
    [
      biz.materiallyParticipated,
      'line G: check Yes or No for material participation',
    ],
    [
      biz.madePaymentsRequiring1099,
      'line I: check Yes or No for payments that require Form(s) 1099',
    ],
  ];
  for (const [v, what] of missing)
    if (v === undefined) handwrite.push(`Schedule C, ${what}.`);
  if (biz.operatedFromHome === false) {
    const a = data.identity.businesses?.[owner]?.address;
    if (a?.street || a?.cityStateZip) {
      text('businessAddress.street', a.street, 'Line E, business address');
      text(
        'businessAddress.cityStateZip',
        a.cityStateZip,
        'Line E, city, state and ZIP'
      );
    } else
      handwrite.push(
        'Schedule C, line E: write the business’s street address, city, state and ZIP code.'
      );
  }
  if (biz.accountingMethod) {
    const label = { cash: 'Cash', accrual: 'Accrual', other: 'Other' }[
      biz.accountingMethod
    ];
    const other =
      biz.accountingMethod === 'other' && biz.accountingMethodOther
        ? `, specify "${biz.accountingMethodOther}"`
        : '';
    entries.push({
      field: `box.accounting.${biz.accountingMethod}`,
      sheet: `Line F, accounting method: check **${label}**${other}`,
    });
    // The "specify" text is part of the line F entry on the sheet.
    if (biz.accountingMethod === 'other' && biz.accountingMethodOther)
      entries.push({
        field: 'accountingOther',
        text: biz.accountingMethodOther,
        sheet: '',
      });
  }
  yesNo(
    'materiallyParticipated',
    biz.materiallyParticipated,
    'Line G, materially participated'
  );
  if (biz.startedOrAcquiredThisYear)
    box(
      'box.startedOrAcquired',
      'Line H, started or acquired this business this year'
    );
  yesNo(
    'payments1099',
    biz.madePaymentsRequiring1099,
    'Line I, payments that require Form(s) 1099'
  );
  if (biz.madePaymentsRequiring1099)
    yesNo(
      'filed1099',
      biz.filedRequired1099s,
      'Line J, filed the required Form(s) 1099'
    );
  if (biz.homeOffice?.method === 'simplified') {
    const { squareFeet, homeSquareFeet } = biz.homeOffice;
    if (homeSquareFeet !== undefined)
      text(
        'homeOffice.homeSqFt',
        String(homeSquareFeet),
        'Line 30(a)',
        `Line 30(a), simplified method: total area of your home ${sqft(homeSquareFeet)}`
      );
    text(
      'homeOffice.businessSqFt',
      String(squareFeet),
      'Line 30(b)',
      `Line 30(b), simplified method: part of your home used for business ${sqft(squareFeet)}`
    );
  }
  // Line 32: only with a loss on line 31.
  if ((values.get('31') ?? 0) < 0 && biz.allInvestmentAtRisk === true)
    box('box.atRisk.all', 'Line 32a, all investment is at risk');
  // Part IV: with car or truck expenses on line 9.
  if ((values.get('9') ?? 0) > 0) {
    const v = biz.vehicleUse ?? {};
    const d = v.placedInService?.split('-');
    if (d?.length === 3) {
      // Three boxes on the PDF; one line on the entry sheet.
      text(
        'vehicle.placedInService.month',
        d[1],
        'Line 43',
        `Line 43, date placed in service: ${d[1]}/${d[2]}/${d[0]}`
      );
      text('vehicle.placedInService.day', d[2], 'Line 43', '');
      text('vehicle.placedInService.year', d[0], 'Line 43', '');
    }
    const miles = biz.vehicle?.businessMiles ?? v.businessMiles;
    const n = (x: number | undefined) =>
      x === undefined ? undefined : x.toLocaleString('en-US');
    text('vehicle.businessMiles', n(miles), 'Line 44a, business miles');
    text(
      'vehicle.commutingMiles',
      n(v.commutingMiles),
      'Line 44b, commuting miles'
    );
    text('vehicle.otherMiles', n(v.otherMiles), 'Line 44c, other miles');
    yesNo(
      'vehicle45',
      v.availableOffDuty,
      'Line 45, available for personal use off duty'
    );
    yesNo(
      'vehicle46',
      v.anotherVehicle,
      'Line 46, another vehicle for personal use'
    );
    yesNo(
      'vehicle47a',
      v.hasEvidence,
      'Line 47a, evidence to support the deduction'
    );
    if (v.hasEvidence)
      yesNo(
        'vehicle47b',
        v.evidenceWritten,
        'Line 47b, the evidence is written'
      );
  }
  const other = values.get('48') ?? values.get('27b');
  if (other) {
    entries.push({
      field: 'otherExpense1.name',
      text: OTHER_EXPENSE_DESCRIPTION,
      sheet: `Part V, other expenses: description "${OTHER_EXPENSE_DESCRIPTION}"`,
    });
  }
  return { entries, handwrite };
}

function fillSchC(
  f: Filler,
  map: FieldMap,
  data: StoreData,
  owner: PersonId,
  values: Map<string, number>,
  handwrite: string[]
): void {
  const F = map.fields!;
  const { entries, handwrite: write } = scheduleCEntries(data, owner, values);
  for (const e of entries) {
    if (e.text === undefined) f.check(F[e.field]!);
    else f.text(F[e.field]!, e.text);
  }
  const other = values.get('48') ?? values.get('27b');
  if (other) f.text(F['otherExpense1.amount']!, money(other));
  handwrite.push(...write);
}

/** Schedule 8812 Yes/No answers on lines 12, 19 and 20 (read from the engine's lines). */
export function sch8812Answers(
  result: ReturnResult
): { line: string; yes: boolean }[] {
  const v = (id: string) => result.nodes[id]?.value ?? 0;
  const out = [{ line: '12', yes: v('ctcOdcAfterPhaseout') > 0 }];
  // Part II-A is reached only when line 17 is more than zero.
  if (v('actc.limit') > 0) {
    out.push({ line: '19', yes: v('actc.earnedOverThreshold') > 0 });
    out.push({
      line: '20',
      yes: v('actc.childLimit') >= getParams(result.taxYear).ctc.partIIBMinimum,
    });
  }
  return out;
}

function fill8812(f: Filler, map: FieldMap, result: ReturnResult): void {
  const F = map.fields ?? {};
  for (const a of sch8812Answers(result))
    f.check(F[`line${a.line}.${a.yes ? 'yes' : 'no'}`]!);
}

function fill8995(
  f: Filler,
  map: FieldMap,
  data: StoreData,
  result: ReturnResult
): void {
  const slots = map.businessRows ?? [];
  // Same rows, in the same order, as the engine's line 1 column (c) values.
  const onReturn = (['taxpayer', 'spouse'] as const).flatMap((o) =>
    result.forms.includes(`schC.${o}`)
      ? data.facts.businesses.filter((b) => b.owner === o).slice(0, 1)
      : []
  );
  onReturn.forEach((b, i) => {
    const s = slots[i];
    if (!s) return;
    f.text(
      s.name,
      b.name ?? `Schedule C (${b.owner === 'taxpayer' ? 'you' : 'spouse'})`
    );
    // s.tin (SSN or EIN) is left for the user.
  });
}

/** How the 1040 and Schedule EIC print each relationship (the entry sheet uses the same words). */
export const RELATIONSHIP: Record<string, string> = {
  child: 'child',
  stepchild: 'stepchild',
  foster_child: 'foster child',
  sibling: 'sibling',
  half_sibling: 'half sibling',
  step_sibling: 'step sibling',
  grandchild: 'grandchild',
  niece_nephew: 'niece/nephew',
  parent: 'parent',
  other: 'other',
};

function fillSchE(
  f: Filler,
  map: FieldMap,
  data: StoreData,
  values: Map<string, number>,
  handwrite: string[],
  year: number
): void {
  const rows = map.rentalRows ?? [];
  for (const [i, { rental, column }] of rentalColumns(data).entries()) {
    const row = rows[i];
    if (!row) continue;
    const a = data.identity.rentals?.[rental.id]?.address;
    const addr = [
      a?.street,
      a?.city,
      [a?.state, a?.zip].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', ');
    if (addr) f.text(row.address, addr);
    else
      handwrite.push(
        `Schedule E, line 1a, property ${column}: write the property’s street address, city, state and ZIP code.`
      );
    if (rental.propertyType) f.text(row.type, String(rental.propertyType));
    if (rental.propertyType === 8)
      handwrite.push(
        `Schedule E, line 1b, "8 Other (describe)": describe property ${column}.`
      );
    if (rental.fairRentalDays !== undefined && rental.propertyType !== 6)
      f.text(row.fairRentalDays, String(rental.fairRentalDays));
    if (rental.personalUseDays !== undefined && rental.propertyType !== 6)
      f.text(row.personalUseDays, String(rental.personalUseDays));
  }
  if ([...values.keys()].some((k) => k.startsWith('19:')))
    f.text(map.labels!['19']!, 'Other rental expenses');
  handwrite.push(
    `Schedule E, lines A and B (top of page 1): check whether you made any payments in ${year} that required you to file Form(s) 1099, and if so whether you filed them.`
  );
}

function fillSchEIC(
  f: Filler,
  map: FieldMap,
  data: StoreData,
  result: ReturnResult,
  values: Map<string, number>,
  handwrite: string[],
  year: number
): void {
  const rows = map.childRows ?? [];
  const tpDob = data.facts.taxpayer.dateOfBirth;
  const spDob =
    data.facts.filingStatus === 'mfj'
      ? data.facts.spouse?.dateOfBirth
      : undefined;
  eicChildren(data, result).forEach((d, i) => {
    const row = rows[i];
    if (!row) return;
    const n = data.identity.dependents?.[d.id];
    const name = [n?.firstName, n?.lastName].filter(Boolean).join(' ');
    if (name) f.text(row.name, name);
    else
      handwrite.push(
        `Schedule EIC, line 1, Child ${i + 1}: write the child’s name.`
      );
    const by = d.dateOfBirth?.slice(0, 4);
    if (by) by.split('').forEach((c, k) => f.text(row.year[k]!, c));
    else
      handwrite.push(
        `Schedule EIC, line 3, Child ${i + 1}: write the child’s year of birth.`
      );
    // Lines 4a/4b only when born before (year − 18) or not younger than you.
    const younger =
      !!d.dateOfBirth &&
      (!tpDob || d.dateOfBirth > tpDob) &&
      (!spDob || d.dateOfBirth > spDob);
    const needs4 = !!by && (Number(by) <= year - 19 || !younger);
    if (needs4) {
      const age = year - Number(by);
      const student = age < 24 && d.fullTimeStudent === true && younger;
      f.check(student ? row.studentYes : row.studentNo);
      if (!student)
        f.check(
          d.permanentlyDisabled === true ? row.disabledYes : row.disabledNo
        );
    }
    if (d.relationship) f.text(row.relationship, RELATIONSHIP[d.relationship]!);
    else
      handwrite.push(
        `Schedule EIC, line 5, Child ${i + 1}: write the child’s relationship to you.`
      );
    const months = values.get(`6:${i + 1}`) ?? d.monthsLivedWithTaxpayer;
    if (months !== undefined) f.text(row.months, String(Math.min(12, months)));
  });
}

function fill8829(
  f: Filler,
  map: FieldMap,
  data: StoreData,
  owner: PersonId,
  values: Map<string, number>
): void {
  const ho = data.facts.businesses.find((b) => b.owner === owner)?.homeOffice;
  if (ho?.method !== 'actual') return;
  if (!values.has('1'))
    f.text(map.lines['1']!, ho.officeSquareFeet.toLocaleString('en-US'));
  if (!values.has('2'))
    f.text(map.lines['2']!, ho.homeSquareFeet.toLocaleString('en-US'));
}
