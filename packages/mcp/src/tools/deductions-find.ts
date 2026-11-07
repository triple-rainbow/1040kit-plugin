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
      opportunities: engineCall(() =>
        deps.engine.findDeductions(data.facts, result)
      ),
    };
  });
});

export const definition: ToolDefinition = {
  name: 'deductions_find',
  title: 'Find missed deductions',
  description:
    'Deductions and credits the user may qualify for, ranked by estimated savings. Each has an eligibility test and a question: ask it, and claim nothing until the user confirms (and has the documents). Then record the answer at the listed factPaths with profile_set.',
  inputSchema,
  handler,
};
