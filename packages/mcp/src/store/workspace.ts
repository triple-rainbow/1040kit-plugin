import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { emptyFacts, type TaxYear } from '@1040kit/engine';

import { configDir, homeDir } from '../env.ts';
import { ToolError } from '../envelope.ts';
import { purgeNonEin } from '../pii/vault.ts';
import { decrypt, encrypt, KEY_LEN, newKey } from './crypto.ts';
import type { StoreData, WorkspaceMeta } from './types.ts';

export class StoreError extends ToolError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = 'StoreError';
  }
}

export const keyPath = (workspaceId: string) =>
  join(configDir(), 'keys', `${workspaceId}.key`);
export const metaPath = (ws: string) => join(ws, '.1040kit', 'workspace.json');
export const encPath = (ws: string) => join(ws, '.1040kit', 'return.enc');
export const inboxPath = (ws: string) => join(ws, 'inbox');
export const outputsPath = (ws: string) => join(ws, 'outputs');

export function emptyStoreData(year: TaxYear): StoreData {
  return {
    version: 1,
    facts: emptyFacts(year),
    provenance: {},
    docs: [],
    vault: {},
    answers: {},
    identity: {},
    labels: {},
    expenseImports: {},
  };
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

/** A workspace path, or a bare year ("2025") meaning `<KIT1040_HOME>/2025`. */
export function workspaceDir(input: string): string {
  const s = input.trim();
  return /^\d{4}$/.test(s) ? join(homeDir(), s) : resolve(expandHome(s));
}

export async function readMeta(ws: string): Promise<WorkspaceMeta | null> {
  let raw: string;
  try {
    raw = await readFile(metaPath(ws), 'utf8');
  } catch {
    return null;
  }
  const meta = JSON.parse(raw) as WorkspaceMeta;
  if (!meta?.id || !/^[0-9a-f-]{36}$/.test(meta.id) || meta.version !== 1) {
    throw new StoreError(
      'WORKSPACE_INVALID',
      `${metaPath(ws)} is not a valid 1040kit workspace file`
    );
  }
  return meta;
}

/** Write via tmp + fsync + rename so a crash never leaves a half-written file. */
async function atomicWrite(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.tmp`;
  const fh = await open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

const locks = new Map<string, Promise<unknown>>();

/** Serialize read-modify-write cycles on one store within this process. */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const settled = next.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, settled);
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return next;
}

export interface Store {
  workspace: string;
  meta: WorkspaceMeta;
  read(): Promise<StoreData>;
  /** Read, mutate in place, write back. Never writes over an unreadable store. */
  write<T = void>(mutator: (data: StoreData) => T | Promise<T>): Promise<T>;
}

async function loadKey(meta: WorkspaceMeta): Promise<Buffer> {
  const kp = keyPath(meta.id);
  let key: Buffer;
  try {
    key = await readFile(kp);
  } catch {
    throw new StoreError(
      'STORE_UNREADABLE',
      `The encryption key for this workspace is missing (${kp}). Restore that file from a backup; 1040kit will not overwrite the encrypted return without it.`
    );
  }
  if (key.length !== KEY_LEN) {
    throw new StoreError(
      'STORE_UNREADABLE',
      `The encryption key ${kp} is damaged (wrong length). Restore it from a backup; 1040kit will not overwrite the encrypted return.`
    );
  }
  return key;
}

async function readData(ws: string, meta: WorkspaceMeta): Promise<StoreData> {
  const key = await loadKey(meta);
  const kp = keyPath(meta.id);
  let file: Buffer;
  try {
    file = await readFile(encPath(ws));
  } catch {
    throw new StoreError(
      'STORE_UNREADABLE',
      `The encrypted return ${encPath(ws)} is missing (key: ${kp}).`
    );
  }
  let data: StoreData;
  try {
    data = JSON.parse(decrypt(key, file, meta.id).toString('utf8'));
  } catch (e) {
    throw new StoreError(
      'STORE_UNREADABLE',
      `Cannot decrypt ${encPath(ws)} with the key ${kp} (${(e as Error).message}). The file is damaged or the key does not match; it was left untouched.`
    );
  }
  if (data?.version !== 1 || typeof data.facts !== 'object') {
    throw new StoreError(
      'STORE_UNREADABLE',
      `${encPath(ws)} has an unknown format; it was left untouched.`
    );
  }
  return scrubLegacy({ ...emptyStoreData(meta.taxYear), ...data });
}

/**
 * Bring an older store up to the current shape: new fact lists, and no SSN
 * or account-number tokens (1040kit no longer keeps them). Persisted on the
 * next write.
 */
function scrubLegacy(data: StoreData): StoreData {
  data.facts = { ...emptyFacts(data.facts.taxYear), ...data.facts };
  const removed = new Set(purgeNonEin(data.vault));
  const facts = data.facts as unknown as Record<string, unknown>;
  for (const p of [
    data.facts.taxpayer,
    data.facts.spouse,
    ...data.facts.dependents,
  ]) {
    if (p) delete (p as unknown as Record<string, unknown>).ssnToken;
  }
  for (const list of Object.values(facts)) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      for (const [k, v] of Object.entries(item)) {
        if (typeof v === 'string' && removed.has(v)) delete item[k];
      }
    }
  }
  const oos = data.facts.outOfScope as Record<string, unknown> | undefined;
  if (oos) {
    delete oos.rentalIncome;
    delete oos.studentLoanInterest;
  }
  for (const k of Object.keys(data.provenance)) {
    if (/\.ssnToken$|^outOfScope\.(rentalIncome|studentLoanInterest)$/.test(k))
      delete data.provenance[k];
  }
  return data;
}

async function writeData(
  ws: string,
  meta: WorkspaceMeta,
  data: StoreData
): Promise<void> {
  const key = await loadKey(meta);
  const buf = encrypt(key, Buffer.from(JSON.stringify(data), 'utf8'), meta.id);
  await atomicWrite(encPath(ws), buf);
}

export async function openStore(workspace: string): Promise<Store> {
  const ws = workspaceDir(workspace);
  const meta = await readMeta(ws);
  if (!meta) {
    throw new StoreError(
      'WORKSPACE_NOT_FOUND',
      `No 1040kit workspace at ${ws}. Run workspace_init first.`
    );
  }
  return {
    workspace: ws,
    meta,
    read: () => readData(ws, meta),
    write: (mutator) =>
      withLock(ws, async () => {
        const data = await readData(ws, meta);
        const out = await mutator(data);
        await writeData(ws, meta, data);
        return out;
      }),
  };
}

async function isEmptyDir(dir: string): Promise<boolean> {
  const entries = await readdir(dir);
  return entries.filter((e) => e !== '.DS_Store').length === 0;
}

export interface InitResult {
  workspace: string;
  inbox: string;
  outputs: string;
  created: boolean;
  meta: WorkspaceMeta;
}

export async function initWorkspace(
  year: TaxYear,
  path: string | undefined,
  now: Date
): Promise<InitResult> {
  const ws = path ? workspaceDir(path) : join(homeDir(), String(year));
  const existing = await readMeta(ws);

  if (existing) {
    if (existing.taxYear !== year) {
      throw new StoreError(
        'WORKSPACE_CONFLICT',
        `${ws} is a ${existing.taxYear} workspace, not ${year}.`
      );
    }
    await mkdir(inboxPath(ws), { recursive: true });
    await mkdir(outputsPath(ws), { recursive: true });
    if (existsSync(encPath(ws))) {
      await readData(ws, existing); // throws STORE_UNREADABLE; never repaired here
    } else {
      // Nothing to lose: recreate the key if needed and an empty store.
      if (!existsSync(keyPath(existing.id))) await createKey(existing.id);
      await writeData(ws, existing, emptyStoreData(year));
    }
    return {
      workspace: ws,
      inbox: inboxPath(ws),
      outputs: outputsPath(ws),
      created: false,
      meta: existing,
    };
  }

  if (existsSync(ws) && !(await isEmptyDir(ws))) {
    throw new StoreError(
      'WORKSPACE_CONFLICT',
      `${ws} already exists and is not a 1040kit workspace. Pick an empty folder.`
    );
  }

  const meta: WorkspaceMeta = {
    id: randomUUID(),
    taxYear: year,
    createdAt: now.toISOString(),
    version: 1,
  };
  await mkdir(join(ws, '.1040kit'), { recursive: true });
  await mkdir(inboxPath(ws), { recursive: true });
  await mkdir(outputsPath(ws), { recursive: true });
  await createKey(meta.id);
  await writeFile(metaPath(ws), JSON.stringify(meta, null, 2) + '\n');
  await writeData(ws, meta, emptyStoreData(year));
  return {
    workspace: ws,
    inbox: inboxPath(ws),
    outputs: outputsPath(ws),
    created: true,
    meta,
  };
}

async function createKey(id: string): Promise<void> {
  const kp = keyPath(id);
  await mkdir(dirname(kp), { recursive: true, mode: 0o700 });
  await chmod(dirname(kp), 0o700);
  await writeFile(kp, newKey(), { mode: 0o600, flag: 'wx' });
  await chmod(kp, 0o600);
}
