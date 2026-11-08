import { computeReturn } from './compute.ts';
import { explainLine } from './explain.ts';
import { requiredFacts } from './required.ts';
import { findDeductions } from './rules/deductions.ts';
import { reviewChecks } from './rules/review.ts';
import { compareScenarios } from './rules/scenario.ts';
import { checkScope } from './scope.ts';
import type { EngineApi } from './types.ts';

export * from './types.ts';
export { getParams } from './params/index.ts';
export type { YearParams } from './params/index.ts';
export { resolveFactPath } from './graph.ts';
export { classifyDependent } from './dependents.ts';
export type { DependentClass, DependentCredit } from './dependents.ts';

export const engine: EngineApi = {
  supportedYears: [2025, 2026],
  computeReturn,
  explainLine,
  requiredFacts,
  checkScope,
  findDeductions,
  reviewChecks,
  compareScenarios,
};
