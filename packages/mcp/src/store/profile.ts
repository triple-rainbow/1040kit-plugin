/**
 * Fact paths and provenance. Path syntax matches the engine's trace refs:
 *   taxpayer.dateOfBirth · w2s[w2_1].wages · businesses[taxpayer].expenses.supplies
 *   dependents[dependent_2] (the whole item) · identity.address.state
 * Keyed arrays are matched by `id`, except `businesses`, matched by `owner`.
 */
import type { TaxFacts } from '@1040kit/engine';
import type { z } from 'zod';

import { containsPii } from '../pii/redact.ts';
import { isToken, Vault } from '../pii/vault.ts';
import { identitySchema, taxFactsSchema } from './facts-schema.ts';
import type { FactSource, ProvenanceEntry, StoreData } from './types.ts';

export type Segment = { key: string; select?: string };

const SEG_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([A-Za-z0-9_]+)\])?$/;

export function parsePath(path: string): Segment[] | null {
  if (!path || path.length > 200) return null;
  const segs: Segment[] = [];
  for (const part of path.split('.')) {
    const m = SEG_RE.exec(part);
    if (!m) return null;
    segs.push(m[2] ? { key: m[1]!, select: m[2] } : { key: m[1]! });
  }
  return segs;
}

const KEYED: Record<string, 'id' | 'owner'> = {
  dependents: 'id',
  w2s: 'id',
  int1099s: 'id',
  div1099s: 'id',
  nec1099s: 'id',
  misc1099s: 'id',
  k1099s: 'id',
  e1098s: 'id',
  businesses: 'owner',
  rentals: 'id',
};

/** Required money fields that start at 0 when an item is created by hand. */
const NEW_ITEM_DEFAULTS: Record<string, Record<string, unknown>> = {
  w2s: {
    wages: 0,
    federalWithheld: 0,
    ssWages: 0,
    ssTax: 0,
    medicareWages: 0,
    medicareTax: 0,
  },
  int1099s: { interest: 0 },
  div1099s: { ordinaryDividends: 0, qualifiedDividends: 0 },
  nec1099s: { nonemployeeComp: 0 },
  misc1099s: {},
  k1099s: { grossAmount: 0 },
  e1098s: { interest: 0 },
  rentals: { expenses: {} },
};

type Obj = Record<string, unknown>;

export function getPath(root: unknown, segs: Segment[]): unknown {
  let cur: unknown = root;
  for (const s of segs) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Obj)[s.key];
    if (s.select !== undefined) {
      if (!Array.isArray(cur)) return undefined;
      const k = KEYED[s.key] ?? 'id';
      cur = cur.find((x) => (x as Obj)?.[k] === s.select);
    }
  }
  return cur;
}

export interface SetOutcome {
  /** Keyed-array item created by this write: `${coll}[${id}]`. */
  created?: string;
}

/** Applies one write in place. Throws an Error with a user-facing reason. */
function applyOne(root: Obj, segs: Segment[], value: unknown): SetOutcome {
  const out: SetOutcome = {};
  let cur: Obj = root;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    const last = i === segs.length - 1;
    if (s.select !== undefined) {
      const k = KEYED[s.key];
      if (!k) throw new Error(`${s.key} is not a list`);
      if (k === 'owner' && s.select !== 'taxpayer' && s.select !== 'spouse') {
        throw new Error('businesses are keyed by owner: taxpayer or spouse');
      }
      let arr = cur[s.key];
      if (arr === undefined) arr = cur[s.key] = [];
      if (!Array.isArray(arr)) throw new Error(`${s.key} is not a list`);
      const idx = arr.findIndex((x) => (x as Obj)?.[k] === s.select);
      if (last && value === null) {
        if (idx >= 0) arr.splice(idx, 1);
        return out;
      }
      if (last) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('a whole list item must be an object');
        }
        const item = { ...(value as Obj), [k]: s.select };
        if (idx >= 0) arr[idx] = item;
        else {
          arr.push(item);
          out.created = `${s.key}[${s.select}]`;
        }
        return out;
      }
      let item = idx >= 0 ? (arr[idx] as Obj) : undefined;
      if (!item) {
        item =
          s.key === 'businesses'
            ? { owner: s.select, expenses: {} }
            : { id: s.select, ...(NEW_ITEM_DEFAULTS[s.key] ?? {}) };
        arr.push(item);
        out.created = `${s.key}[${s.select}]`;
      }
      cur = item;
      continue;
    }
    if (last) {
      if (value === null) delete cur[s.key];
      else cur[s.key] = value;
      return out;
    }
    let next = cur[s.key];
    if (next === undefined || next === null) {
      next = cur[s.key] = s.key === 'spouse' ? { id: 'spouse' } : {};
    }
    if (typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`${s.key} is a value, not a group`);
    }
    cur = next as Obj;
  }
  return out;
}

function issueText(issues: z.core.$ZodIssue[]): string {
  return issues
    .slice(0, 3)
    .map((i) => {
      const where = i.path.join('.');
      if (i.code === 'unrecognized_keys')
        return `unknown field ${i.keys.join(', ')}${where ? ` in ${where}` : ''}`;
      return `${where || 'value'}: ${i.message}`;
    })
    .join('; ');
}

export interface SetRequest {
  path: string;
  value: unknown;
  source: Exclude<FactSource, 'doc'>;
  note?: string;
}

export interface SetResult {
  updated: string[];
  rejected: { path: string; reason: string }[];
}

function piiReason(value: unknown): string | null {
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  for (const s of strings) {
    if (!isToken(s) && containsPii(s)) {
      return 'looks like an SSN, EIN or account number. 1040kit never stores SSNs or bank account numbers: the user writes them on the forms (or types them into Free File Fillable Forms) themselves. EINs come only from documents, as tokens.';
    }
  }
  return null;
}

function prefixes(path: string): string[] {
  return [path + '.', path + '['];
}

/**
 * Apply a batch of writes to `data` (facts or identity), validating each
 * against the schema and recording provenance. New list items need `owner`
 * by the end of the batch, or every write that touched them is rejected.
 */
export function applySets(
  data: StoreData,
  sets: SetRequest[],
  at: string
): SetResult {
  const result: SetResult = { updated: [], rejected: [] };
  const vault = new Vault(data.vault);
  const created = new Map<string, string[]>(); // item → paths in this batch

  const reject = (path: string, reason: string) =>
    result.rejected.push({ path, reason });

  for (const req of sets) {
    const segs = parsePath(req.path);
    if (!segs) {
      reject(req.path, 'not a valid fact path');
      continue;
    }
    const pii = piiReason(req.value);
    if (pii) {
      reject(req.path, pii);
      continue;
    }
    if (isToken(req.value) && !vault.has(req.value)) {
      reject(req.path, `unknown token ${req.value}`);
      continue;
    }
    const isIdentity = segs[0]!.key === 'identity';
    if (!isIdentity && ['taxYear'].includes(segs[0]!.key)) {
      reject(req.path, 'the tax year is fixed by the workspace');
      continue;
    }
    if (
      !isIdentity &&
      segs.length === 1 &&
      segs[0]!.select === undefined &&
      typeof req.value === 'object' &&
      req.value !== null &&
      KEYED[segs[0]!.key]
    ) {
      reject(
        req.path,
        'set list items one at a time, e.g. dependents[dependent_1].dateOfBirth'
      );
      continue;
    }
    const target = isIdentity ? data.identity : data.facts;
    const draft = structuredClone(target) as Obj;
    let outcome: SetOutcome;
    try {
      // identity.dependents[dependent_1] → identity.dependents.dependent_1
      const isegs = isIdentity
        ? segs
            .slice(1)
            .flatMap((s) =>
              s.select ? [{ key: s.key }, { key: s.select }] : [s]
            )
        : segs;
      if (isIdentity && isegs.length === 0)
        throw new Error('set identity fields one at a time');
      outcome = applyOne(draft, isegs, req.value);
    } catch (e) {
      reject(req.path, (e as Error).message);
      continue;
    }
    const schema = isIdentity ? identitySchema : taxFactsSchema;
    const parsed = schema.safeParse(draft);
    let issues = parsed.success ? [] : parsed.error.issues;
    if (!isIdentity) {
      // An owner may still arrive later in this batch.
      issues = issues.filter((i) => {
        if (i.path[i.path.length - 1] !== 'owner' || i.path.length !== 3)
          return true;
        const list = (draft as Obj)[i.path[0] as string] as Obj[];
        const item = list?.[i.path[1] as number];
        const name = `${String(i.path[0])}[${String(item?.id)}]`;
        return !(created.has(name) || outcome.created === name);
      });
    }
    if (issues.length) {
      reject(req.path, issueText(issues));
      continue;
    }
    // Commit.
    if (isIdentity) data.identity = draft as StoreData['identity'];
    else data.facts = draft as unknown as TaxFacts;
    if (outcome.created) created.set(outcome.created, []);
    for (const [item, paths] of created) {
      if (req.path === item || req.path.startsWith(item + '.'))
        paths.push(req.path);
    }

    const prev = data.provenance[req.path];
    if (req.value === null) {
      for (const k of Object.keys(data.provenance)) {
        if (prefixes(req.path).some((p) => k.startsWith(p)))
          delete data.provenance[k];
      }
    }
    const entry: ProvenanceEntry = { source: req.source, at };
    if (req.note) entry.note = req.note.slice(0, 200);
    if (req.value === null) {
      entry.note = entry.note ?? 'removed';
      entry.removed = true;
    }
    if (prev?.source === 'doc' || prev?.overrides === 'doc') {
      entry.overrides = 'doc';
      if (prev.docId) entry.docId = prev.docId;
      if (prev.field) entry.field = prev.field;
    }
    data.provenance[req.path] = entry;
    result.updated.push(req.path);
  }

  // Items created without an owner: undo them.
  for (const [item, paths] of created) {
    const segs = parsePath(item)!;
    const node = getPath(data.facts, segs) as Obj | undefined;
    if (
      !node ||
      segs[0]!.key === 'dependents' ||
      segs[0]!.key === 'businesses' ||
      node.owner
    )
      continue;
    applyOne(data.facts as unknown as Obj, segs, null);
    for (const p of paths) {
      delete data.provenance[p];
      result.updated = result.updated.filter((u) => u !== p);
      reject(
        p,
        `${item} is new: set ${item}.owner (${segs[0]!.key === 'rentals' ? 'taxpayer, spouse or joint' : 'taxpayer or spouse'}) in the same call`
      );
    }
  }
  return result;
}

/** The provenance entry that covers a fact path (exact, or the nearest parent). */
export function provenanceFor(
  data: StoreData,
  path: string
): ProvenanceEntry | undefined {
  if (data.provenance[path]) return data.provenance[path];
  let p = path;
  while (p) {
    const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
    if (cut <= 0) break;
    p = p.slice(0, cut);
    if (data.provenance[p]) return data.provenance[p];
  }
  return undefined;
}

/** Plain-English source, for the agent to quote ("from w2.pdf, box1"). */
export function describeSource(
  data: StoreData,
  e: ProvenanceEntry | undefined
): string {
  if (!e) return 'not provided';
  if (e.source === 'doc') {
    const file =
      data.docs.find((d) => d.docId === e.docId)?.file ??
      e.docId ??
      'a document';
    return `from ${file}${e.field ? ` (${e.field})` : ''}`;
  }
  if (e.source === 'user')
    return e.overrides
      ? 'you told me (replacing the document value)'
      : 'you told me';
  return 'inferred';
}

/** True when the path (or anything under it) has an answer. */
export function isAnswered(data: StoreData, path: string): boolean {
  if (data.answers[path] !== undefined) return true;
  return Object.entries(data.provenance).some(
    ([k, e]) =>
      !e.removed && (k === path || prefixes(path).some((p) => k.startsWith(p)))
  );
}
