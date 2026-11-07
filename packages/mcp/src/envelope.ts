import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { Deps } from './deps.ts';
import { redactPii, redactString } from './pii/redact.ts';

export type Envelope<T extends object = Record<string, unknown>> =
  ({ ok: true } & T) | { ok: false; error: { code: string; message: string } };

/** A failure the agent should see as `{ ok: false, error }`. */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function errorEnvelope(e: unknown): {
  ok: false;
  error: { code: string; message: string };
} {
  if (e instanceof ToolError) {
    return { ok: false, error: { code: e.code, message: e.message } };
  }
  if (e instanceof z.ZodError) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: e.issues
          .map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`)
          .join('; '),
      },
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { ok: false, error: { code: 'INTERNAL_ERROR', message } };
}

export type Handler<S extends z.ZodRawShape, T extends object> = (
  input: z.input<z.ZodObject<S>>,
  deps: Deps
) => Promise<Envelope<T>>;

/**
 * Wraps a tool body: validates input, catches errors, and redacts the whole
 * response. What a handler returns is exactly what the model sees.
 */
export function defineTool<S extends z.ZodRawShape, T extends object>(
  shape: S,
  run: (input: z.output<z.ZodObject<S>>, deps: Deps) => Promise<T>
): Handler<S, T> {
  const schema = z.object(shape);
  return async (input, deps) => {
    let env: Envelope<T>;
    try {
      const parsed = schema.parse(input ?? {});
      const data = await run(parsed, deps);
      env = { ok: true, ...data } as Envelope<T>;
    } catch (e) {
      env = errorEnvelope(e);
    }
    return redactPii(env) as Envelope<T>;
  };
}

export function toCallToolResult(env: Envelope<object>): CallToolResult {
  const safe = redactPii(env) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: redactString(JSON.stringify(safe)) }],
    structuredContent: safe,
    ...(env.ok ? {} : { isError: true }),
  };
}
