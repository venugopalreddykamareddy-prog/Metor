import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

/** Format: scrypt:N:r:p:<salt base64>:<key base64> */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(passphrase, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join(':');
}

export interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

export function parsePassphraseHash(value: string): ParsedHash {
  const [scheme, n, r, p, salt, key] = value.split(':');
  const parsed = {
    n: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt ?? '', 'base64'),
    key: Buffer.from(key ?? '', 'base64'),
  };
  const valid =
    scheme === 'scrypt' &&
    [parsed.n, parsed.r, parsed.p].every((x) => Number.isInteger(x) && x > 0) &&
    parsed.salt.length >= 16 &&
    parsed.key.length === KEY_LENGTH;
  if (!valid) throw new Error('APP_PASSPHRASE_HASH is malformed; generate it with `pnpm hash-passphrase`');
  return parsed;
}

export async function verifyPassphrase(passphrase: string, hash: ParsedHash): Promise<boolean> {
  const key = await scryptAsync(passphrase, hash.salt, hash.key.length, { N: hash.n, r: hash.r, p: hash.p });
  return timingSafeEqual(key, hash.key);
}
