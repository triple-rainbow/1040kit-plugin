import { z } from 'zod';

import { defineTool } from '../envelope.ts';
import { kbSearch } from '../kb/client.ts';
import { taxYearSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      'A tax question in words. Never include SSNs, account numbers or the user’s figures.'
    ),
  taxYear: taxYearSchema,
  k: z.number().int().min(1).max(10).default(5),
};

export const handler = defineTool(inputSchema, async (input, deps) => {
  const r = await kbSearch(deps.kbFetch, input.query, input.taxYear, input.k);
  return { passages: r.passages, cached: r.cached, sentQuery: r.sentQuery };
});

export const definition: ToolDefinition = {
  name: 'kb_search',
  title: 'Search IRS instructions',
  description:
    'Search the 1040kit knowledge base of IRS instructions and publications for the tax year. Returns passages with source URLs to cite. This is the only tool that uses the network: the query is stripped of personal numbers and dollar amounts first. If it fails (KB_UNAVAILABLE), say so and rely on explain_line citations.',
  inputSchema,
  handler,
};
