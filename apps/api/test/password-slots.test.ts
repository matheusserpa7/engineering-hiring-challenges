import { scryptSync, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// node:crypto's scrypt is wrapped to count derivations in flight, so the test sees what the
// real password module does rather than what the slot helper does on its own.
const stats = vi.hoisted(() => ({ active: 0, peak: 0 }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const wrapped = (...args: unknown[]): void => {
    const callback = args[args.length - 1] as (error: Error | null, key: Buffer) => void;
    stats.active += 1;
    stats.peak = Math.max(stats.peak, stats.active);
    (actual.scrypt as (...rest: unknown[]) => void)(
      ...args.slice(0, -1),
      (error: Error | null, key: Buffer) => {
        stats.active -= 1;
        callback(error, key);
      },
    );
  };
  return { ...actual, scrypt: wrapped };
});

const { verifyPassword } = await import('../src/auth/password.js');

describe('password derivations in flight', () => {
  it('never exceed two, however many logins arrive together', async () => {
    const salt = randomBytes(16);
    const key = scryptSync('pw', salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = ['scrypt', 1024, 8, 1, salt.toString('base64'), key.toString('base64')].join(
      '$',
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, () => verifyPassword('pw', stored)),
    );

    expect(results.every(Boolean)).toBe(true);
    expect(stats.peak).toBe(2);
  });
});
