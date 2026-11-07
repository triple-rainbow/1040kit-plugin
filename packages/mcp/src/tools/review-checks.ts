import { currentResult, engineCall } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = { workspace: workspaceSchema };

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  return store.write((data) => {
    const { result } = currentResult(deps, data);
    return {
      findings: engineCall(() =>
        deps.engine.reviewChecks(data.facts, result, data.priorYear)
      ),
      comparedWithPriorYear: !!data.priorYear,
    };
  });
});

export const definition: ToolDefinition = {
  name: 'review_checks',
  title: 'Check the return',
  description:
    'Consistency and error checks on the return (document cross-checks, unusual swings vs last year’s 1040 when it was in the inbox). Resolve every error with the user before forms_fill.',
  inputSchema,
  handler,
};
