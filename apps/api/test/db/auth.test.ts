import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SessionResponseSchema } from '@aangan/shared';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';
import { createApp } from '../../src/app.js';
import { createDb, type Database } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { loadSeed, runSeed } from '../../src/db/seed/seed.js';
import { createLogger } from '../../src/logger.js';
import { testIntake } from '../intake.js';

const SEED_DIR = fileURLToPath(
  new URL('../../../../roles/full-stack-engineer/seed', import.meta.url),
);

const ADMIN = { email: 'admin@himalayacc.example', password: 'admin12345' };
const DONOR = { email: 'donor@himalayacc.example', password: 'donor12345' };
const OTHER = { email: 'other@himalayacc.example', password: 'other12345' };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let pool: pg.Pool;
let db: Kysely<Database>;
let dummyHash: string;
let guestEmail: string;

const verifier = vi.fn(verifyPassword);

function build(
  options: { loginRateLimit?: number; logger?: ReturnType<typeof createLogger> } = {},
) {
  return createApp({
    logger: options.logger ?? createLogger('silent'),
    pingDb: () => Promise.resolve(),
    db,
    intake: testIntake,
    security: {
      allowedOrigins: ['http://localhost:3000'],
      loginRateLimit: options.loginRateLimit ?? 1000,
    },
    auth: { dummyHash, sessionTtlHours: 8, cookieSecure: true, verifyPassword: verifier },
  });
}

let app: ReturnType<typeof build>;

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  await pool.query('ALTER SEQUENCE receipt_number_seq RESTART');
  await runSeed(db, loadSeed(SEED_DIR));
  dummyHash = await hashPassword(randomBytes(32).toString('base64'));
  const guest = await pool.query<{ email: string }>(
    'SELECT email FROM donors WHERE password_hash IS NULL LIMIT 1',
  );
  guestEmail = guest.rows[0]?.email ?? '';
  expect(guestEmail).not.toBe('');
  app = build();
}, 60_000);

beforeEach(async () => {
  verifier.mockClear();
  await pool.query('TRUNCATE sessions');
});

afterAll(async () => {
  await db.destroy();
});

const login = (credentials: object, target = app) =>
  request(target).post('/api/auth/login').send(credentials);

function setCookieOf(res: request.Response): string {
  const header: unknown = res.headers['set-cookie'];
  const first: unknown = Array.isArray(header) ? header[0] : header;
  return typeof first === 'string' ? first : '';
}

function tokenOf(res: request.Response): string {
  return /^aangan_session=([^;]*)/.exec(setCookieOf(res))?.[1] ?? '';
}

const cookie = (token: string) => `aangan_session=${token}`;

async function signIn(credentials = DONOR): Promise<string> {
  const res = await login(credentials);
  expect(res.status).toBe(200);
  return tokenOf(res);
}

describe('POST /api/auth/login', () => {
  it('signs in a seeded account and returns the user, never the hash', async () => {
    const res = await login(ADMIN);

    expect(res.status).toBe(200);
    const body = SessionResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({ email: ADMIN.email, role: 'admin' });
    expect(JSON.stringify(res.body)).not.toMatch(/scrypt|password/i);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets a cookie that is HttpOnly, Secure, SameSite=Strict, scoped to / and lasts 8 hours', async () => {
    const res = await login(DONOR);
    const header = setCookieOf(res);

    expect(header).toMatch(/^aangan_session=[A-Za-z0-9_-]{43};/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=28800');
  });

  it('stores only the SHA-256 of the token, with an expiry about 8 hours away', async () => {
    const token = tokenOf(await login(DONOR));

    const raw = await pool.query('SELECT count(*)::int AS n FROM sessions WHERE token_hash = $1', [
      token,
    ]);
    expect((raw.rows[0] as { n: number }).n).toBe(0);

    const stored = await pool.query<{ ttl_minutes: number }>(
      `SELECT round(extract(epoch FROM expires_at - now()) / 60)::int AS ttl_minutes
         FROM sessions WHERE token_hash = $1`,
      [sha256(token)],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.ttl_minutes).toBeGreaterThanOrEqual(8 * 60 - 1);
    expect(stored.rows[0]?.ttl_minutes).toBeLessThanOrEqual(8 * 60);
  });

  it('gives every login its own token', async () => {
    const first = tokenOf(await login(DONOR));
    const second = tokenOf(await login(DONOR));
    expect(first).not.toBe(second);
  });

  it('answers a wrong password, an unknown email and a guest with the same bytes', async () => {
    const wrong = await login({ email: DONOR.email, password: 'not-the-password' });
    const unknown = await login({ email: 'nobody@example.org', password: 'whatever1' });
    const guest = await login({ email: guestEmail, password: 'whatever1' });

    for (const res of [wrong, unknown, guest]) {
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(wrong.text).toBe(unknown.text);
    expect(wrong.text).toBe(guest.text);
    expect(JSON.parse(wrong.text)).toMatchObject({ error: { code: 'invalid_credentials' } });
  });

  // The unknown-email and guest paths must spend the same scrypt as a wrong password, or the
  // response time tells an attacker which emails have an account (docs/04).
  it('runs exactly one password derivation on every failing path', async () => {
    const attempts: [string, object][] = [
      ['a wrong password', { email: DONOR.email, password: 'not-the-password' }],
      ['an unknown email', { email: 'nobody@example.org', password: 'whatever1' }],
      ['a guest with no password', { email: guestEmail, password: 'whatever1' }],
    ];
    for (const [, credentials] of attempts) {
      verifier.mockClear();
      await login(credentials);
      expect(verifier).toHaveBeenCalledTimes(1);
    }
  });

  it('verifies an unknown email against the dummy hash, never against an empty value', async () => {
    await login({ email: 'nobody@example.org', password: 'whatever1' });
    expect(verifier).toHaveBeenCalledWith('whatever1', dummyHash);
  });

  it('takes about as long for an unknown email as for a wrong password', async () => {
    const median = async (credentials: object) => {
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        await login(credentials);
        times.push(performance.now() - start);
      }
      return times.sort((a, b) => a - b)[1] ?? 0;
    };
    const wrong = await median({ email: DONOR.email, password: 'not-the-password' });
    const unknown = await median({ email: 'nobody@example.org', password: 'whatever1' });

    // Skipping the derivation makes the unknown path ~100 times faster, far outside this band.
    expect(unknown / wrong).toBeGreaterThan(0.5);
    expect(unknown / wrong).toBeLessThan(2);
  }, 30_000);

  it.each([
    ['a role the client chose', { ...DONOR, role: 'admin' }],
    ['no password', { email: DONOR.email }],
    ['an empty password', { email: DONOR.email, password: '' }],
    ['a malformed email', { email: 'nope', password: 'x' }],
    ['an array body', [DONOR]],
  ])('refuses %s with 422 before any password is checked', async (_label, body) => {
    const res = await login(body);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
    expect(verifier).not.toHaveBeenCalled();
  });

  it('refuses a login from an unlisted origin', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send(DONOR);
    expect(res.status).toBe(403);
    expect(verifier).not.toHaveBeenCalled();
  });

  it('removes this donor’s expired sessions and nobody else’s', async () => {
    const ids = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM donors WHERE email = ANY($1)',
      [[DONOR.email, OTHER.email]],
    );
    const idOf = (email: string) => ids.rows.find((row) => row.email === email)?.id;
    for (const [label, email] of [
      ['donor-expired', DONOR.email],
      ['other-expired', OTHER.email],
    ] as const) {
      await pool.query(
        `INSERT INTO sessions (token_hash, donor_id, expires_at)
         VALUES ($1, $2, now() - interval '1 hour')`,
        [label, idOf(email)],
      );
    }

    await login(DONOR);

    const left = await pool.query<{ token_hash: string }>(
      "SELECT token_hash FROM sessions WHERE token_hash LIKE '%-expired'",
    );
    expect(left.rows.map((row) => row.token_hash)).toEqual(['other-expired']);
  });

  it('keeps passwords and tokens out of the log', async () => {
    const lines: string[] = [];
    const logged = build({
      logger: createLogger('trace', { write: (l: string) => lines.push(l) }),
    });

    const ok = await login(ADMIN, logged);
    await login({ email: ADMIN.email, password: 'a-wrong-password-9' }, logged);
    await login({ email: 'ghost@example.org', password: 'ghost-password-9' }, logged);

    const log = lines.join('');
    expect(log).not.toContain(ADMIN.password);
    expect(log).not.toContain('a-wrong-password-9');
    expect(log).not.toContain('ghost-password-9');
    expect(log).not.toContain('ghost@example.org');
    expect(log).not.toContain(tokenOf(ok));
  });
});

describe('login rate limit', () => {
  it('stops counting-and-checking after the limit: a blocked attempt never reaches the verifier', async () => {
    const limited = build({ loginRateLimit: 3 });
    const wrong = { email: DONOR.email, password: 'not-the-password' };
    for (let i = 0; i < 3; i++) expect((await login(wrong, limited)).status).toBe(401);
    expect(verifier).toHaveBeenCalledTimes(3);

    // The right password, so only the limiter can be what refuses it.
    const blocked = await login(DONOR, limited);

    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: { code: 'rate_limited' } });
    expect(blocked.headers['set-cookie']).toBeUndefined();
    expect(verifier).toHaveBeenCalledTimes(3);
  });

  // The demo passwords are public. If a success gave its attempt back, a known login between
  // guesses would reset the counter and the limit would mean nothing.
  it('counts successful logins too, so a known login cannot reset the counter', async () => {
    const limited = build({ loginRateLimit: 3 });
    const wrong = { email: ADMIN.email, password: 'not-the-password' };
    expect((await login(wrong, limited)).status).toBe(401);
    expect((await login(wrong, limited)).status).toBe(401);
    expect((await login(DONOR, limited)).status).toBe(200);

    expect((await login(wrong, limited)).status).toBe(429);
  });
});

describe('settings', () => {
  it('omits Secure from the cookie when cookieSecure is false', async () => {
    const insecure = createApp({
      logger: createLogger('silent'),
      pingDb: () => Promise.resolve(),
      db,
      intake: testIntake,
      auth: { dummyHash, sessionTtlHours: 1, cookieSecure: false, verifyPassword },
    });

    const header = setCookieOf(await login(DONOR, insecure));

    expect(header).not.toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Max-Age=3600');
  });

  it('lets no login succeed when no auth settings were given', async () => {
    const closed = createApp({
      logger: createLogger('silent'),
      pingDb: () => Promise.resolve(),
      db,
      intake: testIntake,
    });

    const res = await login(ADMIN, closed);

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('issues a fresh token even when the request already carries a session cookie', async () => {
    const old = await signIn(DONOR);

    const res = await request(app).post('/api/auth/login').set('Cookie', cookie(old)).send(OTHER);

    expect(res.status).toBe(200);
    expect(tokenOf(res)).not.toBe(old);
    expect(tokenOf(res)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    const token = await signIn(ADMIN);
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie(token));

    expect(res.status).toBe(200);
    expect(SessionResponseSchema.parse(res.body).user).toMatchObject({
      email: ADMIN.email,
      role: 'admin',
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is 401 unauthenticated with no cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'unauthenticated' } });
  });

  it('is 401 once the session has expired in the database', async () => {
    const token = await signIn();
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie(token));

    expect(res.status).toBe(401);
  });

  it('is 401 for a tampered, truncated or made-up token, and clears the cookie it was sent', async () => {
    const token = await signIn();
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    for (const bad of [flipped, token.slice(0, 20), 'x'.repeat(43), `${token}${token}`, '']) {
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie(bad));
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: { code: 'unauthenticated' } });
    }
    const cleared = await request(app).get('/api/auth/me').set('Cookie', cookie(flipped));
    expect(setCookieOf(cleared)).toMatch(/^aangan_session=;/);
  });

  it('reads the role from the database on every request', async () => {
    const token = await signIn(ADMIN);
    await pool.query("UPDATE donors SET role = 'donor' WHERE email = $1", [ADMIN.email]);
    try {
      const res = await request(app).get('/api/auth/me').set('Cookie', cookie(token));
      expect(SessionResponseSchema.parse(res.body).user.role).toBe('donor');
    } finally {
      await pool.query("UPDATE donors SET role = 'admin' WHERE email = $1", [ADMIN.email]);
    }
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session: 204, the row is gone, the cookie is cleared and the token stops working', async () => {
    const token = await signIn();

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie(token));

    expect(res.status).toBe(204);
    expect(setCookieOf(res)).toMatch(/^aangan_session=;/);
    const rows = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [sha256(token)]);
    expect(rows.rowCount).toBe(0);
    const after = await request(app).get('/api/auth/me').set('Cookie', cookie(token));
    expect(after.status).toBe(401);
  });

  it('is 401 when repeated, and with no cookie', async () => {
    const token = await signIn();
    await request(app).post('/api/auth/logout').set('Cookie', cookie(token));

    const again = await request(app).post('/api/auth/logout').set('Cookie', cookie(token));
    const none = await request(app).post('/api/auth/logout');

    expect(again.status).toBe(401);
    expect(none.status).toBe(401);
  });

  it('only ends its own session', async () => {
    const mine = await signIn(DONOR);
    const theirs = await signIn(OTHER);

    await request(app).post('/api/auth/logout').set('Cookie', cookie(mine));

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie(theirs));
    expect(res.status).toBe(200);
  });

  it('refuses a logout from an unlisted origin and keeps the session', async () => {
    const token = await signIn();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie(token))
      .set('Origin', 'https://evil.example');

    expect(res.status).toBe(403);
    const rows = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [sha256(token)]);
    expect(rows.rowCount).toBe(1);
  });
});
