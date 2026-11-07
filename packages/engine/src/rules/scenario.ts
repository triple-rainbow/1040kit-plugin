/** compareScenarios: what-ifs as fact patches, recomputed by the engine. */
import { computeReturn } from '../compute.ts';
import type {
  DeepPartial,
  ReturnResult,
  ScenarioInput,
  ScenarioResult,
  TaxFacts,
} from '../types.ts';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge: nested objects merge, arrays and scalars replace, undefined is ignored. Inputs are not mutated. */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return structuredClone(base);
  if (!isPlainObject(base) || !isPlainObject(patch))
    return structuredClone(patch as T);
  const out: Record<string, unknown> = structuredClone(base) as Record<
    string,
    unknown
  >;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] =
      isPlainObject(v) && isPlainObject(out[k])
        ? deepMerge(out[k], v as never)
        : structuredClone(v);
  }
  return out as T;
}

export function scenarioResult(
  name: string,
  base: ReturnResult,
  next: ReturnResult
): ScenarioResult {
  return {
    name,
    summary: next.summary,
    complete: next.complete,
    delta: {
      refundOrOwed: next.summary.refundOrOwed - base.summary.refundOrOwed,
      totalTax: next.summary.totalTax - base.summary.totalTax,
    },
  };
}

export function compareScenarios(
  facts: TaxFacts,
  scenarios: ScenarioInput[]
): ScenarioResult[] {
  const base = computeReturn(facts);
  return scenarios.map((s) =>
    scenarioResult(s.name, base, computeReturn(deepMerge(facts, s.patch)))
  );
}
