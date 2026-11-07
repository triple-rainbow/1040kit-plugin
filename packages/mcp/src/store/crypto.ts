import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** File format: "KIT1" | iv(12) | tag(16) | ciphertext. AES-256-GCM. */
const MAGIC = Buffer.from('KIT1', 'ascii');
const IV_LEN = 12;
const TAG_LEN = 16;
export const KEY_LEN = 32;

export function newKey(): Buffer {
  return randomBytes(KEY_LEN);
}

export function encrypt(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
}

/** Throws on a wrong key, a bad tag, a wrong header or truncation. */
export function decrypt(key: Buffer, file: Buffer, aad: string): Buffer {
  if (key.length !== KEY_LEN) throw new Error('key has the wrong length');
  const head = MAGIC.length + IV_LEN + TAG_LEN;
  if (file.length < head) throw new Error('file is truncated');
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('file is not a 1040kit store');
  }
  const iv = file.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = file.subarray(MAGIC.length + IV_LEN, head);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(file.subarray(head)),
    decipher.final(),
  ]);
}
