import { fileURLToPath } from 'node:url';
import { AdminDonationPageSchema, type AdminDonationPage } from '@aangan/shared';
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
import { buildAdminDonationsQuery } from '../../src/repositories/donor-records.js';
import { listAdminDonations } from '../../src/services/donor-records.js';
import { testIntake } from '../intake.js';

const SEED_DIR = fileURLToPath(
  new URL('../../../../roles/full-stack-engineer/seed', import.meta.url),
);

const ADMIN = { email: 'admin@himalayacc.example', password: 'admin12345' };
const DONOR = { email: 'donor@himalayacc.example', password: 'donor12345' };

let pool: pg.Pool;
let db: Kysely<Database>;
let app: ReturnType<typeof createApp>;
let adminCookie = '';
let donorCookie = '';
let donorId = '';

async function cookieFor(account: { email: string; password: string }): Promise<string> {
  const res = await request(app).post('/api/auth/login').send(account);
  const header: unknown = res.headers['set-cookie'];
  const first: unknown = Array.isArray(header) ? header[0] : header;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  await pool.query('ALTER SEQUENCE receipt_number_seq RESTART');
  await runSeed(db, loadSeed(SEED_DIR));
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
  adminCookie = await cookieFor(ADMIN);
  donorCookie = await cookieFor(DONOR);
  const donor = await pool.query<{ id: string }>('SELECT id FROM donors WHERE email = $1', [
    DONOR.email,
  ]);
  donorId = donor.rows[0]?.id ?? '';
}, 60_000);

afterAll(async () => {
  await db.destroy();
});

const list = (query: string, cookie = adminCookie) =>
  request(app).get(`/api/admin/donations${query}`).set('Cookie', cookie);

async function page(query: string): Promise<AdminDonationPage> {
  const res = await list(query);
  expect(res.status).toBe(200);
  return AdminDonationPageSchema.parse(res.body);
}

// A synthetic row for cases the seed does not cover (a pending status, an accented name).
async function insertDonation(name: string, status: string, receipt: string): Promise<void> {
  await pool.query(
    `INSERT INTO donations (campaign_id, donor_id, donor_name, amount_cents, currency, status,
                            receipt_number, source)
     SELECT campaign_id, donor_id, $1, 5000, currency, $2, $3, 'import' FROM donations LIMIT 1`,
    [name, status, receipt],
  );
}

describe('GET /api/admin/donations', () => {
  it('returns the first page, newest first, with the totals of the whole set', async () => {
    const result = await page('');

    expect(result).toMatchObject({ page: 1, pageSize: 25, total: 75, totalPages: 3 });
    expect(result.data).toHaveLength(25);
    const dates = result.data.map((row) => row.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('gives the office the donor email and the failure code, which the donor view never has', async () => {
    const result = await page('?status=failed');

    expect(result.data).toHaveLength(2);
    for (const row of result.data) {
      expect(row.donorEmail).toMatch(/@/);
      expect(row).toHaveProperty('failureCode');
    }
  });

  it('is cached by no one', async () => {
    expect((await list('')).headers['cache-control']).toBe('no-store');
  });
});

describe('status filter', () => {
  it.each([
    ['completed', 66],
    ['refunded', 7],
    ['failed', 2],
  ])('shows only %s rows (%i)', async (status, count) => {
    const result = await page(`?status=${status}&pageSize=100`);
    expect(result.total).toBe(count);
    expect(result.data.every((row) => row.status === status)).toBe(true);
  });

  it('finds a pending row, so a timed-out charge can be reconciled by hand', async () => {
    await insertDonation('Pending Person', 'pending', 'HCC-2026-009001');
    try {
      const result = await page('?status=pending');
      expect(result.data.map((row) => row.donorName)).toEqual(['Pending Person']);
    } finally {
      await pool.query("DELETE FROM donations WHERE receipt_number = 'HCC-2026-009001'");
    }
  });
});

describe('search', () => {
  it('matches part of a Devanagari name', async () => {
    const result = await page(`?q=${encodeURIComponent('गुरुङ')}`);

    expect(result.total).toBe(1);
    expect(result.data[0]?.donorName).toContain('गुरुङ');
  });

  it('matches part of an email, ignoring case', async () => {
    const lower = await page('?q=donor%40himalayacc');
    const upper = await page('?q=DONOR%40HIMALAYACC');

    expect(lower.data.map((row) => row.donorEmail)).toEqual(
      Array(3).fill('donor@himalayacc.example'),
    );
    expect(upper.total).toBe(lower.total);
  });

  it('reads the search as NFC, so a decomposed accent finds the stored one', async () => {
    await insertDonation('Zoé Silva', 'completed', 'HCC-2026-009002');
    try {
      const result = await page(`?q=${encodeURIComponent('Zoé')}`);
      expect(result.data.map((row) => row.donorName)).toEqual(['Zoé Silva']);
    } finally {
      await pool.query("DELETE FROM donations WHERE receipt_number = 'HCC-2026-009002'");
    }
  });

  // Without ESCAPE handling '%' would be "match everything" and '_' "any one character".
  it.each(['%', '_', '\\'])('reads %s as a literal character, not a wildcard', async (q) => {
    const literal = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM donations d JOIN donors p ON p.id = d.donor_id
        WHERE strpos(d.donor_name, $1) > 0 OR strpos(p.email::text, $1) > 0`,
      [q],
    );

    const result = await page(`?q=${encodeURIComponent(q)}`);

    expect(result.total).toBe(literal.rows[0]?.n);
    expect(result.total).toBeLessThan(75);
  });

  // The seed holds none of these, so each needs a row of its own to prove the escape.
  it.each([
    ['100% sure', '%'],
    ['a\\b', '\\'],
  ])('finds the row whose name contains the literal %s', async (name, q) => {
    await insertDonation(name, 'completed', 'HCC-2026-009003');
    await insertDonation('plain name', 'completed', 'HCC-2026-009004');
    try {
      const result = await page(`?q=${encodeURIComponent(q)}`);
      expect(result.data.map((row) => row.donorName)).toEqual([name]);
    } finally {
      await pool.query(
        "DELETE FROM donations WHERE receipt_number IN ('HCC-2026-009003', 'HCC-2026-009004')",
      );
    }
  });

  // U+0958 is a composition exclusion: its NFC form is two code points, so a query typed with
  // U+0958 only finds the stored name if the search is normalised first.
  it('finds a Devanagari name whose typed form differs from its NFC form', async () => {
    const stored = '\u0958ुमार'.normalize('NFC');
    expect(stored.startsWith('\u0958')).toBe(false);
    await insertDonation(stored, 'completed', 'HCC-2026-009005');
    try {
      const result = await page(`?q=${encodeURIComponent('\u0958ुमार')}`);
      expect(result.data.map((row) => row.donorName)).toEqual([stored]);
    } finally {
      await pool.query("DELETE FROM donations WHERE receipt_number = 'HCC-2026-009005'");
    }
  });

  it('treats a blank search as no search', async () => {
    expect((await page('?q=%20%20')).total).toBe(75);
  });

  it('can use the trigram index on donors.email', async () => {
    const compiled = buildAdminDonationsQuery(db, {
      viewerId: donorId,
      isAdmin: true,
      query: { q: 'anisha', sort: 'createdAt', dir: 'desc', page: 1, pageSize: 25 },
    }).compile();
    const client = await pool.connect();
    try {
      await client.query('SET enable_seqscan = off');
      const plan = await client.query<Record<string, string>>(`EXPLAIN ${compiled.sql}`, [
        ...compiled.parameters,
      ]);
      const text = plan.rows.map((row) => Object.values(row).join(' ')).join('\n');
      expect(text).toContain('donors_email_trgm_idx');
    } finally {
      // The setting would otherwise stay on the pooled connection for later tests.
      await client.query('RESET enable_seqscan');
      client.release();
    }
  });
});

describe('sorting and validation', () => {
  it('sorts by amount in the requested direction', async () => {
    const asc = (await page('?sort=amountCents&dir=asc&pageSize=100')).data.map(
      (row) => row.amountCents,
    );
    const desc = (await page('?sort=amountCents&dir=desc&pageSize=100')).data.map(
      (row) => row.amountCents,
    );

    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it.each([
    ['page 0', '?page=0'],
    ['a fractional page', '?page=1.5'],
    ['an exponent page', '?page=1e1'],
    ['pageSize 101', '?pageSize=101'],
    ['an unknown sort', '?sort=donor_email'],
    ['an unknown direction', '?dir=sideways'],
    ['an unknown status', '?status=paid'],
    ['an unknown key', '?limit=5'],
    ['a repeated key', '?q=a&q=b'],
    ['an SQL fragment as a sort', '?sort=amount_cents;drop%20table%20donations'],
  ])('refuses %s with 422', async (_label, query) => {
    const res = await list(query);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('answers a donor 403 before it looks at the query', async () => {
    expect((await list('?page=0', donorCookie)).status).toBe(403);
  });
});

describe('viewer scope in the query', () => {
  // The route guard already keeps donors out. The query keeps its own WHERE so a refactor that
  // drops the guard still cannot show a donor anyone else's rows (tech spec 005 F9).
  it('returns only the viewer’s own rows when the viewer is not an admin', async () => {
    const result = await listAdminDonations(db, {
      viewer: { id: donorId, email: DONOR.email, fullName: 'Test Donor', role: 'donor' },
      query: { sort: 'createdAt', dir: 'desc', page: 1, pageSize: 100 },
    });

    expect(result.total).toBe(3);
    expect(result.data.every((row) => row.donorEmail === DONOR.email)).toBe(true);
  });
});

describe('paging', () => {
  it('walks 75 rows in pages of 10 without repeating or skipping one, and page 9 is empty', async () => {
    const seen = new Set<string>();
    for (let n = 1; n <= 8; n++) {
      const result = await page(`?pageSize=10&page=${String(n)}`);
      expect(result).toMatchObject({ total: 75, totalPages: 8 });
      for (const row of result.data) seen.add(row.id);
    }
    expect(seen.size).toBe(75);

    const past = await page('?pageSize=10&page=9');
    expect(past).toMatchObject({ data: [], total: 75, totalPages: 8 });
  });

  it('keeps that true when every row has the same timestamp, which only the id tie-break orders', async () => {
    await pool.query("UPDATE donations SET created_at = '2026-01-01T00:00:00Z'");

    for (const sort of ['createdAt', 'amountCents']) {
      const seen = new Set<string>();
      for (let n = 1; n <= 8; n++) {
        for (const row of (await page(`?pageSize=10&page=${String(n)}&sort=${sort}`)).data)
          seen.add(row.id);
      }
      expect(seen.size).toBe(75);
    }
  });
});
