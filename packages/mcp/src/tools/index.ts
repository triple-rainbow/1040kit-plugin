import { TOOL_NAMES, type ToolName } from '../tool-names.ts';
import { definition as calcReturn } from './calc-return.ts';
import type { ToolDefinition } from './common.ts';
import { definition as deductionsFind } from './deductions-find.ts';
import { definition as docsExtract } from './docs-extract.ts';
import { definition as docsScan } from './docs-scan.ts';
import { definition as expensesImport } from './expenses-import.ts';
import { definition as explainLine } from './explain-line.ts';
import { definition as filingPrepare } from './filing-prepare.ts';
import { definition as formsFill } from './forms-fill.ts';
import { definition as interviewNext } from './interview-next.ts';
import { definition as kbSearch } from './kb-search.ts';
import { definition as profileGet } from './profile-get.ts';
import { definition as profileSet } from './profile-set.ts';
import { definition as reviewChecks } from './review-checks.ts';
import { definition as scenarioCompare } from './scenario-compare.ts';
import { definition as workspaceInit } from './workspace-init.ts';

const implemented: ToolDefinition[] = [
  workspaceInit,
  docsScan,
  docsExtract,
  profileGet,
  profileSet,
  interviewNext,
  calcReturn,
  explainLine,
  deductionsFind,
  reviewChecks,
  scenarioCompare,
  expensesImport,
  kbSearch,
  formsFill,
  filingPrepare,
];

/** Every tool in TOOL_NAMES; those not built yet answer NOT_IMPLEMENTED. */
export function allTools(): ToolDefinition[] {
  const byName = new Map<ToolName, ToolDefinition>(
    implemented.map((t) => [t.name, t])
  );
  return TOOL_NAMES.map(
    (name) =>
      byName.get(name) ?? {
        name,
        title: name,
        description: `${name} (not available in this version yet).`,
        inputSchema: {},
        handler: async () => ({
          ok: false as const,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: `${name} is not implemented yet.`,
          },
        }),
      }
  );
}
