/**
 * Every box that takes an SSN, ITIN or bank account number. 1040kit never
 * stores these: forms_fill leaves each box blank and lists it in `handwrite`;
 * the Free File Fillable Forms entry sheet marks it "type this yourself".
 * One list, so the PDF and the entry sheet can't disagree.
 */
import type { Dependent, FormId, ReturnResult } from '@1040kit/engine';

import { FORM_ORDER } from '../calc.ts';
import type { StoreData } from '../store/types.ts';
import { formName } from './field-maps.ts';

export interface IdentifierBox {
  form: FormId;
  /** Where the box is, e.g. 'page 1, top right, "Your social security number"'. */
  where: string;
  /** What goes in it, e.g. "your SSN". */
  what: string;
}

/** Plain-English handwrite item: "Form 1040, page 1, …: write your SSN." */
export const handwriteText = (b: IdentifierBox) =>
  `${formName(b.form)}, ${b.where}: write ${b.what}.`;

export const fullName = (
  n: { firstName?: string; lastName?: string } | undefined
) => [n?.firstName, n?.lastName].filter(Boolean).join(' ') || undefined;

const SCHEDULE_E_COLUMNS = ['A', 'B', 'C'] as const;

/** Rentals in Schedule E column order (A, B, C = id order). */
export function rentalColumns(data: StoreData) {
  const n = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  return [...data.facts.rentals]
    .sort((a, b) => n(a.id) - n(b.id) || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((r, i) => ({ rental: r, column: SCHEDULE_E_COLUMNS[i]! }));
}

/**
 * Schedule EIC children, in column order. The engine's schEIC lines are
 * "<line>:<child n>"; the dependent behind child n is the one its traces
 * reference (dependents[<id>]…), else the n-th dependent not yet used.
 */
export function eicChildren(
  data: StoreData,
  result: ReturnResult
): Dependent[] {
  if (!result.forms.includes('schEIC')) return [];
  const byChild = new Map<number, string | undefined>();
  for (const node of Object.values(result.nodes)) {
    if (node.form !== 'schEIC' || !node.line) continue;
    const m = /:(\d+)$/.exec(node.line);
    if (!m) continue;
    const n = Number(m[1]);
    const ref = node.trace.inputs
      .map((i) => /^dependents\[([^\]]+)\]/.exec(i.ref)?.[1])
      .find(Boolean);
    if (!byChild.has(n) || (ref && !byChild.get(n))) byChild.set(n, ref);
  }
  const deps = data.facts.dependents;
  const used = new Set<string>();
  const out: Dependent[] = [];
  for (const n of [...byChild.keys()].sort((a, b) => a - b).slice(0, 3)) {
    const id = byChild.get(n);
    let d = id ? deps.find((x) => x.id === id) : undefined;
    d ??= deps.find((x) => !used.has(x.id));
    if (!d) continue;
    used.add(d.id);
    out.push(d);
  }
  return out;
}

const SSN_BOX = '"Your social security number" box (top right)';

export function identifierBoxes(
  data: StoreData,
  result: ReturnResult
): IdentifierBox[] {
  const facts = data.facts;
  const mfj = facts.filingStatus === 'mfj';
  const forms = FORM_ORDER.filter((f) => result.forms.includes(f));
  const returnSsn = mfj
    ? 'your SSN (the first SSN shown on Form 1040)'
    : 'your SSN';
  const ownerSsn = (f: FormId) =>
    f.endsWith('.spouse') ? 'your spouse’s SSN' : 'your SSN';
  const out: IdentifierBox[] = [];

  for (const form of forms) {
    if (form === 'f1040') {
      out.push({
        form,
        where: 'page 1, "Your social security number" box (top right)',
        what: 'your SSN',
      });
      if (mfj)
        out.push({
          form,
          where: 'page 1, "Spouse’s social security number" box (top right)',
          what: 'your spouse’s SSN',
        });
      facts.dependents.slice(0, 4).forEach((d, i) => {
        const name = fullName(data.identity.dependents?.[d.id]) ?? d.id;
        out.push({
          form,
          where: `page 1, Dependents table, "Social security number" column, dependent ${i + 1} (${name})`,
          what: `${name}’s SSN`,
        });
      });
      if (result.summary.refundOrOwed > 0)
        out.push({
          form,
          where: 'page 2, lines 35b and 35d (direct deposit)',
          what: 'your bank routing and account numbers and check 35c, if you want the refund deposited (leave them blank for a paper check)',
        });
      continue;
    }
    const owner = /^(schC|schSE|f8829)\./.test(form);
    out.push({
      form,
      where: owner ? '"Social security number" box (top right)' : SSN_BOX,
      what: owner ? ownerSsn(form) : returnSsn,
    });
    if (form === 'f8995') {
      facts.businesses.slice(0, 2).forEach((b, i) => {
        out.push({
          form,
          where: `line 1${i === 0 ? 'i' : 'ii'}, column (c) "Taxpayer identification number"`,
          what: `${b.owner === 'spouse' ? 'your spouse’s' : 'your'} SSN (or the business’s EIN, if it has one)`,
        });
      });
    }
    if (form === 'schEIC') {
      eicChildren(data, result).forEach((d, i) => {
        const name = fullName(data.identity.dependents?.[d.id]) ?? d.id;
        out.push({
          form,
          where: `line 2, Child ${i + 1} (${name})`,
          what: `${name}’s SSN`,
        });
      });
    }
  }
  return out;
}
