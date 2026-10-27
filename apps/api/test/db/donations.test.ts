import { fileURLToPath } from 'node:url';
import {
  DonationReceiptSchema,
  PublicCampaignSchema,
  PublicDonationListSchema,
} from '@aangan/shared';
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

const now = (): Date => new Date('2026-10-15T12:00:00Z');
const AANGAN = 'aangan-courtyard';
const KEY = '3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f';

// Built from code points so no editor or tool can turn them into the plain character.
const ZWJ = String.fromCodePoint(0x200d);
const ZWSP = String.fromCodePoint(0x200b);
const NBSP = String.fromCodePoint(0x00a0);
const NARROW_NBSP = String.fromCodePoint(0x202f);
const COMBINING_ACUTE = String.fromCodePoint(0x0301);

let pool: pg.Pool;
let db: Kysely<Database>;
let calls: ChargeRequest[];
let logLines: string[];
let app: ReturnType<typeof createApp>;

// A spy over the real mock: it records each call and then lets the mock answer, so the tests
// assert on what the provider was asked, not on a stub's script.
function build(paymentTimeoutMs = 2000) {
  const real = createMockProvider({ latencyMs: 0 });
  const payments: PaymentProvider = {
    charge: (req) => {
      calls.push(req);
      return real.charge(req);
    },
  };
  return createApp({
    logger: createLogger('info', { write: (line: string) => logLines.push(line) }),
    pingDb: () => Promise.resolve(),
    db,
    now,
    intake: { payments, paymentTimeoutMs, orgTimezone: 'America/Chicago', donationRateLimit: 1000 },
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
  calls = [];
  logLines = [];
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

let nextKey = 0;
const freshKey = () => `00000000-0000-4000-8000-${String(++nextKey).padStart(12, '0')}`;

function post(payload: unknown, key: string | null = freshKey()) {
  const req = request(app).post('/api/donations');
  if (key !== null) void req.set('Idempotency-Key', key);
  return req.send(payload as object);
}

async function count(table: 'donors' | 'donations'): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

async function rowByReceipt(receipt: string) {
  const { rows } = await pool.query(
    `SELECT d.*, o.email::text AS email FROM donations d JOIN donors o ON o.id = d.donor_id
     WHERE d.receipt_number = $1`,
    [receipt],
  );
  return rows[0] as Record<string, unknown> | undefined;
}

async function raisedCents(slug = AANGAN): Promise<number> {
  const res = await request(app).get(`/api/campaigns/${slug}`);
  return PublicCampaignSchema.parse(res.body).raisedCents;
}

describe('POST /api/donations: the request', () => {
  it('answers 400 idempotency_key_required without a key or with a malformed one', async () => {
    const missing = await post(body(), null);
    const bad = await post(body(), 'not-a-uuid');
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ error: { code: 'idempotency_key_required' } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: { code: 'idempotency_key_required' } });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['99', 99],
    ['2500001', 2_500_001],
    ['-100', -100],
    ['1.5', 1.5],
    ['"100"', '100'],
    ['"abc"', 'abc'],
    ['null', null],
  ])(
    'rejects an amount of %s with 422 naming amountCents, and writes nothing',
    async (_l, amount) => {
      const donors = await count('donors');
      const donations = await count('donations');
      const res = await post(body({ amountCents: amount }));
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        error: { code: 'validation_failed', details: [{ field: 'amountCents' }] },
      });
      expect(await count('donors')).toBe(donors);
      expect(await count('donations')).toBe(donations);
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    ['status', { status: 'completed' }],
    ['donorId', { donorId: 'x' }],
    ['amount', { amount: 5 }],
    ['donor.role', { donor: { fullName: 'A', email: 'a@example.com', role: 'admin' } }],
    ['a bad privacyMode', { privacyMode: 'private' }],
    ['a dedication with a type and no name', { dedication: { type: 'in_honor_of' } }],
    ['a 281 code point message', { message: '😀'.repeat(281) }],
  ])('rejects %s with 422 and no row', async (_label, extra) => {
    const donations = await count('donations');
    const res = await post(body(extra));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
    expect(await count('donations')).toBe(donations);
    expect(calls).toHaveLength(0);
  });

  it('does not echo the caller input in a validation error', async () => {
    const res = await post(body({ hacker_key: 'secret-value', amountCents: 'oops' }));
    expect(JSON.stringify(res.body)).not.toContain('secret-value');
    expect(JSON.stringify(res.body)).not.toContain('hacker_key');
  });

  it('answers 400 malformed_json for a body that is not JSON', async () => {
    const res = await request(app)
      .post('/api/donations')
      .set('Idempotency-Key', freshKey())
      .set('Content-Type', 'application/json')
      .send('{"amountCents":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'malformed_json' } });
  });

  it('answers 422 when there is no JSON body at all', async () => {
    const res = await request(app).post('/api/donations').set('Idempotency-Key', freshKey());
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });
});

describe('POST /api/donations: campaign rules', () => {
  it.each([
    ['100 on Aangan', 100],
    ['2500000 on Aangan', 2_500_000],
  ])('accepts %s', async (_label, amountCents) => {
    const res = await post(body({ amountCents }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amountCents });
  });

  it('refuses 500001 on Annadaan, whose maximum is $5,000, as amount_out_of_range', async () => {
    const res = await post(body({ campaignSlug: 'annadaan-kitchen', amountCents: 500_001 }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      error: { code: 'amount_out_of_range', details: [{ field: 'amountCents' }] },
    });
    expect(calls).toHaveLength(0);
  });

  it('refuses a closed campaign as campaign_closed', async () => {
    const res = await post(body({ campaignSlug: 'roof-repair-2025' }));
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'campaign_closed' } });
    expect(calls).toHaveLength(0);
  });

  it('answers 404 for an unknown campaign', async () => {
    const res = await post(body({ campaignSlug: 'nope' }));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('POST /api/donations: names are normalised at intake', () => {
  it('stores NFC with single spaces and keeps a Devanagari conjunct byte for byte', async () => {
    const conjunct = `क्${ZWJ}ष`;
    const res = await post(
      body({
        donor: {
          fullName: `  E${COMBINING_ACUTE}mile${NBSP}\t Gurung ${conjunct}  `,
          email: 'unicode@example.com',
        },
        dedication: { type: 'in_memory_of', name: `A${ZWSP}ama${NARROW_NBSP}Ji` },
      }),
    );
    expect(res.status).toBe(201);
    const row = await rowByReceipt(DonationReceiptSchema.parse(res.body).receiptNumber);
    expect(row?.donor_name).toBe(`Émile Gurung ${conjunct}`.normalize('NFC'));
    expect(row?.dedication_name).toBe('A ama Ji');
  });
});

describe('POST /api/donations: a successful charge', () => {
  it('answers 201 with receipt 76, charges the validated amount, and moves the total', async () => {
    const before = await raisedCents();
    const res = await post(body({ message: '  For the courtyard.  ' }), KEY);
    expect(res.status).toBe(201);
    const receipt = DonationReceiptSchema.parse(res.body);
    expect(receipt).toMatchObject({
      receiptNumber: 'HCC-2026-000076',
      amountCents: 10100,
      currency: 'USD',
      status: 'completed',
    });
    expect(await raisedCents()).toBe(before + 10100);

    const row = await rowByReceipt('HCC-2026-000076');
    expect(row).toMatchObject({
      status: 'completed',
      amount_cents: 10100,
      currency: 'USD',
      message: 'For the courtyard.',
      privacy_mode: 'public',
      is_recurring: false,
      source: 'web',
      idempotency_key: KEY,
      payment_last4: '4242',
      failure_code: null,
    });
    expect(String(row?.payment_charge_id)).toMatch(/^ch_/);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      token: 'tok_ok',
      amountCents: 10100,
      idempotencyKey: receipt.id,
    });
  });

  it('shows a public gift in the list and keeps an anonymous one out of the raw JSON', async () => {
    await post(body({ donor: { fullName: 'Visible Person', email: 'visible@example.com' } }));
    await post(
      body({
        donor: { fullName: 'Hidden Person', email: 'hidden@example.com' },
        privacyMode: 'anonymous',
        message: 'a private note',
      }),
    );
    const res = await request(app).get(`/api/campaigns/${AANGAN}/donations?limit=50`);
    const items = PublicDonationListSchema.parse(res.body).data;
    expect(items.some((i) => i.displayName === 'Visible Person')).toBe(true);
    expect(res.text).not.toContain('Hidden Person');
    expect(res.text).not.toContain('hidden@example.com');
    expect(res.text).not.toContain('a private note');
  });

  it('links a seeded email to its donor without renaming it', async () => {
    const { rows } = await pool.query<{ id: string; email: string; full_name: string }>(
      `SELECT id, email::text AS email, full_name FROM donors ORDER BY email LIMIT 1`,
    );
    const seeded = rows[0];
    if (seeded === undefined) throw new Error('no seeded donor');
    const donors = await count('donors');

    const res = await post(
      body({ donor: { fullName: 'Someone Else Entirely', email: seeded.email.toUpperCase() } }),
    );
    expect(res.status).toBe(201);
    expect(await count('donors')).toBe(donors);
    const row = await rowByReceipt('HCC-2026-000076');
    expect(row?.donor_id).toBe(seeded.id);
    expect(row?.donor_name).toBe('Someone Else Entirely');
    const after = await pool.query<{ full_name: string }>(
      'SELECT full_name FROM donors WHERE id = $1',
      [seeded.id],
    );
    expect(after.rows[0]?.full_name).toBe(seeded.full_name);
  });

  it('keeps names, emails and messages out of the logs', async () => {
    await post(
      body({
        donor: { fullName: 'Logged Person', email: 'logged@example.com' },
        message: 'a very private message',
        dedication: { type: 'in_honor_of', name: 'Secret Aunt' },
      }),
    );
    const log = logLines.join('');
    expect(log).toContain('HCC-2026-000076');
    for (const secret of ['Logged Person', 'logged@example.com', 'very private', 'Secret Aunt']) {
      expect(log).not.toContain(secret);
    }
  });
});

describe('POST /api/donations: payment outcomes', () => {
  it.each([
    ['tok_decline', 'card_declined'],
    ['tok_insufficient', 'insufficient_funds'],
  ])('answers 402 for %s and keeps a failed row', async (paymentToken, code) => {
    const before = await raisedCents();
    const res = await post(body({ paymentToken }));
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ error: { code } });
    const row = await rowByReceipt('HCC-2026-000076');
    expect(row).toMatchObject({ status: 'failed', failure_code: code, payment_charge_id: null });
    expect(await raisedCents()).toBe(before);
    expect(calls).toHaveLength(1);
  });

  it('answers 202 for a timeout within the deadline and keeps the row pending, never failed', async () => {
    app = build(300);
    const before = await raisedCents();
    const started = Date.now();
    const res = await post(body({ paymentToken: 'tok_timeout' }));
    expect(Date.now() - started).toBeLessThan(1300);
    expect(res.status).toBe(202);
    expect(DonationReceiptSchema.parse(res.body)).toMatchObject({
      status: 'pending',
      receiptNumber: 'HCC-2026-000076',
    });
    expect(await rowByReceipt('HCC-2026-000076')).toMatchObject({
      status: 'pending',
      failure_code: 'provider_timeout',
    });
    expect(await raisedCents()).toBe(before);
  });

  it('retries tok_flaky once with the same key and answers 201', async () => {
    const res = await post(body({ paymentToken: 'tok_flaky' }));
    expect(res.status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.idempotencyKey).toBe(calls[1]?.idempotencyKey);
  });

  it('answers 202, not an error, when recording the outcome fails after a charge', async () => {
    await pool.query(`
      CREATE FUNCTION fail_donation_update() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'simulated outage'; END $$`);
    await pool.query(`
      CREATE TRIGGER fail_donation_update BEFORE UPDATE ON donations
      FOR EACH ROW EXECUTE FUNCTION fail_donation_update()`);
    try {
      const res = await post(body());
      expect(res.status).toBe(202);
      expect(DonationReceiptSchema.parse(res.body).status).toBe('pending');
      expect(calls).toHaveLength(1);
      expect(await rowByReceipt('HCC-2026-000076')).toMatchObject({ status: 'pending' });
      expect(logLines.join('')).toContain('donationId');
    } finally {
      await pool.query('DROP TRIGGER fail_donation_update ON donations');
      await pool.query('DROP FUNCTION fail_donation_update');
    }
  });

  it('does not charge twice when the same key is sent again', async () => {
    const first = await post(body(), KEY);
    const second = await post(body(), KEY);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(calls).toHaveLength(1);
    expect(await count('donations')).toBe(76);
  });
});
