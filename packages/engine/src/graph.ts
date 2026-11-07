/**
 * Computation graph: semantic nodes, evaluated in dependency order, each one
 * recording a trace of the nodes, facts and parameters it actually read.
 */
import type { FormLine, YearParams } from './params/index.ts';
import type { Citation, LineNode, TaxFacts, TraceInput } from './types.ts';

export interface NodeContext {
  /** Value of a declared dependency. */
  node(id: string): number;
  /** Read a fact by path ("w2s[w2_1].wages"); recorded in the trace. */
  fact<T = unknown>(path: string): T | undefined;
  /** Read a numeric fact in cents, 0 when absent. */
  cents(path: string): number;
  /** Record a parameter used by the formula and return it. */
  param<T extends number | string | boolean>(name: string, value: T): T;
  readonly facts: TaxFacts;
  readonly params: YearParams;
}

export interface NodeDef {
  id: string;
  label: string;
  deps: string[];
  formula: string;
  cite: Citation[];
  /** Where the node prints, when it is not in the year's static `formLines` (e.g. Schedule E column "3:A"). */
  at?: FormLine;
  compute(ctx: NodeContext): number;
}

export function defineNode(def: NodeDef): NodeDef {
  return def;
}

type Scalar = number | string | boolean | null;

const SEGMENT = /^([A-Za-z0-9_]+)(?:\[([^\]]+)\])?$/;

/**
 * Resolve a fact path. Array segments select by `id`, or by `owner` for
 * arrays keyed by person (e.g. "businesses[taxpayer].expenses.supplies").
 */
export function resolveFactPath(facts: unknown, path: string): unknown {
  let cur: unknown = facts;
  for (const seg of path.split('.')) {
    const m = SEGMENT.exec(seg);
    if (!m) throw new Error(`Bad fact path segment "${seg}" in "${path}"`);
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[m[1]!];
    const key = m[2];
    if (key !== undefined) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find(
        (el: unknown) =>
          el !== null &&
          typeof el === 'object' &&
          ((el as { id?: unknown }).id === key ||
            (el as { owner?: unknown }).owner === key)
      );
    }
  }
  return cur;
}

function toScalar(v: unknown): Scalar {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
    return v;
  return JSON.stringify(v);
}

/** Topological order; throws on unknown deps and cycles. */
export function topoSort(nodes: NodeDef[]): NodeDef[] {
  const byId = new Map<string, NodeDef>();
  for (const n of nodes) {
    if (byId.has(n.id)) throw new Error(`Duplicate node id "${n.id}"`);
    byId.set(n.id, n);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const order: NodeDef[] = [];
  const visit = (id: string, path: string[]) => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting')
      throw new Error(
        `Cycle in computation graph: ${[...path, id].join(' -> ')}`
      );
    const n = byId.get(id);
    if (!n)
      throw new Error(`Unknown node "${id}" (needed by ${path.at(-1) ?? '?'})`);
    state.set(id, 'visiting');
    for (const d of n.deps) visit(d, [...path, id]);
    state.set(id, 'done');
    order.push(n);
  };
  for (const n of nodes) visit(n.id, []);
  return order;
}

export function evaluate(
  nodes: NodeDef[],
  facts: TaxFacts,
  params: YearParams
): Record<string, LineNode> {
  const out: Record<string, LineNode> = {};
  for (const def of topoSort(nodes)) {
    const inputs: TraceInput[] = [];
    const seen = new Set<string>();
    const record = (ref: string, kind: TraceInput['kind'], value: Scalar) => {
      const key = `${kind}:${ref}`;
      if (seen.has(key)) return;
      seen.add(key);
      inputs.push({ ref, kind, value });
    };
    const deps = new Set(def.deps);
    for (const d of def.deps) record(d, 'node', out[d]!.value);
    const ctx: NodeContext = {
      facts,
      params,
      node(id) {
        if (!deps.has(id))
          throw new Error(
            `Node "${def.id}" read undeclared dependency "${id}"`
          );
        return out[id]!.value;
      },
      fact<T>(path: string) {
        const v = resolveFactPath(facts, path);
        record(path, 'fact', toScalar(v));
        return v as T | undefined;
      },
      cents(path) {
        const v = resolveFactPath(facts, path);
        record(path, 'fact', toScalar(v));
        if (v === undefined || v === null) return 0;
        if (typeof v !== 'number' || !Number.isInteger(v)) {
          throw new Error(
            `Fact "${path}" must be integer cents (got ${String(v)})`
          );
        }
        return v;
      },
      param(name, value) {
        record(name, 'param', value);
        return value;
      },
    };
    const value = def.compute(ctx);
    if (!Number.isInteger(value)) {
      throw new Error(`Node "${def.id}" computed a non-integer value ${value}`);
    }
    const where = def.at ?? params.formLines[def.id];
    out[def.id] = {
      id: def.id,
      label: def.label,
      value: value === 0 ? 0 : value,
      ...(where ? { form: where.form, line: where.line } : {}),
      trace: { formula: def.formula, inputs },
      citations: def.cite,
    };
  }
  return out;
}
