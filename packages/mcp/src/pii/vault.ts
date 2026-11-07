/**
 * Token vault. Real EINs (employer / payer / lender) live only here, inside
 * the encrypted store; the model sees `{{EIN:w2_1}}`-style tokens.
 * `resolve` is called only by forms_fill.
 *
 * 1040kit never stores SSNs, ITINs or bank account numbers: extraction
 * discards them and the user writes or types them in themselves.
 */

export type PiiKind = 'EIN';

export function makeToken(kind: PiiKind, ownerKey: string): string {
  return `{{${kind}:${ownerKey}}}`;
}

const TOKEN_RE = /^\{\{(EIN):([A-Za-z0-9_]+)\}\}$/;

export function isToken(s: unknown): s is string {
  return typeof s === 'string' && TOKEN_RE.test(s);
}

export function parseToken(
  token: string
): { kind: PiiKind; ownerKey: string } | null {
  const m = TOKEN_RE.exec(token);
  return m ? { kind: m[1] as PiiKind, ownerKey: m[2]! } : null;
}

/** EIN shape: two digits, dash, seven digits (an SSN is 3-2-4). */
export const isEinShaped = (v: string) => /^\d{2}-\d{7}$/.test(v.trim());

export class Vault {
  constructor(private readonly data: Record<string, string>) {}

  tokenize(kind: PiiKind, ownerKey: string, value: string): string {
    if (!isEinShaped(value)) {
      throw new Error('Only EINs are kept; refusing to store this number.');
    }
    const token = makeToken(kind, ownerKey);
    this.data[token] = value.trim();
    return token;
  }

  has(token: string): boolean {
    return Object.hasOwn(this.data, token);
  }

  /** Real value. Only forms_fill may call this. */
  resolve(token: string): string {
    const v = this.data[token];
    if (v === undefined) throw new Error(`Unknown PII token ${token}`);
    return v;
  }

  delete(token: string): void {
    delete this.data[token];
  }
}

/**
 * Drop anything but EINs from a vault (older workspaces kept SSN and
 * account-number tokens). Returns the tokens removed.
 */
export function purgeNonEin(data: Record<string, string>): string[] {
  const removed: string[] = [];
  for (const [token, value] of Object.entries(data)) {
    if (isToken(token) && isEinShaped(value)) continue;
    delete data[token];
    removed.push(token);
  }
  return removed;
}
