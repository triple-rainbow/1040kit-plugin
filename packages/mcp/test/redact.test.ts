import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

import { defineTool, toCallToolResult } from '../src/envelope.ts';
import { redactPii } from '../src/pii/redact.ts';
import { purgeNonEin, Vault } from '../src/pii/vault.ts';
import { fakeDeps } from './helpers.ts';

test('redacts SSN, ITIN, EIN and account numbers', () => {
  const out = redactPii({
    a: 'ssn 123-45-6789 and 123456789',
    b: ['itin 912-70-1234', { c: 'ein 12-3456789' }],
    d: 'acct 000123456789012',
    e: 42,
    f: true,
    g: null,
  }) as any;
  assert.equal(out.a, 'ssn [REDACTED] and [REDACTED]');
  assert.equal(out.b[0], 'itin [REDACTED]');
  assert.equal(out.b[1].c, 'ein [REDACTED]');
  assert.equal(out.d, 'acct [REDACTED]');
  assert.equal(out.e, 42);
  assert.equal(out.f, true);
  assert.equal(out.g, null);
});

test('leaves dates, amounts and short numbers alone', () => {
  const s = 'On 2025-01-15 I earned $52,345.67, box 12a code D 1234';
  assert.equal(redactPii(s), s);
});

test('tokens survive redaction', () => {
  const s =
    'employee {{SSN:taxpayer}} employer {{EIN:w2_1}} acct {{ACCT:int_1}}';
  assert.equal(redactPii(s), s);
});

test('redacts object keys too', () => {
  const out = redactPii({ '123-45-6789': 1 }) as Record<string, number>;
  assert.deepEqual(Object.keys(out), ['[REDACTED]']);
});

test('every tool response is redacted', async () => {
  const handler = defineTool({}, async () => ({ msg: 'ssn 123-45-6789' }));
  const env = await handler({}, fakeDeps());
  const result = toCallToolResult(env);
  const text = (result.content[0] as { text: string }).text;
  assert.ok(text.includes('[REDACTED]'), text);
  assert.ok(!text.includes('6789'), text);
  assert.ok(!JSON.stringify(result.structuredContent).includes('6789'));
});

test('errors are redacted and enveloped', async () => {
  const handler = defineTool({}, async () => {
    throw new Error('bad value 123-45-6789');
  });
  const env = await handler({}, fakeDeps());
  assert.equal(env.ok, false);
  assert.ok(!JSON.stringify(env).includes('6789'));
});

test('invalid input is a soft error', async () => {
  const handler = defineTool({ n: z.number() }, async ({ n }) => ({ n }));
  const env = await handler({ n: 'x' } as any, fakeDeps());
  assert.equal(env.ok, false);
  assert.equal(!env.ok && env.error.code, 'INVALID_INPUT');
});

test('vault keeps EINs only', () => {
  const data: Record<string, string> = {};
  const v = new Vault(data);
  const t = v.tokenize('EIN', 'w2_1', '12-3456789');
  assert.equal(t, '{{EIN:w2_1}}');
  assert.equal(v.resolve(t), '12-3456789');
  assert.throws(() => v.resolve('{{EIN:w2_2}}'));
  // an SSN-shaped value is refused
  assert.throws(() => v.tokenize('EIN', 'nec_1', '123-45-6789'));
  assert.deepEqual(Object.keys(data), ['{{EIN:w2_1}}']);
});

test('purgeNonEin drops SSN and account tokens from an old vault', () => {
  const data: Record<string, string> = {
    '{{SSN:taxpayer}}': '123-45-6789',
    '{{ACCT:int_1}}': '0000987654321',
    '{{EIN:w2_1}}': '12-3456789',
    '{{EIN:nec_1}}': '987-65-4320',
  };
  assert.deepEqual(purgeNonEin(data).sort(), [
    '{{ACCT:int_1}}',
    '{{EIN:nec_1}}',
    '{{SSN:taxpayer}}',
  ]);
  assert.deepEqual(data, { '{{EIN:w2_1}}': '12-3456789' });
});
