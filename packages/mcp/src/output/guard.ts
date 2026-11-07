import { ToolError } from '../envelope.ts';

/**
 * Refuse to write a text output that contains any real SSN/EIN/account number
 * from the vault (with or without dashes or spaces). Only the PDF may hold them.
 */
export function assertNoVaultValues(
  text: string,
  vault: Record<string, string>,
  file: string
): void {
  for (const value of Object.values(vault)) {
    const digits = value.replace(/[^0-9A-Za-z]/g, '');
    if (digits.length < 4) continue;
    const re = new RegExp(
      digits
        .split('')
        .map((c) => c.replace(/[^0-9A-Za-z]/, ''))
        .join('[\\s-]?'),
      'i'
    );
    if (text.includes(value) || re.test(text)) {
      throw new ToolError(
        'PII_IN_OUTPUT',
        `Refusing to write ${file}: it would contain a protected number.`
      );
    }
  }
}
