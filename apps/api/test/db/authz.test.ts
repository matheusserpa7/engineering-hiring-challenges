import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DonationDetailListSchema, DonationDetailSchema } from '@aangan/shared';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
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

let pool: pg.Pool;
let db: Kysely<Database>;
let app: ReturnType<typeof createApp>;
// Receipt number → donation id, for the five rows the demo donors own.
const ids = new Map<string, string>();

const mine = ['HCC-2026-000019', 'HCC-2026-000020', 'HCC-2026-000021'];
const theirs = ['HCC-2026-000022', 'HCC-2026-000023'];

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  await pool.query('ALTER SEQUENCE receipt_number_seq RESTART');
  await runSeed(db, loadSeed(SEED_DIR));
  const rows = await pool.query<{ id: string; receipt_number: string }>(
    'SELECT id, receipt_number FROM donations WHERE receipt_number = ANY($1)',
    [[...mine, ...theirs]],
  );
  for (const row of rows.rows) ids.set(row.receipt_number, row.id);
  expect(ids.size).toBe(5);

  app = createApp({
    logger: createLogger('silent'),
    pingDb: () => Promise.resolve(),
    db,
    intake: testIntake,
    security: { allowedOrigins: ['http://localhost:3000'], loginRateLimit: 1000 },
    auth: {
      dummyHash: await hashPassword('unused'),
      sessionTtlHours: 8,
      cookieSecure: true,
      verifyPassword,
    },
  });
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

const idOf = (receipt: string): string => ids.get(receipt) ?? '';

// One login per account for the whole file: the cookie is all a request needs.
const cookies = new Map<string, string>();
async function as(account: { email: string; password: string }): Promise<string> {
  const known = cookies.get(account.email);
  if (known) return known;
  const res = await request(app).post('/api/auth/login').send(account);
  expect(res.status).toBe(200);
  const header: unknown = res.headers['set-cookie'];
  const first: unknown = Array.isArray(header) ? header[0] : header;
  const cookie = typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
  cookies.set(account.email, cookie);
  return cookie;
}

const get = async (path: string, account?: { email: string; password: string }) => {
  const req = request(app).get(path);
  if (account) void req.set('Cookie', await as(account));
  return req;
};

describe('no session', () => {
  it.each([
    '/api/me/donations',
    `/api/donations/${randomUUID()}`,
    '/api/admin/donations',
    '/api/admin/anything-at-all',
  ])('GET %s is 401 unauthenticated', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'unauthenticated' } });
  });
});

describe('GET /api/me/donations', () => {
  it('returns exactly the signed-in donor’s donations, newest first', async () => {
    const res = await get('/api/me/donations', DONOR);

    expect(res.status).toBe(200);
    const { data } = DonationDetailListSchema.parse(res.body);
    expect(data.map((row) => row.receiptNumber).sort()).toEqual(mine);
    expect(data.map((row) => row.createdAt)).toEqual(
      [...data.map((row) => row.createdAt)].sort().reverse(),
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('shows the donor their own real name and the status of a refunded row', async () => {
    const { data } = DonationDetailListSchema.parse((await get('/api/me/donations', DONOR)).body);

    const anonymous = data.find((row) => row.receiptNumber === 'HCC-2026-000020');
    const refunded = data.find((row) => row.receiptNumber === 'HCC-2026-000021');
    expect(anonymous?.privacyMode).toBe('anonymous');
    expect(anonymous?.donorName).not.toBe('Anonymous');
    expect(refunded).toMatchObject({ status: 'refunded' });
  });

  it('does not show another donor’s rows to the other donor, nor to an admin', async () => {
    const other = DonationDetailListSchema.parse((await get('/api/me/donations', OTHER)).body);
    expect(other.data.map((row) => row.receiptNumber).sort()).toEqual(theirs);

    // "Mine" means the viewer's own, even for an admin; the admin list is a separate route.
    const admin = await get('/api/me/donations', ADMIN);
    expect(admin.status).toBe(200);
    expect(admin.body).toEqual({ data: [] });
  });
});

describe('GET /api/donations/:id', () => {
  it('lets a donor read their own donation', async () => {
    const res = await get(`/api/donations/${idOf(mine[0] ?? '')}`, DONOR);

    expect(res.status).toBe(200);
    expect(DonationDetailSchema.parse(res.body)).toMatchObject({ receiptNumber: mine[0] });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  // The two bodies are compared as bytes: a different message, or a 403 for the foreign row,
  // would tell a caller which ids exist.
  it('answers another donor’s donation exactly as it answers an id that does not exist', async () => {
    const foreign = await get(`/api/donations/${idOf(theirs[0] ?? '')}`, DONOR);
    const missing = await get(`/api/donations/${randomUUID()}`, DONOR);
    const malformed = await get('/api/donations/not-a-uuid', DONOR);

    expect(foreign.status).toBe(404);
    expect(foreign.text).toBe(missing.text);
    expect(foreign.text).toBe(malformed.text);
    expect(JSON.parse(foreign.text)).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers an admin asking for an id that does not exist with the same 404', async () => {
    const res = await get(`/api/donations/${randomUUID()}`, ADMIN);
    expect(res.status).toBe(404);
    expect(JSON.parse(res.text)).toMatchObject({ error: { code: 'not_found' } });
  });

  it('lets an admin read any donation', async () => {
    const res = await get(`/api/donations/${idOf(theirs[1] ?? '')}`, ADMIN);

    expect(res.status).toBe(200);
    expect(DonationDetailSchema.parse(res.body)).toMatchObject({ receiptNumber: theirs[1] });
  });

  it('returns the dedication and the campaign of the donation', async () => {
    const res = await get(`/api/donations/${idOf(theirs[1] ?? '')}`, OTHER);

    expect(DonationDetailSchema.parse(res.body)).toMatchObject({
      campaign: { slug: 'aangan-courtyard' },
      dedication: expect.objectContaining({ type: 'in_honor_of' }) as unknown,
    });
  });
});

describe('/api/admin guard', () => {
  it('is 403 forbidden for a donor, whatever the path, and the body never varies', async () => {
    const list = await get('/api/admin/donations', DONOR);
    const other = await get('/api/admin/anything-at-all', DONOR);

    expect(list.status).toBe(403);
    expect(list.body).toMatchObject({ error: { code: 'forbidden' } });
    expect(other.status).toBe(403);
    expect(other.text).toBe(list.text);
  });

  // A malformed body must not turn a refusal into a 400: the guard runs before the parser.
  it('answers 401 and 403 before a malformed or oversized body is looked at', async () => {
    const bad = (cookie?: string) => {
      const req = request(app).post('/api/admin/donations').set('Content-Type', 'application/json');
      if (cookie) void req.set('Cookie', cookie);
      return req;
    };

    expect((await bad().send('{not json')).status).toBe(401);
    expect((await bad(await as(DONOR)).send('{not json')).status).toBe(403);
    expect(
      (await bad(await as(DONOR)).send(JSON.stringify({ x: 'a'.repeat(20_000) }))).status,
    ).toBe(403);
  });

  it('is 403 on a write too, with a valid body', async () => {
    const res = await request(app)
      .post(`/api/admin/donations/${idOf(mine[0] ?? '')}/refund`)
      .set('Cookie', await as(DONOR))
      .send({ reason: 'I would like my money back' });

    expect(res.status).toBe(403);
    const row = await pool.query<{ status: string }>('SELECT status FROM donations WHERE id = $1', [
      idOf(mine[0] ?? ''),
    ]);
    expect(row.rows[0]?.status).toBe('completed');
  });

  it('lets an admin through to the router (an unknown path is then a 404, not a 403)', async () => {
    const res = await get('/api/admin/anything-at-all', ADMIN);
    expect(res.status).toBe(404);
  });

  it('takes effect on the next request when an admin is demoted', async () => {
    const cookie = await as(ADMIN);
    expect(
      (await request(app).get('/api/admin/anything-at-all').set('Cookie', cookie)).status,
    ).toBe(404);
    await pool.query("UPDATE donors SET role = 'donor' WHERE email = $1", [ADMIN.email]);
    try {
      const res = await request(app).get('/api/admin/anything-at-all').set('Cookie', cookie);
      expect(res.status).toBe(403);
    } finally {
      await pool.query("UPDATE donors SET role = 'admin' WHERE email = $1", [ADMIN.email]);
    }
  });
});
