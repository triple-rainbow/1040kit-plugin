import { z } from 'zod';

import { engineCall } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { requireAcknowledgment } from '../output/acknowledgment.ts';
import { isAnswered } from '../store/profile.ts';
import { openStore } from '../store/workspace.ts';
import {
  PHASES,
  planQuestions,
  type Phase,
  type PlannedQuestion,
} from '../ui/interview-plan.ts';
import type { StoreData } from '../store/types.ts';
import { INTERVIEW_WIDGET_URI } from '../ui/interview-widget.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  limit: z.number().int().min(1).max(20).default(5),
};

/**
 * The engine never sees names, so it asks about "your dependent #1". When
 * the user already gave that dependent's first name, ask about them by name.
 */
function withDependentName(
  q: PlannedQuestion,
  data: StoreData
): PlannedQuestion {
  const id = /^dependents\[([^\]]+)\]/.exec(q.path)?.[1];
  if (!id) return q;
  const index = data.facts.dependents.findIndex((d) => d.id === id);
  const name = data.identity.dependents?.[id]?.firstName?.trim();
  if (index < 0 || !name) return q;
  const label = `your dependent #${index + 1}`;
  return {
    ...q,
    question: q.question.split(label).join(name),
    why: q.why.split(label).join(name),
  };
}

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  const data = await store.read();
  requireAcknowledgment(data, store.workspace);
  const all = engineCall(() => deps.engine.requiredFacts(data.facts));
  const planned = planQuestions(
    all.filter((m) => !isAnswered(data, m.path)),
    data.facts.taxYear
  ).map((q) => withDependentName(q, data));
  if (planned.length === 0) {
    return {
      workspace: store.workspace,
      phase: null,
      questions: [],
      remaining: 0,
      done: true,
    };
  }
  // One phase at a time. The income phase is finished once its required
  // questions are answered; optional income questions the user skipped
  // don't hold back deductions and credits, and come back at the end.
  const phase: Phase = planned.some((q) => q.phase === 'income' && q.blocking)
    ? 'income'
    : planned.some((q) => q.phase === 'deductions')
      ? 'deductions'
      : 'income';
  const inPhase = planned.filter((q) => q.phase === phase);
  return {
    workspace: store.workspace,
    phase,
    phaseTitle: PHASES[phase].title,
    phaseIntro: PHASES[phase].intro,
    questions: inPhase.slice(0, input.limit),
    remaining: inPhase.length,
    remainingAfterThisPhase: planned.length - inPhase.length,
    done: false,
  };
});

export const definition: ToolDefinition = {
  name: 'interview_next',
  title: 'Next interview questions',
  description:
    'The fewest questions still needed, one phase at a time: `income` (you, your household, your income) first, then `deductions` (deductions and credits). When a new phase starts, tell the user its `phaseIntro` in one sentence. Each question has an `answer` type: yesno, choice (options), amount (dollars, record as cents), date, number, text, open, or multiselect. A multiselect lists situations to check: record every option `path` with profile_set, true for the ones the user picks and false for the rest; `other.path` takes a list of short descriptions ([] when none). Hosts that support MCP Apps show the questions as a card (chips, check boxes, text boxes) that saves the answers itself and then posts what it saved: in that case introduce the card in one line and do not list or repeat its questions. Otherwise ask in plain English (for a multiselect, show the list and ask which apply), record with profile_set, and call again until `done` is true.',
  inputSchema,
  ui: { resourceUri: INTERVIEW_WIDGET_URI },
  handler,
};
