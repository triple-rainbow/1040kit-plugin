import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ScheduleCExpense } from '@1040kit/engine';
import { z } from 'zod';

import { defineTool, ToolError } from '../envelope.ts';
import { categorize } from '../expenses/categorize.ts';
import { parseStatement } from '../expenses/parse.ts';
import { scheduleCExpense } from '../store/facts-schema.ts';
import { inboxPath, openStore } from '../store/workspace.ts';
import { workspaceSchema, type ToolDefinition } from './common.ts';

export const inputSchema = {
  workspace: workspaceSchema,
  file: z
    .string()
    .min(1)
    .describe(
      'CSV in the workspace, e.g. "chase-2025.csv" (relative to the inbox).'
    ),
  owner: z
    .enum(['taxpayer', 'spouse'])
    .describe('Whose Schedule C business these expenses belong to.'),
  action: z.enum(['propose', 'confirm']),
  decisions: z
    .array(
      z.object({
        rowId: z.string(),
        category: z.union([scheduleCExpense, z.literal('personal')]),
      })
    )
    .optional()
    .describe(
      'For confirm: the user’s category for each business row. Rows left out are not counted.'
    ),
};

const inside = (root: string, p: string) => {
  const rel = relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

async function resolveCsv(
  ws: string,
  file: string
): Promise<{ abs: string; rel: string }> {
  const candidates = isAbsolute(file)
    ? [file]
    : [join(inboxPath(ws), file), resolve(ws, file)];
  const outside = new ToolError(
    'FILE_OUTSIDE_WORKSPACE',
    'Only CSV files inside the workspace (put them in the inbox) can be imported.'
  );
  const realWs = await realpath(ws);
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    const real = await realpath(c); // follows symlinks out of the workspace too
    if (!inside(realWs, real)) throw outside;
    const realInbox = await realpath(inboxPath(ws));
    const base = inside(realInbox, real) ? realInbox : realWs;
    return { abs: real, rel: relative(base, real).split(sep).join('/') };
  }
  if (candidates.every((c) => !inside(ws, resolve(c)))) throw outside;
  throw new ToolError('FILE_NOT_FOUND', `No file "${file}" in the inbox.`);
}

export const handler = defineTool(inputSchema, async (input, deps) => {
  const store = await openStore(input.workspace);
  const { abs, rel } = await resolveCsv(store.workspace, input.file);
  let statement;
  try {
    statement = parseStatement(await readFile(abs, 'utf8'));
  } catch (e) {
    throw new ToolError(
      'CSV_UNREADABLE',
      `Could not read ${rel} as a bank statement: ${(e as Error).message}`
    );
  }

  if (input.action === 'propose') {
    const rows = statement.rows.map((r) => ({ ...r, ...categorize(r) }));
    const byProposed: Record<string, number> = {};
    for (const r of rows)
      byProposed[r.proposed] = (byProposed[r.proposed] ?? 0) + r.amount;
    return {
      file: rel,
      layout: statement.layout,
      rows,
      ignored: statement.ignored,
      totals: {
        rows: rows.length,
        moneyOut: rows.reduce((s, r) => s + r.amount, 0),
        byProposed,
      },
    };
  }

  const byRow = new Map(statement.rows.map((r) => [r.rowId, r]));
  const rejected: { rowId: string; reason: string }[] = [];
  const byCategory: Partial<Record<ScheduleCExpense, number>> = {};
  const seen = new Set<string>();
  for (const d of input.decisions ?? []) {
    const row = byRow.get(d.rowId);
    if (!row) {
      rejected.push({
        rowId: d.rowId,
        reason: 'no such expense row in this file',
      });
      continue;
    }
    if (seen.has(d.rowId)) {
      rejected.push({ rowId: d.rowId, reason: 'decided twice' });
      continue;
    }
    seen.add(d.rowId);
    if (d.category === 'personal') continue;
    byCategory[d.category] = (byCategory[d.category] ?? 0) + row.amount;
  }

  const at = deps.now().toISOString();
  await store.write((data) => {
    const key = `${input.owner}:${rel}`;
    const prev = data.expenseImports[key]?.byCategory ?? {};
    let biz = data.facts.businesses.find((b) => b.owner === input.owner);
    if (!biz) {
      biz = { owner: input.owner, expenses: {} };
      data.facts.businesses.push(biz);
    }
    const cats = new Set([
      ...Object.keys(prev),
      ...Object.keys(byCategory),
    ] as ScheduleCExpense[]);
    for (const c of cats) {
      const next = Math.max(
        0,
        (biz.expenses[c] ?? 0) - (prev[c] ?? 0) + (byCategory[c] ?? 0)
      );
      if (next === 0) delete biz.expenses[c];
      else biz.expenses[c] = next;
      const path = `businesses[${input.owner}].expenses.${c}`;
      data.provenance[path] = {
        source: 'user',
        note: `expenses_import:${rel}`,
        at,
      };
    }
    data.expenseImports[key] = {
      owner: input.owner,
      file: rel,
      byCategory,
      at,
    };
  });

  return {
    file: rel,
    owner: input.owner,
    byCategory,
    total: Object.values(byCategory).reduce((s, v) => s + (v ?? 0), 0),
    rejected,
  };
});

export const definition: ToolDefinition = {
  name: 'expenses_import',
  title: 'Import business expenses from a bank CSV',
  description:
    'Two steps. `propose`: read a bank/card CSV from the inbox and propose a Schedule C category for each money-out row (rule-based, local). Show the rows to the user. `confirm`: send the user’s decisions; the totals go into businesses[owner].expenses. Re-confirming the same file replaces its earlier totals. Amounts are cents.',
  inputSchema,
  handler,
};
