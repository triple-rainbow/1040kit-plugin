import type { TaxYear } from '@1040kit/engine';
import { z } from 'zod';

import type { Handler } from '../envelope.ts';
import type { ToolName } from '../tool-names.ts';

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: Handler<any, any>;
  /** MCP Apps widget the host may draw for this tool's result (src/ui). */
  ui?: { resourceUri: string };
}

export const taxYearSchema = z
  .union([z.literal(2025), z.literal(2026)])
  .describe('Tax year (2025 or 2026).');

export type { TaxYear };

export const workspaceSchema = z
  .string()
  .min(1)
  .describe(
    'Workspace folder returned by workspace_init, or just the tax year (e.g. "2025").'
  );
