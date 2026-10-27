import { randomBytes, scryptSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_CONCURRENT_HASHES,
  createSlots,
  hashPassword,
  verifyPassword,
} from '../src/auth/password.js';

const CHEAP_N = 1024;

// Builds a stored value without the module under test, so the parser is checked
// against an independent encoder.
interface HandMadeOptions {
  n?: number;
  r?: number;
  p?: number;
  keyLen?: number;
  deriveN?: number;
}

function handMade(password: string, options: HandMadeOptions = {}): string {
  const { n = CHEAP_N, r = 8, p = 1, keyLen = 32 } = options;
  const deriveN = options.deriveN ?? n;
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFC'), salt, keyLen, {
    N: deriveN,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });
  return ['scrypt', n, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

describe('password hashing', () => {
  const password = 'correct horse battery staple';
  let hashA: string;
  let hashB: string;

  beforeAll(async () => {
    hashA = await hashPassword(password);
    hashB = await hashPassword(password);
  }, 30_000);

  it('verifies the password that was hashed', async () => {
    await expect(verifyPassword(password, hashA)).resolves.toBe(true);
  });

  it.each([
    ['a different password', 'wrong password'],
    ['a case change', 'Correct horse battery staple'],
    ['a trailing space', 'correct horse battery staple '],
    ['an empty password', ''],
  ])('rejects %s', async (_label, attempt) => {
    await expect(verifyPassword(attempt, hashA)).resolves.toBe(false);
  });

  it('salts every hash, and both hashes of one password verify', async () => {
    expect(hashA).not.toBe(hashB);
    await expect(verifyPassword(password, hashA)).resolves.toBe(true);
    await expect(verifyPassword(password, hashB)).resolves.toBe(true);
  });

  it('stores scrypt$131072$8$1$salt(16 bytes)$key(32 bytes)', () => {
    const parts = hashA.split('$');
    expect(parts).toHaveLength(6);
    const [prefix, n, r, p, salt, key] = parts;
    expect(prefix).toBe('scrypt');
    expect([n, r, p]).toEqual(['131072', '8', '1']);
    expect(Buffer.from(salt ?? '', 'base64')).toHaveLength(16);
    expect(Buffer.from(key ?? '', 'base64')).toHaveLength(32);
  });

  describe('parameters come from the stored value', () => {
    it('accepts the right password and rejects the wrong one for a cheap hand-made hash', async () => {
      const stored = handMade('hunter2');
      await expect(verifyPassword('hunter2', stored)).resolves.toBe(true);
      await expect(verifyPassword('hunter3', stored)).resolves.toBe(false);
    });

    it('honours a non-default r and p', async () => {
      const stored = handMade('hunter2', { r: 4, p: 2 });
      await expect(verifyPassword('hunter2', stored)).resolves.toBe(true);
    });

    it('rejects a key derived with other parameters than the stored value claims', async () => {
      const stored = handMade('hunter2', { n: 2048, deriveN: 1024 });
      await expect(verifyPassword('hunter2', stored)).resolves.toBe(false);
    });
  });

  describe('unicode', () => {
    it('round-trips accents, Portuguese and emoji', async () => {
      const unicode = 'senha-ação-😀';
      const stored = await hashPassword(unicode);
      await expect(verifyPassword(unicode, stored)).resolves.toBe(true);
    });

    it('treats NFC and NFD forms of the same text as the same password', async () => {
      // Escapes, so no editor or formatter can normalise the two forms into one.
      const nfc = 'caf\u00e9';
      const nfd = 'cafe\u0301';
      expect(nfc).not.toBe(nfd);
      const stored = await hashPassword(nfc);
      await expect(verifyPassword(nfd, stored)).resolves.toBe(true);
      const storedNfd = await hashPassword(nfd);
      await expect(verifyPassword(nfc, storedNfd)).resolves.toBe(true);
    });
  });

  // Length rules belong to the login schema; the hash layer only has to be consistent.
  it('hashes the empty password and verifies it only against the empty password', async () => {
    const stored = await hashPassword('');
    await expect(verifyPassword('', stored)).resolves.toBe(true);
    await expect(verifyPassword(' ', stored)).resolves.toBe(false);
    await expect(verifyPassword('x', stored)).resolves.toBe(false);
  });

  describe('a malformed stored value is false, never a throw', () => {
    const good = handMade('pw');
    const [, , , , salt = '', key = ''] = good.split('$');
    const withParts = (parts: (string | number)[]): string => parts.join('$');

    const cases: [string, string][] = [
      ['an empty string', ''],
      ['plain text', 'plaintext'],
      ['a different scheme prefix', withParts(['bcrypt', CHEAP_N, 8, 1, salt, key])],
      ['an empty prefix', withParts(['', CHEAP_N, 8, 1, salt, key])],
      ['too few parts', withParts(['scrypt', CHEAP_N, 8, 1, salt])],
      ['too many parts', `${good}$extra`],
      ['a non-numeric N', withParts(['scrypt', 'abc', 8, 1, salt, key])],
      ['a non-numeric r', withParts(['scrypt', CHEAP_N, 'x', 1, salt, key])],
      ['a non-numeric p', withParts(['scrypt', CHEAP_N, 8, 'x', salt, key])],
      ['a fractional N', withParts(['scrypt', '1024.5', 8, 1, salt, key])],
      ['an exponent-notation N', withParts(['scrypt', '1e3', 8, 1, salt, key])],
      ['an empty N', withParts(['scrypt', '', 8, 1, salt, key])],
      ['N = 0', withParts(['scrypt', 0, 8, 1, salt, key])],
      ['N = 1', withParts(['scrypt', 1, 8, 1, salt, key])],
      ['N that is not a power of two', withParts(['scrypt', 1000, 8, 1, salt, key])],
      ['a negative N', withParts(['scrypt', -1024, 8, 1, salt, key])],
      ['a negative r', withParts(['scrypt', CHEAP_N, -8, 1, salt, key])],
      ['r = 0', withParts(['scrypt', CHEAP_N, 0, 1, salt, key])],
      ['a negative p', withParts(['scrypt', CHEAP_N, 8, -1, salt, key])],
      ['p = 0', withParts(['scrypt', CHEAP_N, 8, 0, salt, key])],
      ['an empty salt', withParts(['scrypt', CHEAP_N, 8, 1, '', key])],
      ['an empty key', withParts(['scrypt', CHEAP_N, 8, 1, salt, ''])],
      // Deriving with the stored length would make this 20-character prefix a real prefix of
      // the right key, and it would verify. Only the fixed 32-byte rule rejects it.
      ['a key shorter than 32 bytes', withParts(['scrypt', CHEAP_N, 8, 1, salt, key.slice(0, 20)])],
      [
        'a key longer than 32 bytes',
        withParts(['scrypt', CHEAP_N, 8, 1, salt, Buffer.alloc(64, 1).toString('base64')]),
      ],
      // Valid base64 plus one stray character decodes to the same bytes as the real value, so
      // only the round-trip check in decodeBase64 can reject these.
      ['a stray character after the salt', withParts(['scrypt', CHEAP_N, 8, 1, `${salt}!`, key])],
      ['a stray character after the key', withParts(['scrypt', CHEAP_N, 8, 1, salt, `${key}!`])],
      [
        'a space inside the key',
        withParts(['scrypt', CHEAP_N, 8, 1, salt, `${key.slice(0, 10)} ${key.slice(10)}`]),
      ],
      ['a newline after the key', withParts(['scrypt', CHEAP_N, 8, 1, salt, `${key}\n`])],
      [
        'the key with its padding stripped',
        withParts(['scrypt', CHEAP_N, 8, 1, salt, key.replace(/=+$/, '')]),
      ],
      ['non-base64 junk in the salt', withParts(['scrypt', CHEAP_N, 8, 1, '!!!@@@###', key])],
      ['non-base64 junk in the key', withParts(['scrypt', CHEAP_N, 8, 1, salt, '!!!@@@###'])],
    ];

    it.each(cases)('%s', async (_label, stored) => {
      await expect(verifyPassword('pw', stored)).resolves.toBe(false);
    });

    it.each([
      ['a lone surrogate', 'pw\ud800'],
      ['a NUL byte', 'p\u0000w'],
    ])('does not throw for a password with %s', async (_label, password) => {
      await expect(verifyPassword(password, good)).resolves.toBe(false);
    });

    it('sanity: the unmodified building block does verify', async () => {
      await expect(verifyPassword('pw', good)).resolves.toBe(true);
    });
  });

  it('returns false promptly for an absurdly large N instead of allocating gigabytes', async () => {
    const stored = handMade('pw');
    const [, , , , salt = '', key = ''] = stored.split('$');
    const hostile = ['scrypt', 2 ** 30, 8, 1, salt, key].join('$');

    const started = performance.now();
    const result = await verifyPassword('pw', hostile);
    const elapsedMs = performance.now() - started;

    expect(result).toBe(false);
    expect(elapsedMs).toBeLessThan(2000);
  }, 10_000);
});

describe('createSlots', () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('runs at most two scrypt derivations at a time in production', () => {
    // Each derivation holds 128 MiB, and libuv's four threads are shared with DNS lookups.
    expect(MAX_CONCURRENT_HASHES).toBe(2);
  });

  it('never runs more tasks than it has slots, and starts them in arrival order', async () => {
    const run = createSlots(2);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const task = (id: number) => async () => {
      started.push(id);
      active += 1;
      peak = Math.max(peak, active);
      await sleep(15);
      active -= 1;
      return id;
    };

    const results = await Promise.all([1, 2, 3, 4, 5].map((id) => run(task(id))));

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(started).toEqual([1, 2, 3, 4, 5]);
  });

  it('frees the slot when a task rejects, so the queue does not stall', async () => {
    const run = createSlots(1);
    const failing = run(() => Promise.reject(new Error('boom')));
    const next = run(() => Promise.resolve('ok'));

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
