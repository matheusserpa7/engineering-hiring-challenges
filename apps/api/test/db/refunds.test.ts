import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  AdminDonationSchema,
  PublicCampaignSchema,
  PublicDonationListSchema,
} from '@aangan/shared';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
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
const REASON = 'Duplicate gift, confirmed with the donor';

let pool: pg.Pool;
let db: Kysely<Database>;
let app: ReturnType<typeof createApp>;
let adminCookie = '';
let donorCookie = '';
let adminId = '';

async function cookieFor(account: { email: string; password: string }): Promise<string> {
  const res = await request(app).post('/api/auth/login').send(account);
  const header: unknown = res.headers['set-cookie'];
  const first: unknown = Array.isArray(header) ? header[0] : header;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}

// The seed is reloaded for every test: a refund changes totals that other tests read.
async function reseed(): Promise<void> {
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  await pool.query('ALTER SEQUENCE receipt_number_seq RESTART');
  await runSeed(db, loadSeed(SEED_DIR));
  adminCookie = await cookieFor(ADMIN);
  donorCookie = await cookieFor(DONOR);
  const admin = await pool.query<{ id: string }>('SELECT id FROM donors WHERE email = $1', [
    ADMIN.email,
  ]);
  adminId = admin.rows[0]?.id ?? '';
}

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
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

beforeEach(reseed, 60_000);

afterAll(async () => {
  await db.destroy();
});

async function idOfReceipt(receipt: string): Promise<string> {
  const row = await pool.query<{ id: string }>(
    'SELECT id FROM donations WHERE receipt_number = $1',
    [receipt],
  );
  return row.rows[0]?.id ?? '';
}

const refund = (id: string, body: unknown, cookie = adminCookie) =>
  request(app)
    .post(`/api/admin/donations/${id}/refund`)
    .set('Cookie', cookie)
    .send(body as object);

const refundRows = async (id: string) =>
  (await pool.query('SELECT * FROM refunds WHERE donation_id = $1', [id])).rows as {
    actor_id: string;
    reason: string;
    amount_cents: number;
  }[];

const statusOf = async (id: string) =>
  (await pool.query<{ status: string }>('SELECT status FROM donations WHERE id = $1', [id])).rows[0]
    ?.status;

const campaign = async () =>
  PublicCampaignSchema.parse((await request(app).get('/api/campaigns/aangan-courtyard')).body);

const publicIds = async () =>
  PublicDonationListSchema.parse(
    (await request(app).get('/api/campaigns/aangan-courtyard/donations?limit=50')).body,
  ).data.map((row) => row.id);

describe('POST /api/admin/donations/:id/refund', () => {
  it('refunds a completed donation, writes the audit row and moves every total', async () => {
    const id = await idOfReceipt('HCC-2026-000003');
    const before = await campaign();
    expect(before.raisedCents).toBe(4_305_800);
    expect(await publicIds()).toContain(id);

    const stamps = await pool.query<{ updated_at: Date }>(
      'SELECT updated_at FROM donations WHERE id = $1',
      [id],
    );

    const res = await refund(id, { reason: `  ${REASON}  ` });

    expect(res.status).toBe(200);
    const body = AdminDonationSchema.parse(res.body);
    expect(body).toMatchObject({ id, status: 'refunded', amountCents: 2_500_000 });
    expect(body.refundedAt).not.toBeNull();

    const rows = await refundRows(id);
    expect(rows).toEqual([
      expect.objectContaining({ actor_id: adminId, reason: REASON, amount_cents: 2_500_000 }),
    ]);

    const after = await campaign();
    expect(after.raisedCents).toBe(1_805_800);
    expect(after.donorCount).toBe(45);
    expect(after.donorCount).toBe(before.donorCount - 1);
    const moved = await pool.query<{ moved: boolean; stamped: boolean }>(
      `SELECT updated_at > $2 AS moved, refunded_at = updated_at AS stamped FROM donations WHERE id = $1`,
      [id, stamps.rows[0]?.updated_at],
    );
    expect(moved.rows[0]).toEqual({ moved: true, stamped: true });
    expect(await publicIds()).not.toContain(id);
    const admin = await request(app)
      .get('/api/admin/donations?status=refunded')
      .set('Cookie', adminCookie);
    expect((admin.body as { total: number }).total).toBe(8);
  });

  it('answers 409 already_refunded on a repeat and writes nothing more', async () => {
    const id = await idOfReceipt('HCC-2026-000003');
    await refund(id, { reason: REASON });
    const stamp = await pool.query('SELECT refunded_at FROM donations WHERE id = $1', [id]);

    const again = await refund(id, { reason: 'A second try' });

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: 'already_refunded' } });
    expect(await refundRows(id)).toHaveLength(1);
    const unchanged = await pool.query('SELECT refunded_at FROM donations WHERE id = $1', [id]);
    expect(unchanged.rows).toEqual(stamp.rows);
  });

  it.each(['pending', 'failed'])('answers 409 not_refundable for a %s donation', async (status) => {
    const id = await idOfReceipt('HCC-2026-000003');
    await pool.query(
      "UPDATE donations SET status = $2, refunded_at = NULL, source = 'import' WHERE id = $1",
      [id, status],
    );

    const res = await refund(id, { reason: REASON });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'not_refundable' } });
    expect(await refundRows(id)).toHaveLength(0);
    expect(await statusOf(id)).toBe(status);
  });

  it('answers 404 for an id that does not exist and for one that is malformed, never 409', async () => {
    const missing = await refund(randomUUID(), { reason: REASON });
    const malformed = await refund('not-a-uuid', { reason: REASON });

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(missing.body).toMatchObject({ error: { code: 'not_found' } });
    expect(malformed.text).toBe(missing.text);
  });

  it.each([
    ['no reason', {}],
    ['an empty reason', { reason: '' }],
    ['a blank reason', { reason: '   ' }],
    ['a 501-code-point reason', { reason: '😀'.repeat(501) }],
    ['a control character', { reason: 'a\u0000b' }],
    ['an amount the client chose', { reason: REASON, amountCents: 1 }],
    ['an actor the client chose', { reason: REASON, actorId: randomUUID() }],
  ])('refuses %s with 422 and changes nothing', async (_label, body) => {
    const id = await idOfReceipt('HCC-2026-000003');

    const res = await refund(id, body);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
    expect(await statusOf(id)).toBe('completed');
    expect(await refundRows(id)).toHaveLength(0);
  });

  it('stores a reason of exactly 500 emoji', async () => {
    const id = await idOfReceipt('HCC-2026-000003');
    const reason = '😀'.repeat(500);

    expect((await refund(id, { reason })).status).toBe(200);
    expect((await refundRows(id))[0]?.reason).toBe(reason);
  });
});

describe('who may refund', () => {
  it('refuses a donor with 403 and leaves the donation completed', async () => {
    const id = await idOfReceipt('HCC-2026-000003');

    const res = await refund(id, { reason: REASON }, donorCookie);

    expect(res.status).toBe(403);
    expect(await statusOf(id)).toBe('completed');
    expect(await refundRows(id)).toHaveLength(0);
  });

  it('refuses a request with no session with 401', async () => {
    const id = await idOfReceipt('HCC-2026-000003');
    const res = await request(app)
      .post(`/api/admin/donations/${id}/refund`)
      .send({ reason: REASON });
    expect(res.status).toBe(401);
    expect(await statusOf(id)).toBe('completed');
  });

  it('refuses an admin request from an unlisted origin with 403', async () => {
    const id = await idOfReceipt('HCC-2026-000003');
    const res = await refund(id, { reason: REASON }).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(await statusOf(id)).toBe('completed');
  });
});

describe('concurrency and atomicity', () => {
  // Twenty requests race for one completed row. The conditional UPDATE is the only gate: the
  // winner commits, and each waiter re-checks `status = 'completed'` against the new version.
  it('lets exactly one of 20 parallel refunds succeed', async () => {
    const id = await idOfReceipt('HCC-2026-000003');

    const results = await Promise.all(
      Array.from({ length: 20 }, () => refund(id, { reason: REASON })),
    );

    const codes = results.map((res) => res.status).sort();
    expect(codes.filter((code) => code === 200)).toHaveLength(1);
    expect(codes.filter((code) => code === 409)).toHaveLength(19);
    expect(await refundRows(id)).toHaveLength(1);
    expect((await campaign()).raisedCents).toBe(1_805_800);
  });

  it('rolls the status change back when the audit row cannot be written', async () => {
    const id = await idOfReceipt('HCC-2026-000003');
    await pool.query(`
      CREATE FUNCTION refunds_fail() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$`);
    await pool.query(
      'CREATE TRIGGER refunds_fail BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION refunds_fail()',
    );
    try {
      const res = await refund(id, { reason: REASON });

      expect(res.status).toBe(500);
      expect(res.text).not.toContain('audit unavailable');
      expect(await statusOf(id)).toBe('completed');
      expect((await campaign()).raisedCents).toBe(4_305_800);
    } finally {
      await pool.query('DROP TRIGGER refunds_fail ON refunds');
      await pool.query('DROP FUNCTION refunds_fail()');
    }
  });
});
