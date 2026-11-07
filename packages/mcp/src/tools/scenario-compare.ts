import type { ScenarioInput } from '@1040kit/engine';
import { z } from 'zod';

import { currentResult, engineCall } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  scenarios: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            'Partial TaxFacts deep-merged into the current facts (arrays replace), amounts in cents. Example: {"adjustments":{"sepContributions":{"taxpayer":500000}}}.'
          ),
      })
    )
    .min(1)
    .max(5),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  return store.write((data) => {
    const { result } = currentResult(deps, data);
    const scenarios = engineCall(() =>
      deps.engine.compareScenarios(
        data.facts,
        input.scenarios as ScenarioInput[]
      )
    );
    return { base: result.summary, scenarios };
  });
});

export const definition: ToolDefinition = {
  name: 'scenario_compare',
  title: 'Compare what-ifs',
  description:
    'Recompute the return under hypothetical changes (e.g. a SEP-IRA contribution) without saving them. Returns the base summary and each scenario’s summary and delta.',
  inputSchema,
  handler,
};
