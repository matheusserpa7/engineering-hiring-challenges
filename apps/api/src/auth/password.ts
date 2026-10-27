import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// ADR 0004. N = 2^17 needs 128 * N * r bytes = 128 MiB, and Node's default maxmem is 32 MiB,
// so the limit is raised. The same limit makes scrypt refuse absurd parameters in a stored
// value before it allocates them.
const N = 2 ** 17;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_MEMORY_BYTES = 256 * 1024 * 1024;

// scrypt$N$r$p$salt$key: the parameters travel with the hash, so they can change later
// without breaking the hashes already stored.
const STORED_FORMAT = /^scrypt\$([1-9]\d*)\$([1-9]\d*)\$([1-9]\d*)\$([^$]+)\$([^$]+)$/;

// Each derivation holds 128 MiB, and libuv's four threads are shared with the DNS lookups the
// database pool needs. Two at a time bounds the memory at 256 MiB and leaves threads free; the
// rest wait in arrival order (tech spec 005 F7).
export const MAX_CONCURRENT_HASHES = 2;

export function createSlots(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const hashSlots = createSlots(MAX_CONCURRENT_HASHES);

function derive(
  password: string,
  salt: Buffer,
  keyLength: number,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return hashSlots(
    () =>
      new Promise((resolve, reject) => {
        // NFC so the same typed password gives the same hash on any keyboard or OS.
        scrypt(
          password.normalize('NFC'),
          salt,
          keyLength,
          { ...cost, maxmem: MAX_MEMORY_BYTES },
          (error, key) => {
            if (error) reject(error);
            else resolve(key);
          },
        );
      }),
  );
}

// Node's base64 decoder skips characters it doesn't know. Encoding the result again and
// comparing catches junk and non-canonical padding.
function decodeBase64(value: string): Buffer | null {
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

// Returns false for anything it can't use, never throws: a corrupt row must read as "wrong
// password", not as a 500 that tells an attacker which accounts have a broken hash.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = STORED_FORMAT.exec(stored);
  if (!match) return false;
  // The pattern guarantees all five groups exist and are non-empty.
  const [, n, r, p, saltText = '', keyText = ''] = match;
  const salt = decodeBase64(saltText);
  const key = decodeBase64(keyText);
  // scrypt output is prefix-consistent, so a truncated key would still match its own first
  // bytes and quietly weaken the check. The format carries no key length: it is fixed.
  if (!salt || !key || key.length !== KEY_BYTES) return false;

  try {
    const candidate = await derive(password, salt, KEY_BYTES, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(candidate, key);
  } catch {
    // scrypt throws for parameters it won't run: N not a power of two, or more memory than
    // MAX_MEMORY_BYTES. This also hides a host with too little memory for the real hash, which
    // would make every login read as a wrong password. Spec 005 sets a memory floor for the
    // container and watches the login failure rate.
    return false;
  }
}
