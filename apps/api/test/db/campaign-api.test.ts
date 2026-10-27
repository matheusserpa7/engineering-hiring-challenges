import { fileURLToPath } from 'node:url';
import { PublicCampaignSchema, type PublicCampaign } from '@aangan/shared';
import type { Kysely } from 'kysely';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDb, type Database } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { loadSeed, runSeed } from '../../src/db/seed/seed.js';
import { createLogger } from '../../src/logger.js';

const SEED_DIR = fileURLToPath(
  new URL('../../../../roles/full-stack-engineer/seed', import.meta.url),
);

const now = (): Date => new Date('2026-10-15T12:00:00Z');

let pool: pg.Pool;
let db: Kysely<Database>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  pool = createPool(inject('databaseUrl'), createLogger('silent'));
  db = createDb(pool);
  await runMigrations(db);
  await pool.query(
    'TRUNCATE refunds, sessions, donations, donors, campaigns RESTART IDENTITY CASCADE',
  );
  await pool.query('ALTER SEQUENCE receipt_number_seq RESTART');
  await runSeed(db, loadSeed(SEED_DIR));
  app = createApp({ logger: createLogger('silent'), pingDb: () => Promise.resolve(), db, now });
});

afterAll(async () => {
  await db.destroy();
});

async function getCampaign(slug: string) {
  return request(app).get(`/api/campaigns/${slug}`);
}

function parsed(body: unknown): PublicCampaign {
  return PublicCampaignSchema.parse(body);
}

async function insertCampaign(slug: string, goalCents: number): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (slug, title, goal_cents, min_cents, max_cents, preset_cents)
     VALUES ($1, $2, $3, 100, 2500000, ARRAY[2100, 5100]::bigint[]) RETURNING id`,
    [slug, `Synthetic ${slug}`, goalCents],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('campaign insert returned no row');
  return id;
}

async function insertDonor(email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO donors (email, full_name) VALUES ($1, 'Synthetic Donor') RETURNING id`,
    [email],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('donor insert returned no row');
  return id;
}

async function insertDonation(
  campaignId: string,
  donorId: string,
  receiptNumber: string,
  amountCents: number,
  status: 'completed' | 'refunded' | 'failed',
): Promise<void> {
  await pool.query(
    `INSERT INTO donations (campaign_id, donor_id, donor_name, amount_cents, currency, status,
                            receipt_number, source)
     VALUES ($1, $2, 'Synthetic Donor', $3, 'USD', $4, $5, 'import')`,
    [campaignId, donorId, amountCents, status, receiptNumber],
  );
}

async function dropCampaign(slug: string, donorEmails: string[]): Promise<void> {
  await pool.query(
    'DELETE FROM donations WHERE campaign_id IN (SELECT id FROM campaigns WHERE slug = $1)',
    [slug],
  );
  await pool.query('DELETE FROM campaigns WHERE slug = $1', [slug]);
  await pool.query('DELETE FROM donors WHERE email = ANY($1::citext[])', [donorEmails]);
}

describe('GET /api/campaigns/:slug', () => {
  const expectations = [
    {
      slug: 'aangan-courtyard',
      values: {
        goalCents: 15000000,
        raisedCents: 4305800,
        donorCount: 46,
        progressPercent: 28,
        phase: 'open',
        isActive: true,
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-12-31T23:59:59.000Z',
        presetCents: [2100, 5100, 10100, 50100, 100100],
        minCents: 100,
        maxCents: 2500000,
        currency: 'USD',
      },
    },
    {
      slug: 'annadaan-kitchen',
      values: {
        goalCents: 4000000,
        raisedCents: 286900,
        donorCount: 11,
        progressPercent: 7,
        phase: 'open',
        endsAt: null,
        maxCents: 500000,
      },
    },
    {
      slug: 'roof-repair-2025',
      values: {
        goalCents: 2000000,
        raisedCents: 318700,
        donorCount: 6,
        progressPercent: 15,
        phase: 'closed',
        isActive: false,
      },
    },
  ];

  it.each(expectations)(
    'returns the seeded totals for $slug as JS numbers that satisfy the contract',
    async ({ slug, values }) => {
      const res = await getCampaign(slug);

      expect(res.status).toBe(200);
      const body = parsed(res.body);
      expect(body.slug).toBe(slug);
      expect(body).toMatchObject(values);
      // bigint columns arrive from pg as strings, so the type is checked on the raw JSON.
      const raw = res.body as Record<string, unknown>;
      expect(typeof raw['goalCents']).toBe('number');
      expect(typeof raw['raisedCents']).toBe('number');
      expect(typeof raw['donorCount']).toBe('number');
      expect(typeof raw['progressPercent']).toBe('number');
    },
  );

  it('leaks no email address in the raw body', async () => {
    for (const { slug } of expectations) {
      const res = await getCampaign(slug);
      expect(res.status).toBe(200);
      expect(res.text).not.toContain('@');
    }
  });

  it('sends Cache-Control no-cache and an ETag that answers 304 with an empty body', async () => {
    const first = await getCampaign('aangan-courtyard');
    expect(first.headers['cache-control']).toBe('no-cache');
    const etag = first.headers['etag'];
    expect(etag).toBeTruthy();

    const second = await request(app)
      .get('/api/campaigns/aangan-courtyard')
      .set('If-None-Match', String(etag));

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it('returns 200 with zeros for a campaign that has only refunded and failed gifts', async () => {
    const slug = 'test-empty';
    const email = 'empty-donor@synthetic.example';
    try {
      const campaignId = await insertCampaign(slug, 1000000);
      const donorId = await insertDonor(email);
      await insertDonation(campaignId, donorId, 'HCC-2026-000900', 5000, 'refunded');
      await insertDonation(campaignId, donorId, 'HCC-2026-000901', 5000, 'failed');

      const res = await getCampaign(slug);

      expect(res.status).toBe(200);
      expect(parsed(res.body)).toMatchObject({
        raisedCents: 0,
        donorCount: 0,
        progressPercent: 0,
      });
    } finally {
      await dropCampaign(slug, [email]);
    }
  });

  it('reports progressPercent 115 uncapped for a campaign past its goal', async () => {
    const slug = 'test-over-goal';
    const emails = ['over-a@synthetic.example', 'over-b@synthetic.example'];
    try {
      const campaignId = await insertCampaign(slug, 1000000);
      const a = await insertDonor(emails[0] ?? '');
      const b = await insertDonor(emails[1] ?? '');
      await insertDonation(campaignId, a, 'HCC-2026-000910', 575000, 'completed');
      await insertDonation(campaignId, b, 'HCC-2026-000911', 575000, 'completed');

      const res = await getCampaign(slug);

      expect(res.status).toBe(200);
      expect(parsed(res.body)).toMatchObject({
        raisedCents: 1150000,
        donorCount: 2,
        progressPercent: 115,
      });
    } finally {
      await dropCampaign(slug, emails);
    }
  });

  it('drops a refunded gift from the total and its donor from the count', async () => {
    const before = await getCampaign('aangan-courtyard');
    const oldEtag = String(before.headers['etag']);
    try {
      await pool.query(
        `UPDATE donations SET status = 'refunded' WHERE receipt_number = 'HCC-2026-000003'`,
      );

      const res = await getCampaign('aangan-courtyard');

      expect(parsed(res.body)).toMatchObject({ raisedCents: 1805800, donorCount: 45 });
      // no-cache means revalidate, which only works if the tag changes with the total: the
      // old tag has to get a fresh 200, not a 304.
      expect(res.headers['etag']).not.toBe(oldEtag);
      const stale = await request(app)
        .get('/api/campaigns/aangan-courtyard')
        .set('If-None-Match', oldEtag);
      expect(stale.status).toBe(200);
    } finally {
      await pool.query(
        `UPDATE donations SET status = 'completed' WHERE receipt_number = 'HCC-2026-000003'`,
      );
    }

    const restored = await getCampaign('aangan-courtyard');
    expect(parsed(restored.body)).toMatchObject({ raisedCents: 4305800, donorCount: 46 });
  });

  it.each([
    ['an unknown slug', 'nope'],
    ['a slug with uppercase and an underscore', 'Aangan_Courtyard'],
    ['a 200-character slug', 'a'.repeat(200)],
  ])('answers 404 not_found for %s without echoing it', async (_label, slug) => {
    const res = await getCampaign(slug);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
    expect(res.text).not.toContain(slug);
  });
});
