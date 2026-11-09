/**
 * The kind of answer an interview question takes, read from the facts schema
 * at its path, so a widget (or the AI) can offer chips instead of a text box.
 * The schema is the same one profile_set validates against, so a chip's value
 * is always accepted.
 */
import type { z } from 'zod';

import { taxFactsSchema } from '../store/facts-schema.ts';

export type AnswerSpec =
  | { kind: 'yesno' }
  | { kind: 'choice'; options: { value: string; label: string }[] }
  | { kind: 'amount' }
  | { kind: 'date' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'text' }
  /** A list or a group of facts: answered in conversation, not with one control. */
  | { kind: 'open' };

/** Plain-English labels for enum values; anything missing is humanized. */
const LABELS: Record<string, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  hoh: 'Head of household',
  child: 'Son or daughter',
  stepchild: 'Stepchild',
  foster_child: 'Foster child',
  sibling: 'Brother or sister',
  half_sibling: 'Half brother or sister',
  step_sibling: 'Stepbrother or stepsister',
  grandchild: 'Grandchild',
  niece_nephew: 'Niece or nephew',
  parent: 'Parent',
  other: 'Someone else',
  taxpayer: 'You',
  spouse: 'Your spouse',
  joint: 'Both of you',
  rent: 'Rent',
  own: 'Own',
};

function humanize(v: string): string {
  const s = v.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type AnyZod = z.ZodType & {
  _zod: { def: Record<string, unknown> & { type: string } };
};

function unwrap(s: AnyZod): AnyZod {
  let cur = s;
  for (;;) {
    const t = cur._zod.def.type;
    if (t === 'optional' || t === 'nullable' || t === 'default')
      cur = cur._zod.def.innerType as AnyZod;
    else return cur;
  }
}

const SEGMENT = /^([A-Za-z0-9_]+)(?:\[([^\]]+)\])?$/;

/** The schema at a fact path ("dependents[dependent_1].relationship"), or undefined. */
export function schemaAt(path: string): AnyZod | undefined {
  let cur: AnyZod | undefined = taxFactsSchema as unknown as AnyZod;
  for (const seg of path.split('.')) {
    const m = SEGMENT.exec(seg);
    if (!m || !cur) return undefined;
    cur = unwrap(cur);
    const def = cur._zod.def;
    if (def.type === 'object') {
      cur = (def.shape as Record<string, AnyZod>)[m[1]!];
    } else if (def.type === 'record') {
      cur = def.valueType as AnyZod;
    } else return undefined;
    if (!cur) return undefined;
    if (m[2] !== undefined) {
      cur = unwrap(cur);
      if (cur._zod.def.type !== 'array') return undefined;
      cur = cur._zod.def.element as AnyZod;
    }
  }
  return cur;
}

export function answerSpec(path: string): AnswerSpec {
  const at = schemaAt(path);
  if (!at) return { kind: 'open' };
  const meta = (at.meta?.() ?? unwrap(at).meta?.()) as
    { answer?: string; labels?: Record<string, string> } | undefined;
  if (meta?.answer === 'amount') return { kind: 'amount' };
  if (meta?.answer === 'date') return { kind: 'date' };
  const s = unwrap(at);
  const def = s._zod.def;
  switch (def.type) {
    case 'boolean':
      return { kind: 'yesno' };
    case 'enum': {
      const values = Object.values(def.entries as Record<string, string>);
      return {
        kind: 'choice',
        options: values.map((v) => ({
          value: v,
          label: meta?.labels?.[v] ?? LABELS[v] ?? humanize(v),
        })),
      };
    }
    case 'number': {
      const n = s as unknown as {
        minValue: number | null;
        maxValue: number | null;
      };
      return {
        kind: 'number',
        ...(Number.isFinite(n.minValue) ? { min: n.minValue! } : {}),
        ...(Number.isFinite(n.maxValue) ? { max: n.maxValue! } : {}),
      };
    }
    case 'string':
      return { kind: 'text' };
    default:
      return { kind: 'open' };
  }
}
