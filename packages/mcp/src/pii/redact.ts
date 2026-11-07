/**
 * Output redaction. Every tool response and every outbound KB query passes
 * through here, so nothing shaped like an SSN, ITIN, EIN or account number
 * reaches the model. `{{KIND:owner}}` tokens are left alone.
 */

export const REDACTED = '[REDACTED]';

const TOKEN_RE = /\{\{[A-Z]+:[A-Za-z0-9_]+\}\}/g;
const PATTERNS: RegExp[] = [
  /\b\d{3}-?\d{2}-?\d{4}\b/g, // SSN / ITIN
  /\b\d{2}-\d{7}\b/g, // EIN
  /\b\d{8,17}\b/g, // account-number runs
];

function redactPlain(s: string): string {
  let out = s;
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export function redactString(s: string): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(TOKEN_RE)) {
    out += redactPlain(s.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + redactPlain(s.slice(last));
}

/** Deep copy of `value` with every string (and object key) redacted. */
export function redactPii(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactPii);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[redactString(k)] = redactPii(v);
    }
    return out;
  }
  return value;
}

export function containsPii(s: string): boolean {
  return redactString(s) !== s;
}
