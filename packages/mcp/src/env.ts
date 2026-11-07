import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Workspace root (default ~/Taxes). Read at call time so tests can swap it. */
export function homeDir(): string {
  const v = process.env.KIT1040_HOME;
  return v ? resolve(v) : join(homedir(), 'Taxes');
}

/** Keys + cache (default ~/.1040kit). Kept outside the workspace on purpose. */
export function configDir(): string {
  const v = process.env.KIT1040_CONFIG_DIR;
  return v ? resolve(v) : join(homedir(), '.1040kit');
}

export function kbUrl(): string {
  return process.env.KIT1040_KB_URL || 'https://api.1040kit.com/kb/search';
}
