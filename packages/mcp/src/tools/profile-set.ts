import { z } from 'zod';

import { defineTool } from '../envelope.ts';
import { applySets } from '../store/profile.ts';
import { openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

const json = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

export const inputSchema = {
  workspace: workspaceSchema,
  set: z
    .array(
      z.object({
        path: z
          .string()
          .describe(
            'Fact path, e.g. "filingStatus", "dependents[dependent_1].dateOfBirth", "businesses[taxpayer].expenses.supplies", "rentals[rental_1].expenses.repairs", "e1098s[e1098_1].interest", "identity.address.state", "identity.rentals[rental_1].address.street".'
          ),
        value: json.describe(
          'New value (amounts in integer cents). null removes the value or list item.'
        ),
        source: z
          .enum(['user', 'inferred'])
          .describe(
            '"user" if the user said so; "inferred" if you deduced it.'
          ),
        note: z.string().max(200).optional(),
      })
    )
    .min(1)
    .max(50),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  const at = deps.now().toISOString();
  return store.write((data) => applySets(data, input.set, at));
});

export const definition: ToolDefinition = {
  name: 'profile_set',
  title: 'Record tax facts',
  description:
    'Record facts the user told you (or you inferred), with provenance. Amounts are integer cents. New list items are created on first use (e.g. "dependents[dependent_2].dateOfBirth"); new W-2/1099/1098-E items and rentals need an `owner` in the same call (rentals: taxpayer, spouse or joint). `null` removes a value or item. Never send SSNs, EINs or account numbers: they are rejected (1040kit never stores SSNs or bank numbers). Invalid paths/values come back in `rejected` and nothing is written for them.',
  inputSchema,
  handler,
};
