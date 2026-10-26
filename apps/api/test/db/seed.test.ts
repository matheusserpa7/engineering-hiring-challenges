import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { verifyPassword } from '../../src/auth/password.js';
import { createDb, type Database } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { loadSeed, runSeed, type ParsedSeed } from '../../src/db/seed/seed.js';
import { createLogger } from '../../src/logger.js';

const SEED_DIR = fileURLToPath(
  new URL('../../../../roles/full-stack-engineer/seed', import.meta.url),
);

const ACCOUNTS = [
  { email: 'admin@himalayacc.example', password: 'admin12345', role: 'admin', name: 'HCC Admin' },
  { email: 'donor@himalayacc.example', password: 'donor12345', role: 'donor', name: 'Test Donor' },
  { email: 'other@himalayacc.example', password: 'other12345', role: 'donor', name: 'Other Donor' },
] as const;

const receipt = (n: number): string => `HCC-2026-${String(n).padStart(6, '0')}`;

let pool: pg.Pool;
let db: Kysely<Database>;
let seed: ParsedSeed;

async function seedOnce(): Promise<void> {
  await runSeed(db, seed);
}

async function count(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? -1;
}

async function tableCounts(): Promise<Record<string, number>> {
  const tables = ['campaigns', 'donors', 'donations', 'refunds', 'sessions'];
  const entries = await Promise.all(tables.map(async (t) => [t, await count(t)] as const));
  return Object.fromEntries(entries);
}

async function passwordHashes(): Promise<Record<string, string | null>> {
  const { rows } = await pool.query<{ email: string; password_hash: string | null }>(
    'SELECT email::text AS email, password_hash FROM donors ORDER BY email',
  );
  return Object.fromEntries(rows.map((r) => [r.email, r.password_hash]));
}

async function donationRow(n: number): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<Record<string, unknown>>(
    'SELECT * FROM donations WHERE receipt_number = $1',
    [receipt(n)],
  );
  const row = rows[0];
  expect(row, `donation ${receipt(n)} should exist`).toBeDefined();
  return row ?? {};
}

async function ownedReceipts(email: string): Promise<string[]> {
  const { rows } = await pool.query<{ receipt_number: string }>(
    `SELECT d.receipt_number FROM donations d JOIN donors o ON o.id = d.donor_id
      WHERE o.email = $1 ORDER BY d.receipt_number`,
    [email],
  );
  return rows.map((r) => r.receipt_number);
}

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
  seed = loadSeed(SEED_DIR);
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  // The container is shared with the other integration files. RESTART IDENTITY does not
  // reach receipt_number_seq because it is a standalone sequence.
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  await pool.query('ALTER SEQUENCE receipt_number_seq RESTART');
});

describe('seeded data', () => {
  it('loads 75 donations in 3 campaigns split 66/7/2 by status and 48/15/12 by privacy', async () => {
    await seedOnce();

    expect(await count('donations')).toBe(75);
    expect(await count('campaigns')).toBe(3);
    const byStatus = await pool.query<{ status: string; n: number }>(
      'SELECT status, count(*)::int AS n FROM donations GROUP BY status',
    );
    expect(Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n]))).toEqual({
      completed: 66,
      refunded: 7,
      failed: 2,
    });
    const byPrivacy = await pool.query<{ privacy_mode: string; n: number }>(
      'SELECT privacy_mode, count(*)::int AS n FROM donations GROUP BY privacy_mode',
    );
    expect(Object.fromEntries(byPrivacy.rows.map((r) => [r.privacy_mode, r.n]))).toEqual({
      public: 48,
      anonymous: 15,
      family: 12,
    });
  });

  it('sums the completed Aangan donations to 4305800 cents', async () => {
    await seedOnce();

    const { rows } = await pool.query<{ total: number }>(
      `SELECT COALESCE(SUM(d.amount_cents), 0)::bigint AS total
         FROM donations d JOIN campaigns c ON c.id = d.campaign_id
        WHERE d.status = 'completed' AND c.slug = 'aangan-courtyard'`,
    );
    expect(rows[0]?.total).toBe(4305800);
  });

  it('keeps the comma-and-quote name of row 1 byte for byte', async () => {
    await seedOnce();

    expect((await donationRow(1)).donor_name).toBe('Shrestha, Bijay "BJ"');
  });

  it('stores the Devanagari text of row 2 in NFC form, unchanged', async () => {
    await seedOnce();

    const row = await donationRow(2);
    for (const field of ['donor_name', 'dedication_name', 'message'] as const) {
      const value = row[field];
      expect(typeof value).toBe('string');
      expect(value).toBe(String(value).normalize('NFC'));
    }
    expect(row.donor_name).toBe('अनिशा गुरुङ');
    expect(row.dedication_name).toBe('बुबा');
    expect(row.message).toBe('सधैं सम्झनामा।');
  });

  it('gives rows 11 and 12 one lower-case donor and creates one donor per distinct email', async () => {
    await seedOnce();

    const a = await donationRow(11);
    const b = await donationRow(12);
    expect(a.donor_id).toBe(b.donor_id);
    const { rows } = await pool.query<{ email: string }>(
      'SELECT email::text AS email FROM donors WHERE id = $1',
      [a.donor_id],
    );
    const email = rows[0]?.email ?? '';
    expect(email).not.toBe('');
    expect(email).toBe(email.toLowerCase());

    const emails = new Set(seed.donations.map((d) => d.donorEmail.toLowerCase()));
    for (const account of ACCOUNTS) emails.add(account.email);
    expect(emails.size).toBeLessThan(seed.donations.length + ACCOUNTS.length);
    expect(await count('donors')).toBe(emails.size);
    expect(await count('donors')).toBeLessThan(await count('donations'));
  });

  it('creates the three fixture accounts with their role, name and a verifiable scrypt hash', async () => {
    await seedOnce();

    const hashes = await passwordHashes();
    for (const account of ACCOUNTS) {
      const { rows } = await pool.query<{ role: string; full_name: string }>(
        'SELECT role, full_name FROM donors WHERE email = $1',
        [account.email],
      );
      expect(rows[0], account.email).toEqual({ role: account.role, full_name: account.name });
      const hash = hashes[account.email];
      expect(typeof hash).toBe('string');
      expect(await verifyPassword(account.password, hash ?? '')).toBe(true);
      const other = ACCOUNTS.find((a) => a.email !== account.email);
      expect(await verifyPassword(other?.password ?? '', hash ?? '')).toBe(false);
    }
  });

  it('leaves password_hash NULL and the donor role on every non-fixture donor', async () => {
    await seedOnce();

    const fixtureEmails = ACCOUNTS.map((a) => a.email);
    const { rows } = await pool.query<{ password_hash: string | null; role: string }>(
      'SELECT password_hash, role FROM donors WHERE email <> ALL ($1::citext[])',
      [fixtureEmails],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.password_hash).toBeNull();
      expect(row.role).toBe('donor');
    }
  });

  it('assigns donations to the fixture accounts as the seed describes', async () => {
    await seedOnce();

    expect(await ownedReceipts('admin@himalayacc.example')).toEqual([]);
    expect(await ownedReceipts('donor@himalayacc.example')).toEqual([19, 20, 21].map(receipt));
    expect(await ownedReceipts('other@himalayacc.example')).toEqual([22, 23].map(receipt));
  });

  it('imports every row as source import with no refund timestamp, key or refunds row', async () => {
    await seedOnce();

    const { rows } = await pool.query<{
      source: string;
      refunded_at: Date | null;
      idempotency_key: string | null;
    }>('SELECT source, refunded_at, idempotency_key FROM donations');
    expect(rows).toHaveLength(75);
    for (const row of rows) {
      expect(row.source).toBe('import');
      expect(row.refunded_at).toBeNull();
      expect(row.idempotency_key).toBeNull();
    }
    expect(await count('refunds')).toBe(0);
  });

  it('accepts the legacy rows that break the web rules: a 283-code-point message and a type without a name', async () => {
    await seedOnce();

    const long = seed.donations.find((d) => d.receiptNumber === receipt(14));
    expect(long?.message).toBeTruthy();
    // Code points, not UTF-16 units: the same unit the database check counts.
    expect(Array.from(long?.message ?? '').length).toBeGreaterThan(280);
    const stored = await donationRow(14);
    expect(stored.message).toBe(long?.message);

    const unnamed = seed.donations.find((d) => d.receiptNumber === receipt(71));
    expect(unnamed?.dedicationType).not.toBeNull();
    expect(unnamed?.dedicationName).toBeNull();
    const row = await donationRow(71);
    expect(row.dedication_type).toBe(unnamed?.dedicationType);
    expect(row.dedication_name).toBeNull();
  });

  it('keeps the CSV timestamp of row 1 in UTC for created_at and updated_at', async () => {
    await seedOnce();

    const row = await donationRow(1);
    expect((row.created_at as Date).toISOString()).toBe('2026-08-01T15:04:00.000Z');
    expect((row.updated_at as Date).toISOString()).toBe('2026-08-01T15:04:00.000Z');
  });
});

describe('seeded columns', () => {
  it('stores a campaign with every field of campaigns.json', async () => {
    await seedOnce();
    const expected = seed.campaigns.find((c) => c.slug === 'aangan-courtyard');
    expect(expected).toBeDefined();

    const { rows } = await pool.query<Record<string, unknown>>(
      "SELECT * FROM campaigns WHERE slug = 'aangan-courtyard'",
    );
    expect(rows[0]).toMatchObject({
      title: expected?.title,
      story: expected?.story,
      goal_cents: 15_000_000,
      currency: 'USD',
      min_cents: 100,
      max_cents: 2_500_000,
      preset_cents: [2100, 5100, 10_100, 50_100, 100_100],
      is_active: true,
    });
    expect((rows[0]?.starts_at as Date).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect((rows[0]?.ends_at as Date).toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });

  it('stores an open-ended, closed campaign as the file describes it', async () => {
    await seedOnce();
    const { rows } = await pool.query<{ slug: string; ends_at: Date | null; is_active: boolean }>(
      'SELECT slug, ends_at, is_active FROM campaigns ORDER BY slug',
    );
    expect(rows.map((r) => [r.slug, r.ends_at === null, r.is_active])).toEqual([
      ['aangan-courtyard', false, true],
      ['annadaan-kitchen', true, true],
      ['roof-repair-2025', false, false],
    ]);
  });

  it('maps the donation columns of a family-privacy row with a dedication', async () => {
    await seedOnce();
    // Row 6: family privacy, in honor of Hajurama, $51.00, no message.
    expect(await donationRow(6)).toMatchObject({
      donor_name: 'Maya Gurung',
      amount_cents: 5100,
      currency: 'USD',
      status: 'completed',
      privacy_mode: 'family',
      dedication_type: 'in_honor_of',
      dedication_name: 'Hajurama',
      message: null,
      is_recurring: false,
    });
  });
});

describe('re-running the seed', () => {
  it('changes no row count and no password hash on the second and third run', async () => {
    await seedOnce();
    const counts = await tableCounts();
    const hashes = await passwordHashes();
    expect(counts.donations).toBe(75);

    await seedOnce();
    expect(await tableCounts()).toEqual(counts);
    expect(await passwordHashes()).toEqual(hashes);

    await seedOnce();
    expect(await tableCounts()).toEqual(counts);
    expect(await passwordHashes()).toEqual(hashes);
  });

  // Both runs insert the same rows in the same order, so the second waits on the first's keys
  // and then skips. The end state must be exactly what one run gives, and the accounts must
  // still log in.
  it('ends exactly as one run does when two seeds run at the same time', async () => {
    await seedOnce();
    const baseline = await tableCounts();
    await pool.query(
      'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
    );

    await Promise.all([seedOnce(), seedOnce()]);

    expect(await tableCounts()).toEqual(baseline);
    expect(baseline.donations).toBe(75);
    const hashes = await passwordHashes();
    for (const account of ACCOUNTS) {
      await expect(verifyPassword(account.password, hashes[account.email] ?? '')).resolves.toBe(
        true,
      );
    }
  });

  it('never updates an existing row and keeps a web donation made after the first run', async () => {
    await seedOnce();
    await pool.query(`UPDATE donations SET donor_name = 'Edited' WHERE receipt_number = $1`, [
      receipt(8),
    ]);
    const { rows } = await pool.query<{ id: string; campaign_id: string; donor_id: string }>(
      'SELECT id, campaign_id, donor_id FROM donations WHERE receipt_number = $1',
      [receipt(1)],
    );
    const base = rows[0];
    expect(base).toBeDefined();
    await pool.query(
      `INSERT INTO donations (campaign_id, donor_id, donor_name, amount_cents, currency, status,
                              receipt_number, idempotency_key, source)
       VALUES ($1, $2, 'Web Donor', 5000, 'USD', 'completed', $3, 'web-key-1', 'web')`,
      [base?.campaign_id, base?.donor_id, receipt(76)],
    );

    await seedOnce();

    expect(await count('donations')).toBe(76);
    expect((await donationRow(8)).donor_name).toBe('Edited');
    expect((await donationRow(76)).source).toBe('web');
  });

  it('keeps the role and password hash of an account that already exists', async () => {
    await pool.query(
      `INSERT INTO donors (email, full_name, password_hash, role)
       VALUES ('donor@himalayacc.example', 'Renamed', 'fake-hash', 'admin')`,
    );

    await seedOnce();

    const { rows } = await pool.query<{ role: string; password_hash: string; full_name: string }>(
      `SELECT role, password_hash, full_name FROM donors WHERE email = 'donor@himalayacc.example'`,
    );
    expect(rows).toEqual([{ role: 'admin', password_hash: 'fake-hash', full_name: 'Renamed' }]);
  });
});

describe('receipt number sequence', () => {
  it('hands out 76 after the seed', async () => {
    await seedOnce();

    const { rows } = await pool.query<{ n: number }>(`SELECT nextval('receipt_number_seq') AS n`);
    expect(rows[0]?.n).toBe(76);
  });

  it('never lowers a sequence that is already ahead of the seed', async () => {
    await seedOnce();
    await pool.query(`SELECT setval('receipt_number_seq', 500)`);

    await seedOnce();

    const { rows } = await pool.query<{ n: number }>(`SELECT nextval('receipt_number_seq') AS n`);
    expect(rows[0]?.n).toBe(501);
  });
});

describe('atomicity', () => {
  it('rejects a seed with one bad donation and leaves every table and the sequence untouched', async () => {
    const [first, ...rest] = seed.donations;
    expect(first).toBeDefined();
    const broken: ParsedSeed = {
      ...seed,
      // Built by hand to bypass the parser, so only the database CHECK can refuse it.
      donations: [...rest, ...(first ? [{ ...first, amountCents: 50 }] : [])],
    };

    await expect(runSeed(db, broken)).rejects.toThrow();

    expect(await tableCounts()).toEqual({
      campaigns: 0,
      donors: 0,
      donations: 0,
      refunds: 0,
      sessions: 0,
    });
    const { rows } = await pool.query<{ last_value: number; is_called: boolean }>(
      'SELECT last_value, is_called FROM receipt_number_seq',
    );
    expect(rows[0]).toEqual({ last_value: 1, is_called: false });
  });
});

// In the real seed no donor appears under two different names, so B1 cannot fail on it. This
// builds one: the later row comes first in the array, so only sorting by created_at gets the
// right name.
describe('naming a donor from the first donation (B1)', () => {
  it('uses the earliest donation by time, not the first one in the file', async () => {
    const template = seed.donations[0];
    if (!template) throw new Error('the seed has no donations');
    const donation = (
      receiptNumber: string,
      donorName: string,
      createdAt: string,
      donorEmail = 'two.names@example.com',
    ) => ({
      ...template,
      receiptNumber,
      donorName,
      donorEmail,
      createdAt: new Date(createdAt),
    });
    const modified: ParsedSeed = {
      ...seed,
      donations: [
        ...seed.donations,
        donation('HCC-2026-000090', 'Later Spelling', '2026-09-01T10:00:00Z'),
        donation('HCC-2026-000091', 'Earlier Spelling', '2026-09-01T09:00:00Z'),
        // The same minute: the lower receipt number decides, not the order in the file.
        donation('HCC-2026-000093', 'Tie Loser', '2026-09-02T09:00:00Z', 'tie@example.com'),
        donation('HCC-2026-000092', 'Tie Winner', '2026-09-02T09:00:00Z', 'tie@example.com'),
      ],
    };

    await runSeed(db, modified);

    const donor = await pool.query<{ full_name: string }>(
      `SELECT full_name FROM donors WHERE email = 'two.names@example.com'`,
    );
    expect(donor.rows.map((row) => row.full_name)).toEqual(['Earlier Spelling']);
    const tie = await pool.query<{ full_name: string }>(
      "SELECT full_name FROM donors WHERE email = 'tie@example.com'",
    );
    expect(tie.rows.map((row) => row.full_name)).toEqual(['Tie Winner']);
    // Each donation still carries the name it was made under.
    const names = await pool.query<{ donor_name: string }>(
      `SELECT donor_name FROM donations WHERE receipt_number IN ('HCC-2026-000090', 'HCC-2026-000091')
        ORDER BY receipt_number`,
    );
    expect(names.rows.map((row) => row.donor_name)).toEqual(['Later Spelling', 'Earlier Spelling']);
  });
});
