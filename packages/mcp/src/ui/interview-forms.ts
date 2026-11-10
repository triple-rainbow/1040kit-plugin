/**
 * Questions that need the workspace to be asked well, built on top of the
 * engine's open facts (interview-plan.ts):
 *
 * - "household": filing status, each person's name, date of birth,
 *   occupation and a "legally blind" check box, the home address, and on a
 *   joint return who is the main filer. Names read from documents come
 *   filled in to confirm. The forms print all of it.
 * - Expense checklists for each business (Schedule C) and rental (Schedule E).
 * - The rental form ("rentals") and which rental a 1099-MISC belongs to.
 *
 * Presentation only: every field still saves to its own fact path with
 * profile_set, and the engine still decides which facts are needed.
 */
import type { PersonId } from '@1040kit/engine';

import { getPath, isAnswered, parsePath } from '../store/profile.ts';
import type { StoreData } from '../store/types.ts';
import { answerSpec } from './answers.ts';
import type {
  ChecklistAnswer,
  GroupField,
  PlannedQuestion,
} from './interview-plan.ts';

export const HOUSEHOLD_PATH = 'household';

const TAXPAYER_SECTION = 'Main filer';
const SPOUSE_SECTION = 'Spouse';

const identityValue = (data: StoreData, path: string): unknown => {
  const segs = parsePath(path.slice('identity.'.length));
  if (!segs) return undefined;
  // identity.dependents[dependent_1].firstName is stored as dependents.dependent_1.firstName
  return getPath(
    data.identity,
    segs.flatMap((s) => (s.select ? [{ key: s.key }, { key: s.select }] : [s]))
  );
};
const factValue = (data: StoreData, path: string): unknown => {
  const segs = parsePath(path);
  return segs ? getPath(data.facts, segs) : undefined;
};

/**
 * The household form, or nothing when everything on it is answered. Takes
 * the engine questions it covers out of `planned`.
 */
export function householdQuestion(
  planned: PlannedQuestion[],
  data: StoreData
): { question?: PlannedQuestion; rest: PlannedQuestion[] } {
  const engine = new Map(
    planned
      .filter((q) =>
        /^(filingStatus|(taxpayer|spouse)\.(dateOfBirth|blind))$/.test(q.path)
      )
      .map((q) => [q.path, q])
  );
  const status = data.facts.filingStatus;
  const statusOpen = engine.has('filingStatus');
  const joint = status === 'mfj';
  const maybeJoint = statusOpen && !joint;
  const askMainFiler =
    (joint || maybeJoint) && data.answers.mainFiler === undefined;
  const mfjOnly = maybeJoint
    ? { showIf: { path: 'filingStatus', equals: 'mfj' } }
    : {};

  const fields: GroupField[] = [];
  if (statusOpen) {
    const q = engine.get('filingStatus')!;
    fields.push({
      path: q.path,
      label: 'Filing status',
      answer: q.answer as never,
    });
  }
  const person = (p: PersonId, section: string, extra: object) => {
    const out: GroupField[] = [];
    const text = (key: string, label: string, optional = false) => {
      const path = `identity.${p}.${key}`;
      if (!askMainFiler && isAnswered(data, path)) return;
      const value = identityValue(data, path);
      out.push({
        path,
        label,
        answer: { kind: 'text' },
        section,
        ...(value !== undefined && value !== '' ? { value } : {}),
        ...(optional ? { optional: true } : {}),
        ...extra,
      } as GroupField);
    };
    text('firstName', 'First name');
    text('lastName', 'Last name');
    const dob = `${p}.dateOfBirth`;
    const dobOpen =
      engine.has(dob) ||
      (p === 'spouse' && maybeJoint && !data.facts.spouse?.dateOfBirth);
    if (dobOpen || (askMainFiler && factValue(data, dob) !== undefined)) {
      const value = factValue(data, dob);
      out.push({
        path: dob,
        label: 'Date of birth',
        answer: { kind: 'date' },
        section,
        ...(value !== undefined ? { value } : {}),
        // Required only when the engine needs it (e.g. for the earned income credit).
        ...(engine.get(dob)?.blocking ? {} : { optional: true as const }),
        ...extra,
      });
    }
    text('occupation', 'Occupation', true);
    const blind = `${p}.blind`;
    const blindOpen =
      engine.has(blind) ||
      (p === 'spouse' && maybeJoint && data.facts.spouse?.blind === undefined);
    if (blindOpen || (askMainFiler && factValue(data, blind) !== undefined)) {
      const value = factValue(data, blind);
      out.push({
        path: blind,
        label: 'Legally blind',
        answer: { kind: 'check', label: 'Legally blind' },
        section,
        ...(value !== undefined ? { value } : {}),
        ...extra,
      });
    }
    return out;
  };
  fields.push(
    ...person('taxpayer', joint || maybeJoint ? TAXPAYER_SECTION : 'You', {})
  );
  if (joint || maybeJoint) {
    fields.push(...person('spouse', SPOUSE_SECTION, mfjOnly));
    if (askMainFiler)
      fields.push({
        path: 'mainFiler',
        label: 'Switch who is the main filer',
        answer: {
          kind: 'swap',
          label: 'Make the spouse the main filer, listed first on the return',
          sections: [TAXPAYER_SECTION, SPOUSE_SECTION],
        },
        ...mfjOnly,
      });
  }
  const address: [string, string, boolean][] = [
    ['street', 'Street address', false],
    ['apt', 'Apt. no. (if any)', true],
    ['city', 'City', false],
    ['state', 'State (2 letters)', false],
    ['zip', 'ZIP code', false],
  ];
  if (
    address.some(
      ([k, , opt]) => !opt && !isAnswered(data, `identity.address.${k}`)
    )
  )
    for (const [k, label, optional] of address) {
      const path = `identity.address.${k}`;
      if (isAnswered(data, path)) continue;
      const value = identityValue(data, path);
      fields.push({
        path,
        label,
        answer: { kind: 'text' },
        section: 'Home address',
        ...(value !== undefined ? { value } : {}),
        ...(optional ? { optional: true as const } : {}),
      });
    }

  const rest = planned.filter((q) => !engine.has(q.path));
  // Only optional fields left (occupation, blind boxes, the main-filer
  // switch): no form of their own; the engine's own questions stay.
  const needed = fields.filter(
    (f) => !f.optional && f.answer.kind !== 'check' && f.answer.kind !== 'swap'
  );
  if (needed.length === 0) return { rest: planned };
  return {
    question: {
      path: HOUSEHOLD_PATH,
      question: joint || maybeJoint ? 'You and your spouse' : 'About you',
      why:
        joint || maybeJoint
          ? 'Your return prints these. Names read from your documents are filled in: check them. The main filer is listed first; questions that say “you” mean the main filer.'
          : 'Your return prints these. Names read from your documents are filled in: check them.',
      blocking: true,
      priority: 0,
      phase: 'income',
      answer: { kind: 'group', fields },
    },
    rest,
  };
}

const C_EXPENSES: [string, string, string?][] = [
  ['advertising', 'Advertising', 'Ads, a website, business cards'],
  [
    'commissions',
    'Commissions and fees',
    'Platform, payment and referral fees',
  ],
  ['contract_labor', 'Contract labor', 'People you paid who aren’t employees'],
  ['insurance', 'Business insurance', 'Not health insurance'],
  ['interest_other', 'Interest on business loans or credit cards'],
  [
    'legal_professional',
    'Legal and professional services',
    'An accountant or lawyer',
  ],
  ['office', 'Office expense', 'Postage, printer ink, small office items'],
  ['rent_equipment', 'Renting vehicles, machinery or equipment'],
  [
    'rent_property',
    'Renting an office, studio or other space',
    'Not your home office',
  ],
  ['repairs', 'Repairs and maintenance'],
  ['supplies', 'Supplies', 'Materials used up in the work'],
  [
    'taxes_licenses',
    'Taxes and licenses',
    'Business licenses and permits, not income tax',
  ],
  ['travel', 'Business travel', 'Flights, hotels and taxis, not meals'],
  ['meals', 'Business meals', 'The full amount; 1040kit applies the 50% limit'],
  [
    'utilities',
    'Phone, internet and utilities',
    'The business share only, not the home office',
  ],
  ['other', 'Other expenses', 'Software, subscriptions, bank fees, training'],
];

const E_EXPENSES: [string, string, string?][] = [
  ['advertising', 'Advertising'],
  ['auto_travel', 'Auto and travel'],
  ['cleaning_maintenance', 'Cleaning and maintenance'],
  ['commissions', 'Commissions'],
  ['insurance', 'Insurance'],
  ['legal_professional', 'Legal and other professional fees'],
  ['management_fees', 'Management fees'],
  ['mortgage_interest', 'Mortgage interest paid to banks'],
  ['other_interest', 'Other interest'],
  ['repairs', 'Repairs'],
  ['supplies', 'Supplies'],
  ['taxes', 'Property taxes'],
  ['utilities', 'Utilities'],
  ['other', 'Other expenses'],
];

const RECORDS_NOTE =
  'You don’t send receipts with the return. Keep them (receipts, invoices, bank or card statements) for at least 3 years in case the IRS asks.';

function checklist(
  base: string,
  list: [string, string, string?][],
  current: Record<string, number | undefined>,
  note: string
): ChecklistAnswer {
  return {
    kind: 'checklist',
    items: list.map(([cat, label, hint]) => ({
      path: `${base}.expenses.${cat}`,
      label,
      ...(hint ? { hint } : {}),
      ...(current[cat] ? { value: current[cat] } : {}),
    })),
    done: { path: `${base}.expensesReviewed`, value: true },
    noneLabel: 'None of these',
    note,
  };
}

const PROPERTY_TYPES = [
  { value: 1, label: 'Single-family house' },
  { value: 2, label: 'Multi-family building' },
  { value: 3, label: 'Vacation or short-term rental' },
  { value: 4, label: 'Commercial' },
  { value: 5, label: 'Land' },
  { value: 6, label: 'Royalties' },
  { value: 7, label: 'Rented to your own business' },
  { value: 8, label: 'Other' },
];

/** The fields for one new rental property or royalty source. */
export function newRentalFields(id: string, joint: boolean): GroupField[] {
  const notRoyalty = {
    showIf: { path: `rentals[${id}].propertyType`, notEquals: 6 },
  };
  const royalty = {
    showIf: { path: `rentals[${id}].propertyType`, equals: 6 },
  };
  const owner: GroupField = joint
    ? {
        path: `rentals[${id}].owner`,
        label: 'Whose is it',
        answer: answerSpec(`rentals[${id}].owner`),
      }
    : {
        path: `rentals[${id}].owner`,
        label: 'Whose is it',
        answer: { kind: 'text' },
        value: 'taxpayer',
        hidden: true,
      };
  const addr = (k: string, label: string): GroupField => ({
    path: `identity.rentals[${id}].address.${k}`,
    label,
    answer: { kind: 'text' },
    section: 'Address',
  });
  return [
    owner,
    {
      path: `rentals[${id}].propertyType`,
      label: 'Kind of property',
      answer: { kind: 'choice', options: PROPERTY_TYPES },
    },
    addr('street', 'Street (for royalties, what they are from)'),
    addr('city', 'City'),
    addr('state', 'State (2 letters)'),
    addr('zip', 'ZIP code'),
    {
      path: `rentals[${id}].rentsOther`,
      label: 'Rent received that is not on a 1099-MISC',
      answer: { kind: 'amount' },
      optional: true,
      ...notRoyalty,
    } as GroupField,
    {
      path: `rentals[${id}].royaltiesOther`,
      label: 'Royalties received that are not on a 1099-MISC',
      answer: { kind: 'amount' },
      optional: true,
      ...royalty,
    } as GroupField,
    {
      path: `rentals[${id}].fairRentalDays`,
      label: 'Days rented at a fair price',
      answer: { kind: 'number', min: 0, max: 366 },
      ...notRoyalty,
    },
    {
      path: `rentals[${id}].personalUseDays`,
      label: 'Days you, family or friends used it',
      answer: { kind: 'number', min: 0, max: 366 },
      ...notRoyalty,
    },
  ];
}

/** Expense checklists, the rental form and 1099-MISC links, in place of their open questions. */
export function workspaceForms(
  planned: PlannedQuestion[],
  data: StoreData
): PlannedQuestion[] {
  const joint = data.facts.filingStatus === 'mfj';
  const rentals = data.facts.rentals ?? [];
  return planned.map((q) => {
    let m = /^businesses\[(taxpayer|spouse)\]\.expensesReviewed$/.exec(q.path);
    if (m) {
      const b = data.facts.businesses.find((x) => x.owner === m![1]);
      return {
        ...q,
        answer: checklist(
          `businesses[${m[1]}]`,
          C_EXPENSES,
          (b?.expenses ?? {}) as Record<string, number>,
          `${RECORDS_NOTE} Car, home office and equipment are asked separately.`
        ),
      };
    }
    m = /^rentals\[(rental_\d+)\]\.expensesReviewed$/.exec(q.path);
    if (m) {
      const r = rentals.find((x) => x.id === m![1]);
      return {
        ...q,
        answer: checklist(
          `rentals[${m[1]}]`,
          E_EXPENSES,
          (r?.expenses ?? {}) as Record<string, number>,
          `${RECORDS_NOTE} Depreciation isn’t computed yet.`
        ),
      };
    }
    if (q.path === 'rentals') {
      const next = rentals.length + 1;
      return {
        ...q,
        question: 'Your rental property or royalty source',
        answer: {
          kind: 'group',
          fields: newRentalFields(`rental_${next}`, joint),
          addAnother: {
            label: 'Add another property',
            fields: newRentalFields('{id}', joint),
            nextIndex: next + 1,
            idPrefix: 'rental_',
            heading: 'Property',
          },
        },
      };
    }
    m = /^misc1099s\[([^\]]+)\]\.rentalId$/.exec(q.path);
    if (m) {
      return {
        ...q,
        answer: {
          kind: 'choice',
          options: rentals.map((r, i) => ({
            value: r.id,
            label:
              data.identity.rentals?.[r.id]?.address?.street?.trim() ||
              `Property ${i + 1}`,
          })),
        },
      };
    }
    return q;
  });
}
