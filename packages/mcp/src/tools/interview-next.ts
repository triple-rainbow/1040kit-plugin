import { z } from 'zod';

import { engineCall } from '../calc.ts';
import { defineTool } from '../envelope.ts';
import { requireAcknowledgment } from '../output/acknowledgment.ts';
import { isAnswered } from '../store/profile.ts';
import { openStore } from '../store/workspace.ts';
import { householdQuestion, workspaceForms } from '../ui/interview-forms.ts';
import {
  groupQuestions,
  PHASE_ORDER,
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
  return store.write((data) => {
    requireAcknowledgment(data, store.workspace);
    const all = engineCall(() => deps.engine.requiredFacts(data.facts));
    let planned = planQuestions(
      all.filter((m) => !isAnswered(data, m.path)),
      data.facts.taxYear
    ).map((q) => withDependentName(q, data));
    const household = householdQuestion(planned, data);
    planned = workspaceForms(
      household.question
        ? [household.question, ...household.rest]
        : household.rest,
      data
    ).sort(
      (a, b) =>
        PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase) ||
        Number(b.blocking) - Number(a.blocking) ||
        a.priority - b.priority
    );
    if (planned.length === 0) {
      return {
        workspace: store.workspace,
        phase: null,
        questions: [],
        remaining: 0,
        done: true,
      };
    }
    // One part at a time, always forward: the first part with a required
    // question (optional ones the user skipped don't hold it back). Once a
    // later part has started, questions that turn up for an earlier part are
    // asked in the current one, so the interview never goes back on its own.
    // To change an earlier answer, the user says so and it is saved with profile_set.
    const at = (p: Phase) => PHASE_ORDER.indexOf(p);
    const firstBlocking = PHASE_ORDER.find((p) =>
      planned.some((q) => q.phase === p && q.blocking)
    );
    const firstAny = PHASE_ORDER.find((p) =>
      planned.some((q) => q.phase === p)
    )!;
    const reached =
      (data.answers.interviewPhase as Phase | undefined) ?? 'income';
    const next = firstBlocking ?? firstAny;
    const phase: Phase = at(next) >= at(reached) ? next : reached;
    data.answers.interviewPhase = phase;
    const inPhase = groupQuestions(
      planned.filter((q) => at(q.phase) <= at(phase)),
      {
        dependentIds: data.facts.dependents.map((d) => d.id),
        names: Object.fromEntries(
          Object.entries(data.identity.dependents ?? {}).map(([id, n]) => [
            id,
            n.firstName?.trim() || undefined,
          ])
        ),
      }
    );
    return {
      workspace: store.workspace,
      phase,
      phaseTitle: PHASES[phase].title,
      phaseIntro: PHASES[phase].intro,
      questions: inPhase.slice(0, input.limit),
      remaining: inPhase.length,
      remainingAfterThisPhase: planned.filter((q) => at(q.phase) > at(phase))
        .length,
      done: false,
    };
  });
});

export const definition: ToolDefinition = {
  name: 'interview_next',
  title: 'Next interview questions',
  description:
    'The fewest questions still needed, one part at a time and always forward: `income` (you, your household, your income), then `deductions` (deductions and credits), then `payments` (tax already paid, such as estimated payments). When a new part starts, tell the user its `phaseIntro` in one sentence. A question that turns up for an earlier part is asked in the current one. When the user wants to change an earlier answer, record it with profile_set. Each question has a plain-English `why` to show the user and, where there is one, the IRS `cite` to quote if they ask for the rule. Each question has an `answer` type: yesno, choice (options), check (one box: true or false), amount (dollars, record as cents), date, number, text, open, multiselect, checklist or group. ' +
    'A group is several facts about one thing (you and your spouse, a dependent, a business, a vehicle, a rental) asked as one form: ask all its `fields` in one message and record each field’s `path` in one profile_set call. A field with `value` is already known (e.g. a name read from a document): show it and save it as confirmed, or the user’s correction. A `hidden` field is saved with its `value` without asking. A field with `showIf` applies only when the field at `showIf.path` has that answer (`equals`) or not (`notEquals`); `optional` fields may stay empty. On a joint return the household form has a `swap` field (path `mainFiler`): the first filer is listed first on the return and questions that say “you” mean them; when the user says the spouse should be listed first, send `{ path: "mainFiler", value: "spouse" }` in the same profile_set call, which swaps the two people and everything each owns before the call’s other writes, so those describe the people in their new places (taxpayer = listed first). When it has `addAnother`, the user may add more people or properties with the same fields (replace "{id}" with `idPrefix` + `nextIndex`, then the next). ' +
    'A checklist (business or rental expenses) lists categories: ask which ones apply and the total for each, then record each one’s `path` (cents) and `done.path` = true in one call; categories not picked stay $0. Receipts are not needed for the return: the user keeps them. A multiselect lists situations to check: record every option `path` with profile_set, true for the ones the user picks and false for the rest; `other.path` takes a list of short descriptions ([] when none). Hosts that support MCP Apps show the questions as a card (chips, check boxes, text boxes) that saves the answers itself and then posts what it saved: in that case introduce the card in one line and do not list or repeat its questions. Otherwise ask in plain English (for a multiselect, show the list and ask which apply), record with profile_set, and call again until `done` is true.',
  inputSchema,
  ui: { resourceUri: INTERVIEW_WIDGET_URI },
  handler,
};
