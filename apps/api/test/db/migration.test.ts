import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createDb, type Database } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { createLogger } from '../../src/logger.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';

let pool: pg.Pool;
let db: Kysely<Database>;
let campaignId: string;
let donorId: string;
let receiptCounter = 0;

type DonationOverrides = Record<string, unknown>;

// Every column the schema requires is filled with a value that satisfies every constraint,
// so a test that overrides one column can only fail because of that column.
async function insertDonation(overrides: DonationOverrides = {}): Promise<void> {
  receiptCounter += 1;
  const row: Record<string, unknown> = {
    id: randomUUID(),
    campaign_id: campaignId,
    donor_id: donorId,
    donor_name: 'Test Donor',
    amount_cents: 5000,
    currency: 'USD',
    status: 'completed',
    privacy_mode: 'public',
    receipt_number: `HCC-TEST-${String(receiptCounter).padStart(6, '0')}`,
    idempotency_key: `key-${String(receiptCounter)}`,
    source: 'web',
    ...overrides,
  };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, i) => `$${String(i + 1)}`).join(', ');
  await pool.query(
    `INSERT INTO donations (${columns.join(', ')}) VALUES (${placeholders})`,
    Object.values(row),
  );
}

async function expectPgError(promise: Promise<unknown>, code: string): Promise<pg.DatabaseError> {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'the database should have rejected the statement').not.toBeNull();
  expect(error).toMatchObject({ code });
  return error as pg.DatabaseError;
}

async function schemaSnapshot(): Promise<unknown> {
  const columns = await pool.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`,
  );
  const constraints = await pool.query(
    `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      ORDER BY conrelid::regclass::text, conname`,
  );
  const indexes = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  );
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  // The container is shared with the other integration files.
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  campaignId = randomUUID();
  donorId = randomUUID();
  await pool.query(
    `INSERT INTO campaigns (id, slug, title, goal_cents, min_cents, max_cents, preset_cents)
     VALUES ($1, 'aangan', 'Aangan', 10000000, 100, 2500000, '{1000,5000}')`,
    [campaignId],
  );
  await pool.query(
    `INSERT INTO donors (id, email, full_name) VALUES ($1, 'first@example.org', 'First Donor')`,
    [donorId],
  );
});

describe('amount_cents range', () => {
  it('rejects 99 cents ($0.99) with a check violation on amount_cents', async () => {
    const error = await expectPgError(insertDonation({ amount_cents: 99 }), CHECK_VIOLATION);
    expect(error.constraint).toMatch(/amount_cents/);
  });

  it('rejects 2,500,001 cents ($25,000.01) with a check violation on amount_cents', async () => {
    const error = await expectPgError(insertDonation({ amount_cents: 2_500_001 }), CHECK_VIOLATION);
    expect(error.constraint).toMatch(/amount_cents/);
  });

  it('accepts exactly 100 and exactly 2,500,000 cents', async () => {
    await insertDonation({ amount_cents: 100 });
    await insertDonation({ amount_cents: 2_500_000 });
    const { rows } = await pool.query<{ amount_cents: number }>(
      'SELECT amount_cents FROM donations ORDER BY amount_cents',
    );
    expect(rows.map((r) => r.amount_cents)).toEqual([100, 2_500_000]);
  });

  it('rejects a campaign whose min_cents is below 100', async () => {
    await expectPgError(
      pool.query(
        `INSERT INTO campaigns (id, slug, title, goal_cents, min_cents, max_cents, preset_cents)
         VALUES ($1, 'low', 'Low', 1000, 99, 2500000, '{}')`,
        [randomUUID()],
      ),
      CHECK_VIOLATION,
    );
  });

  it('rejects a campaign whose max_cents is above 2,500,000', async () => {
    await expectPgError(
      pool.query(
        `INSERT INTO campaigns (id, slug, title, goal_cents, min_cents, max_cents, preset_cents)
         VALUES ($1, 'high', 'High', 1000, 100, 2500001, '{}')`,
        [randomUUID()],
      ),
      CHECK_VIOLATION,
    );
  });
});

describe('uniqueness and references', () => {
  it('rejects a duplicate receipt_number with a unique violation', async () => {
    await insertDonation({ receipt_number: 'HCC-DUP-000001' });
    const error = await expectPgError(
      insertDonation({ receipt_number: 'HCC-DUP-000001' }),
      UNIQUE_VIOLATION,
    );
    expect(error.constraint).toMatch(/receipt_number/);
  });

  it('rejects a duplicate idempotency_key but allows several nulls (import rows)', async () => {
    await insertDonation({ idempotency_key: 'same' });
    await expectPgError(insertDonation({ idempotency_key: 'same' }), UNIQUE_VIOLATION);
    await insertDonation({ source: 'import', idempotency_key: null });
    await insertDonation({ source: 'import', idempotency_key: null });
  });

  it('rejects an unknown campaign_id with a foreign key violation', async () => {
    await expectPgError(insertDonation({ campaign_id: randomUUID() }), FK_VIOLATION);
  });

  it('rejects an unknown donor_id with a foreign key violation', async () => {
    await expectPgError(insertDonation({ donor_id: randomUUID() }), FK_VIOLATION);
  });

  it('rejects donor emails that differ only in case (citext)', async () => {
    await expectPgError(
      pool.query(
        `INSERT INTO donors (id, email, full_name) VALUES ($1, 'FIRST@Example.ORG', 'X')`,
        [randomUUID()],
      ),
      UNIQUE_VIOLATION,
    );
  });

  it('rejects a second refund for the same donation (refunds.donation_id unique)', async () => {
    const donationId = randomUUID();
    await insertDonation({ id: donationId });
    const insertRefund = (): Promise<unknown> =>
      pool.query(
        `INSERT INTO refunds (id, donation_id, actor_id, reason, amount_cents)
         VALUES ($1, $2, $3, 'duplicate', 5000)`,
        [randomUUID(), donationId, donorId],
      );
    await insertRefund();
    const error = await expectPgError(insertRefund(), UNIQUE_VIOLATION);
    expect(error.constraint).toMatch(/donation_id/);
  });

  it('rejects a duplicate sessions.token_hash', async () => {
    const insertSession = (): Promise<unknown> =>
      pool.query(
        `INSERT INTO sessions (id, token_hash, donor_id, expires_at)
         VALUES ($1, 'hash', $2, now() + interval '1 day')`,
        [randomUUID(), donorId],
      );
    await insertSession();
    const error = await expectPgError(insertSession(), UNIQUE_VIOLATION);
    expect(error.constraint).toMatch(/token_hash/);
  });
});

describe('enums', () => {
  it('rejects an unknown donation status', async () => {
    const error = await expectPgError(insertDonation({ status: 'settled' }), CHECK_VIOLATION);
    expect(error.constraint).toMatch(/status/);
  });

  it('rejects an unknown privacy_mode', async () => {
    await expectPgError(insertDonation({ privacy_mode: 'secret' }), CHECK_VIOLATION);
  });

  it('rejects an unknown dedication_type', async () => {
    await expectPgError(
      insertDonation({ dedication_type: 'in_spite_of', dedication_name: 'X' }),
      CHECK_VIOLATION,
    );
  });

  it('rejects an unknown source', async () => {
    await expectPgError(insertDonation({ source: 'mobile' }), CHECK_VIOLATION);
  });

  it('rejects an unknown donor role', async () => {
    await expectPgError(
      pool.query(
        `INSERT INTO donors (id, email, full_name, role) VALUES ($1, 'r@x.org', 'R', 'root')`,
        [randomUUID()],
      ),
      CHECK_VIOLATION,
    );
  });
});

// The four checks only apply to rows that did not come from the CSV import. Each one is
// proven in both directions: a web row is rejected, and the same row marked `import` is
// accepted, so the exemption is what the test is really pinning down.
describe('non-import checks (legacy exemption)', () => {
  it('rejects a non-import message of 281 code points, accepts 280 emoji', async () => {
    await expectPgError(insertDonation({ message: 'a'.repeat(281) }), CHECK_VIOLATION);
    // 280 emoji are 560 UTF-16 units: this fails if the limit counts units, not code points.
    await insertDonation({ message: '😀'.repeat(280) });
    await expectPgError(insertDonation({ message: '😀'.repeat(281) }), CHECK_VIOLATION);
  });

  it('rejects a non-import dedication_type without a name, and a name without a type', async () => {
    await expectPgError(
      insertDonation({ dedication_type: 'in_honor_of', dedication_name: null }),
      CHECK_VIOLATION,
    );
    await expectPgError(
      insertDonation({ dedication_type: null, dedication_name: 'Someone' }),
      CHECK_VIOLATION,
    );
    await insertDonation({ dedication_type: 'in_memory_of', dedication_name: 'Someone' });
  });

  it('rejects a non-import row without an idempotency_key', async () => {
    await expectPgError(insertDonation({ idempotency_key: null }), CHECK_VIOLATION);
  });

  it('rejects a non-import refunded row without refunded_at, and the reverse', async () => {
    await expectPgError(insertDonation({ status: 'refunded', refunded_at: null }), CHECK_VIOLATION);
    await expectPgError(
      insertDonation({ status: 'completed', refunded_at: new Date().toISOString() }),
      CHECK_VIOLATION,
    );
    await insertDonation({ status: 'refunded', refunded_at: new Date().toISOString() });
  });

  it('exempts an import row from all four checks at once', async () => {
    await insertDonation({
      source: 'import',
      message: 'a'.repeat(281),
      dedication_type: 'in_honor_of',
      dedication_name: null,
      idempotency_key: null,
      status: 'refunded',
      refunded_at: null,
    });
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::bigint AS n FROM donations WHERE source = 'import'`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('still applies the range and enum checks to import rows', async () => {
    await expectPgError(insertDonation({ source: 'import', amount_cents: 99 }), CHECK_VIOLATION);
    await expectPgError(insertDonation({ source: 'import', status: 'bogus' }), CHECK_VIOLATION);
  });
});

describe('schema objects and idempotent migration', () => {
  it('creates the citext and pg_trgm extensions', async () => {
    const { rows } = await pool.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pg_trgm') ORDER BY extname`,
    );
    expect(rows.map((r) => r.extname)).toEqual(['citext', 'pg_trgm']);
  });

  // Read from the catalog rather than calling nextval, which would consume a receipt number
  // on the shared container.
  it('creates receipt_number_seq', async () => {
    const { rows } = await pool.query<{ sequencename: string }>(
      `SELECT sequencename FROM pg_sequences WHERE sequencename = 'receipt_number_seq'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('running the migrations again does not throw and leaves the schema unchanged', async () => {
    const before = await schemaSnapshot();
    await expect(runMigrations(db)).resolves.toBeUndefined();
    await expect(runMigrations(db)).resolves.toBeUndefined();
    expect(await schemaSnapshot()).toEqual(before);
  });
});

describe('int8 handling', () => {
  it('returns amount_cents as a JS number', async () => {
    await insertDonation({ amount_cents: 2_500_000 });
    const { rows } = await pool.query<{ amount_cents: unknown }>(
      'SELECT amount_cents FROM donations',
    );
    expect(typeof rows[0]?.amount_cents).toBe('number');
    expect(rows[0]?.amount_cents).toBe(2_500_000);
  });

  it('accepts the largest safe integer', async () => {
    const { rows } = await pool.query<{ v: unknown }>(
      `SELECT ${String(Number.MAX_SAFE_INTEGER)}::int8 AS v`,
    );
    expect(rows[0]?.v).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects a value just above Number.MAX_SAFE_INTEGER instead of rounding it', async () => {
    await expect(pool.query('SELECT 9007199254740993::int8 AS v')).rejects.toThrow(
      /outside the safe integer range/,
    );
    // The failed parse must not poison the pool for the next caller.
    await expect(pool.query('SELECT 1 AS v')).resolves.toMatchObject({ rows: [{ v: 1 }] });
  });

  // pg-types would hand back ['1000', '5000'] here while the Database type says number[].
  it('returns an int8[] column as an array of numbers', async () => {
    const { rows } = await pool.query<{ preset_cents: unknown }>(
      'SELECT preset_cents FROM campaigns',
    );
    expect(rows[0]?.preset_cents).toEqual([1000, 5000]);
  });

  it('rejects an int8[] element above Number.MAX_SAFE_INTEGER', async () => {
    await expect(pool.query('SELECT ARRAY[9007199254740993]::int8[] AS v')).rejects.toThrow(
      /outside the safe integer range/,
    );
  });

  it('keeps an uncast SUM() as a string (numeric) and a ::bigint SUM() as a number', async () => {
    await insertDonation({ amount_cents: 100 });
    await insertDonation({ amount_cents: 250 });
    const { rows } = await pool.query<{ raw: unknown; cast: unknown }>(
      'SELECT SUM(amount_cents) AS raw, SUM(amount_cents)::bigint AS cast FROM donations',
    );
    expect(rows[0]?.raw).toBe('350');
    expect(rows[0]?.cast).toBe(350);
  });
});

// Every other test uses raw SQL. This one goes through Kysely so the hand-written Database
// types are compiled against the migrated schema: a column that is nullable in SQL but not
// in the type, or the reverse, stops this file from type-checking or from running.
describe('typed access through Kysely', () => {
  it('round-trips a campaign, a donor and a donation with their TypeScript types', async () => {
    const campaign = await db
      .insertInto('campaigns')
      .values({
        slug: 'round-trip',
        title: 'Round trip',
        goal_cents: 5_000_000,
        min_cents: 100,
        max_cents: 2_500_000,
        preset_cents: [1000, 5000, 25_000],
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(campaign.preset_cents).toEqual([1000, 5000, 25_000]);
    expect(campaign.goal_cents).toBe(5_000_000);
    expect(campaign.currency).toBe('USD');
    expect(campaign.is_active).toBe(true);
    expect(campaign.story).toBeNull();
    expect(campaign.created_at).toBeInstanceOf(Date);

    const donor = await db
      .insertInto('donors')
      .values({ email: 'Round.Trip@Example.org', full_name: 'Round Trip' })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(donor.role).toBe('donor');
    expect(donor.password_hash).toBeNull();

    const donation = await db
      .insertInto('donations')
      .values({
        campaign_id: campaign.id,
        donor_id: donor.id,
        donor_name: donor.full_name,
        amount_cents: 2_500_000,
        currency: 'USD',
        status: 'completed',
        message: 'Para a família 😀',
        idempotency_key: 'round-trip-1',
        receipt_number: 'HCC-TEST-RT0001',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(donation.amount_cents).toBe(2_500_000);
    expect(donation.message).toBe('Para a família 😀');
    expect(donation.privacy_mode).toBe('public');
    expect(donation.source).toBe('web');
    expect(donation.refunded_at).toBeNull();

    const read = await db
      .selectFrom('donations')
      .innerJoin('donors', 'donors.id', 'donations.donor_id')
      .select(['donations.amount_cents', 'donors.email'])
      .where('donations.id', '=', donation.id)
      .executeTakeFirstOrThrow();
    expect(read.amount_cents).toBe(2_500_000);
    // citext keeps the case it was given and compares without it.
    expect(read.email).toBe('Round.Trip@Example.org');
  });
});
