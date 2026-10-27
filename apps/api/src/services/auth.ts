import { createHash, randomBytes } from 'node:crypto';
import type { LoginRequest, SessionUser } from '@aangan/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { createSession, findAccountByEmail } from '../repositories/sessions.js';

export interface AuthSettings {
  // Verified in place of a real hash when the email is unknown or the account has no password,
  // so every failing login spends one scrypt and takes the same time.
  dummyHash: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  // Injected so a test can count calls; production passes the real one.
  verifyPassword: (password: string, stored: string) => Promise<boolean>;
}

export interface AuthDeps {
  db: Kysely<Database>;
  auth: AuthSettings;
}

// The token is 256 random bits, so there is nothing to brute-force and a fast hash is enough:
// a stolen sessions table holds no usable token. 32 bytes in base64url is 43 characters.
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export type LoginResult =
  { ok: true; token: string; user: SessionUser } | { ok: false; donorId: string | undefined };

export async function login(
  { db, auth }: AuthDeps,
  { email, password }: LoginRequest,
): Promise<LoginResult> {
  const account = await findAccountByEmail(db, email);
  // Exactly one derivation on every path, so timing does not separate "no such account" from
  // "wrong password".
  const matches = await auth.verifyPassword(password, account?.passwordHash ?? auth.dummyHash);
  if (!account?.passwordHash || !matches) return { ok: false, donorId: account?.id };

  const token = randomBytes(32).toString('base64url');
  await createSession(db, {
    donorId: account.id,
    tokenHash: hashToken(token),
    ttlHours: auth.sessionTtlHours,
  });
  return {
    ok: true,
    token,
    user: { id: account.id, email: account.email, fullName: account.fullName, role: account.role },
  };
}
