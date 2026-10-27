import { fileURLToPath } from 'node:url';
import { DonationReceiptSchema } from '@aangan/shared';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDb, type Database } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { loadSeed, runSeed } from '../../src/db/seed/seed.js';
import { createLogger } from '../../src/logger.js';
import type { ChargeRequest, PaymentProvider } from '../../src/payments/charge.js';
import { createMockProvider } from '../../src/payments/mock-provider.js';

const SEED_DIR = fileURLToPath(
  new URL('../../../../roles/full-stack-engineer/seed', import.meta.url),
);

const AANGAN = 'aangan-courtyard';
const KEY = '3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f';
const PAYMENT_TIMEOUT_MS = 300;

let clock = new Date('2026-10-15T12:00:00Z');
const now = (): Date => clock;

let pool: pg.Pool;
let db: Kysely<Database>;
let calls: ChargeRequest[];
let app: ReturnType<typeof createApp>;

function build(latencyMs = 0) {
  const real = createMockProvider({ latencyMs });
  const payments: PaymentProvider = {
    charge: (req) => {
      calls.push(req);
      return real.charge(req);
    },
  };
  return createApp({
    logger: createLogger('silent'),
    pingDb: () => Promise.resolve(),
    db,
    now,
    intake: {
      payments,
      paymentTimeoutMs: PAYMENT_TIMEOUT_MS,
      orgTimezone: 'America/Chicago',
    },
  });
}

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  await pool.query('ALTER SEQUENCE receipt_number_seq RESTART');
  await runSeed(db, loadSeed(SEED_DIR));
  clock = new Date('2026-10-15T12:00:00Z');
  calls = [];
  app = build();
});

afterAll(async () => {
  await db.destroy();
});

const body = (overrides: Record<string, unknown> = {}) => ({
  campaignSlug: AANGAN,
  amountCents: 10100,
  donor: { fullName: 'Anisha Gurung', email: 'anisha.new@example.com' },
  privacyMode: 'public',
  paymentToken: 'tok_ok',
  ...overrides,
});

const post = (payload: unknown, key: string | null = KEY) => {
  const req = request(app).post('/api/donations');
  if (key !== null) void req.set('Idempotency-Key', key);
  return req.send(payload as object);
};

// The receipt id, read through the contract so the tests need no `any`.
const idOf = (res: { body: unknown }): string => DonationReceiptSchema.parse(res.body).id;

async function count(table: 'donors' | 'donations'): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

describe('POST /api/donations: replays by idempotency key', () => {
  it('answers the same key again with the same receipt, flagged as a replay, and no new charge', async () => {
    const first = await post(body());
    const second = await post(body());
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(calls).toHaveLength(1);
    expect(await count('donations')).toBe(76);
  });

  it('treats a re-ordered JSON body, an omitted message and an explicit null as the same request', async () => {
    const first = await post(body());
    const second = await post({
      paymentToken: 'tok_ok',
      message: null,
      privacyMode: 'public',
      donor: { email: 'ANISHA.new@example.com', fullName: 'Anisha  Gurung' },
      amountCents: 10100,
      campaignSlug: AANGAN,
    });
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(calls).toHaveLength(1);
  });

  it('answers 422 idempotency_key_mismatch when the same key comes with another body', async () => {
    await post(body());
    for (const changed of [
      body({ amountCents: 10200 }),
      body({ paymentToken: 'tok_decline' }),
      body({ donor: { fullName: 'Anisha Gurung', email: 'someone.else@example.com' } }),
    ]) {
      const res = await post(changed);
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ error: { code: 'idempotency_key_mismatch' } });
    }
    expect(calls).toHaveLength(1);
    expect(await count('donations')).toBe(76);
  });

  it('checks the key before the campaign rules, so a retry replays even after the campaign closed', async () => {
    const first = await post(body());
    await pool.query("UPDATE campaigns SET is_active = false WHERE slug = 'aangan-courtyard'");
    const second = await post(body());
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
  });

  it('replays a decline as the same 402 with no new charge and no second row', async () => {
    const first = await post(body({ paymentToken: 'tok_decline' }));
    const second = await post(body({ paymentToken: 'tok_decline' }));
    expect(first.status).toBe(402);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.status).toBe(402);
    expect(second.body).toMatchObject({ error: { code: 'card_declined' } });
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(calls).toHaveLength(1);
    expect(await count('donations')).toBe(76);
  });

  it('replays insufficient funds as 402 insufficient_funds', async () => {
    await post(body({ paymentToken: 'tok_insufficient' }));
    const again = await post(body({ paymentToken: 'tok_insufficient' }));
    expect(again.status).toBe(402);
    expect(again.body).toMatchObject({ error: { code: 'insufficient_funds' } });
  });

  it('replays a timeout as 202 with the same receipt and does not charge again', async () => {
    const first = await post(body({ paymentToken: 'tok_timeout' }));
    const second = await post(body({ paymentToken: 'tok_timeout' }));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(calls).toHaveLength(1);
  });

  it('replays a refunded donation as 201 with status refunded', async () => {
    const first = await post(body());
    await pool.query(
      "UPDATE donations SET status = 'refunded', refunded_at = now() WHERE id = $1",
      [idOf(first)],
    );
    const again = await post(body());
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: idOf(first), status: 'refunded' });
  });
});

describe('POST /api/donations: a pending row with no outcome', () => {
  // A crash between the claim and the outcome leaves this row. The database clock decides
  // whether the first request can still be running.
  async function seedPending(ageSeconds: number) {
    const first = await post(body());
    await pool.query(
      `UPDATE donations SET status = 'pending', failure_code = NULL, payment_charge_id = NULL,
         created_at = now() - make_interval(secs => $2) WHERE id = $1`,
      [idOf(first), ageSeconds],
    );
    return { id: idOf(first) };
  }

  it('answers a changed body under an in-flight key with 422, not 409', async () => {
    await seedPending(1);
    const res = await post(body({ amountCents: 10200 }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'idempotency_key_mismatch' } });
  });

  it('answers 409 request_in_progress with Retry-After while it is fresh', async () => {
    await seedPending(1);
    const res = await post(body());
    expect(res.status).toBe(409);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.body).toMatchObject({ error: { code: 'request_in_progress' } });
    expect(calls).toHaveLength(1);
  });

  it('answers 202 with the receipt once it is older than the timeout plus 5 seconds', async () => {
    const { id } = await seedPending(PAYMENT_TIMEOUT_MS / 1000 + 6);
    const res = await post(body());
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ id, status: 'pending' });
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(calls).toHaveLength(1);
  });
});

describe('POST /api/donations: an outcome recorded by someone else first', () => {
  it('answers from the stored row instead of overwriting it or failing', async () => {
    // While the charge is in flight another writer completes the row (a refund job, a webhook).
    const racing: PaymentProvider = {
      charge: async (req) => {
        calls.push(req);
        await pool.query(
          `UPDATE donations SET status = 'completed', payment_charge_id = 'ch_other',
             payment_last4 = '4242' WHERE id = $1`,
          [req.idempotencyKey],
        );
        return Promise.reject(new Error('this answer must be ignored'));
      },
    };
    app = createApp({
      logger: createLogger('silent'),
      pingDb: () => Promise.resolve(),
      db,
      now,
      intake: {
        payments: racing,
        paymentTimeoutMs: PAYMENT_TIMEOUT_MS,
        orgTimezone: 'America/Chicago',
      },
    });
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'completed' });
    const { rows } = await pool.query<{ payment_charge_id: string }>(
      'SELECT payment_charge_id FROM donations WHERE id = $1',
      [idOf(res)],
    );
    expect(rows[0]?.payment_charge_id).toBe('ch_other');
  });
});

describe('POST /api/donations: concurrency', () => {
  it('20 parallel identical requests make 1 row and 1 provider call, 201 or 409 only', async () => {
    // A slow provider keeps the first request in flight while the other 19 arrive.
    app = build(100);
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(body())));
    const original = responses.filter(
      (r) => r.status === 201 && r.headers['idempotent-replayed'] === undefined,
    );
    expect(original).toHaveLength(1);
    const others = responses.filter((r) => !original.includes(r));
    for (const other of others) {
      // A request that arrives after the winner finished is a legitimate replay.
      if (other.status === 201) {
        expect(other.headers['idempotent-replayed']).toBe('true');
        continue;
      }
      expect(other.status).toBe(409);
      expect(other.body).toMatchObject({ error: { code: 'request_in_progress' } });
      expect(other.headers['retry-after']).toBe('1');
    }
    expect(calls).toHaveLength(1);
    expect(await count('donations')).toBe(76);
    expect(await count('donors')).toBe(73);
  });

  it('20 different keys with one new email make 20 rows and a single donor', async () => {
    const keys = Array.from(
      { length: 20 },
      (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    );
    const responses = await Promise.all(keys.map((k) => post(body(), k)));
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await count('donations')).toBe(95);
    expect(await count('donors')).toBe(73);
  });

  it('two keys with the same body make two donations', async () => {
    const a = await post(body(), KEY);
    const b = await post(body(), '22222222-2222-4222-8222-222222222222');
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(idOf(b)).not.toBe(idOf(a));
    expect(calls).toHaveLength(2);
  });
});
