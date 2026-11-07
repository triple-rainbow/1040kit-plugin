import { z } from 'zod';

import { engineCall } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { isAnswered } from '../store/profile.ts';
import { openStore } from '../store/workspace.ts';
import { answerSpec } from '../ui/answers.ts';
import { INTERVIEW_WIDGET_URI } from '../ui/interview-widget.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  limit: z.number().int().min(1).max(20).default(5),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  const data = await store.read();
  const all = engineCall(() => deps.engine.requiredFacts(data.facts));
  const open = all
    .filter((m) => !isAnswered(data, m.path))
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) || a.priority - b.priority
    );
  return {
    workspace: store.workspace,
    questions: open
      .slice(0, input.limit)
      .map((q) => ({ ...q, answer: answerSpec(q.path) })),
    remaining: open.length,
    done: open.length === 0,
  };
});

export const definition: ToolDefinition = {
  name: 'interview_next',
  title: 'Next interview questions',
  description:
    'The fewest questions still needed to finish the return, most important first. Each question has an `answer` type (yesno, choice with options, amount in dollars to record as cents, date, number, text, or open). Hosts that support MCP Apps show the questions as a card with answer chips; the card records answers with profile_set itself and then tells you what was saved. Otherwise ask them in plain English (offer the choices), record answers with profile_set, then call again until `done` is true.',
  inputSchema,
  ui: { resourceUri: INTERVIEW_WIDGET_URI },
  handler,
};
