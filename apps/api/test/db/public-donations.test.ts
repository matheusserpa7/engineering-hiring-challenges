import { fileURLToPath } from 'node:url';
import { PublicDonationListSchema, type PublicDonation } from '@aangan/shared';
import { sql, type Kysely } from 'kysely';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDb, type Database } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { loadSeed, runSeed } from '../../src/db/seed/seed.js';
import { createLogger } from '../../src/logger.js';
import { displayNameSql } from '../../src/repositories/public-donations.js';

const SEED_DIR = fileURLToPath(
  new URL('../../../../roles/full-stack-engineer/seed', import.meta.url),
);

const now = (): Date => new Date('2026-10-15T12:00:00Z');

const AANGAN = 'aangan-courtyard';

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

function getList(slug: string, query = '') {
  return request(app).get(`/api/campaigns/${slug}/donations${query}`);
}

// Validating every 200 body with the strict schema is what proves no extra key (email, donor id)
// ever rides along with an item.
async function listItems(slug: string, query = ''): Promise<PublicDonation[]> {
  const res = await getList(slug, query);
  expect(res.status).toBe(200);
  return PublicDonationListSchema.parse(res.body).data;
}

async function idOf(receiptSuffix: number): Promise<string> {
  const receipt = `HCC-2026-${String(receiptSuffix).padStart(6, '0')}`;
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM donations WHERE receipt_number = $1',
    [receipt],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no seed donation ${receipt}`);
  return id;
}

async function ids(receipts: number[]): Promise<string[]> {
  return Promise.all(receipts.map(idOf));
}

function byId(items: PublicDonation[], id: string): PublicDonation {
  const item = items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`donation ${id} is not in the list`);
  return item;
}

// The name as it appears inside a JSON string, so a quote or tab in a name cannot hide a leak.
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

async function insertCampaign(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO campaigns (slug, title, goal_cents, min_cents, max_cents, preset_cents)
     VALUES ($1, $2, 1000000, 100, 2500000, ARRAY[2100, 5100]::bigint[]) RETURNING id`,
    [slug, `Synthetic ${slug}`],
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
  id: string,
  receiptNumber: string,
  createdAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO donations (id, campaign_id, donor_id, donor_name, amount_cents, currency, status,
                            receipt_number, source, privacy_mode, created_at)
     VALUES ($1, $2, $3, 'Synthetic Donor', 2100, 'USD', 'completed', $4, 'import', 'public', $5)`,
    [id, campaignId, donorId, receiptNumber, createdAt],
  );
}

async function dropSynthetic(slug: string, email: string): Promise<void> {
  await pool.query(
    'DELETE FROM donations WHERE campaign_id IN (SELECT id FROM campaigns WHERE slug = $1)',
    [slug],
  );
  await pool.query('DELETE FROM campaigns WHERE slug = $1', [slug]);
  await pool.query('DELETE FROM donors WHERE email = $1::citext', [email]);
}

describe('GET /api/campaigns/:slug/donations (privacy)', () => {
  it('never puts an email, a donor id or a hidden name anywhere in the raw payload', async () => {
    const res = await getList(AANGAN, '?limit=50');
    expect(res.status).toBe(200);
    const items = PublicDonationListSchema.parse(res.body).data;
    const text = res.text;
    const lower = text.toLowerCase();

    expect(text).not.toContain('@');

    const donors = await pool.query<{ id: string; email: string }>('SELECT id, email FROM donors');
    expect(donors.rows.length).toBeGreaterThan(0);
    for (const donor of donors.rows) {
      expect(lower).not.toContain(donor.email.toLowerCase());
      expect(text).not.toContain(donor.id);
    }

    // A full name may legitimately appear when another, public gift carries the same name.
    const publicNames = new Set(items.map((i) => i.displayName));
    const hidden = await pool.query<{ donor_name: string }>(
      `SELECT DISTINCT d.donor_name FROM donations d JOIN campaigns c ON c.id = d.campaign_id
       WHERE c.slug = $1 AND d.status = 'completed' AND d.privacy_mode IN ('anonymous', 'family')`,
      [AANGAN],
    );
    expect(hidden.rows.length).toBeGreaterThan(0);
    for (const { donor_name: name } of hidden.rows) {
      if (publicNames.has(name.trim())) continue;
      expect(text, `full name "${name}" leaked`).not.toContain(jsonEscaped(name.trim()));
    }

    const sita = await pool.query<{ message: string | null; dedication_name: string | null }>(
      'SELECT message, dedication_name FROM donations WHERE id = $1',
      [await idOf(13)],
    );
    const row = sita.rows[0];
    expect(row?.message).toBeTruthy();
    expect(row?.dedication_name).toBeTruthy();
    expect(text).not.toContain(jsonEscaped(row?.message ?? ''));
    // Its dedication name is "Aama", which row 1, a public gift, also uses, so the word is
    // legitimately in the payload. What must hold is that this row's own item shows no
    // dedication, and the anonymous-items test below checks exactly that by id.
  });

  it('shows anonymous gifts as Anonymous with no dedication and no message', async () => {
    const items = await listItems(AANGAN, '?limit=50');
    const anonymous = await ids([5, 13, 20, 25, 26, 34, 40, 57, 66, 70]);
    for (const id of anonymous) {
      const item = byId(items, id);
      expect(item.displayName).toBe('Anonymous');
      expect(item.dedication).toBeNull();
      expect(item.message).toBeNull();
    }
  });

  it('shows family gifts as "The <Surname> family"', async () => {
    const items = await listItems(AANGAN, '?limit=50');
    const expected: [number, string][] = [
      [6, 'The Gurung family'],
      [23, 'The Donor family'],
      [30, 'The Tuladhar family'],
      [31, 'The Oli family'],
      [32, 'The Joshi family'],
      [42, 'The Maharjan family'],
      [44, 'The Upreti family'],
      [45, 'The Ghimire family'],
      [71, 'The Sapkota family'],
      [73, 'The Pandey family'],
    ];
    for (const [receipt, displayName] of expected) {
      expect(byId(items, await idOf(receipt)).displayName).toBe(displayName);
    }
  });

  it('keeps the dedication and message of a family gift', async () => {
    const items = await listItems(AANGAN, '?limit=50');
    const item = byId(items, await idOf(73));
    expect(item.dedication).toEqual({ type: 'in_memory_of', name: 'Hajurama' });
    expect(item.message).toBeTruthy();
    expect(byId(items, await idOf(6)).dedication).toEqual({
      type: 'in_honor_of',
      name: 'Hajurama',
    });
  });
});

describe('displayNameSql evaluated in Postgres', () => {
  async function evaluate(privacy: string, input: string): Promise<string | null> {
    const r = await sql<{ name: string | null }>`select ${displayNameSql(
      sql`${privacy}::text`,
      sql`${input}::text`,
    )} as name`.execute(db);
    return r.rows[0]?.name ?? null;
  }

  const family: [string, string][] = [
    ['Maya Gurung', 'The Gurung family'],
    ['Shrestha, Bijay "BJ"', 'The Shrestha family'],
    ['Martin Luther King, Jr.', 'The King family'],
    ['अनिशा गुरुङ', 'The गुरुङ family'],
    ['  Maya   Gurung  ', 'The Gurung family'],
    ['Maya\tGurung', 'The Gurung family'],
    ['Other Donor', 'The Donor family'],
    ['Maya', 'Anonymous'],
    [', Maya', 'Anonymous'],
    [',', 'Anonymous'],
    [' ', 'Anonymous'],
    ['', 'Anonymous'],
    ['Gurung, ', 'The Gurung family'],
    ['Maya Gurung,', 'The Gurung family'],
  ];

  it.each(family)('family %j -> %j', async (input, expected) => {
    expect(await evaluate('family', input)).toBe(expected);
  });

  // Postgres does not call a no-break space or a zero-width space whitespace. Left alone, a
  // name with an ordinary space earlier and one of these before the surname matched as ONE
  // word and came out whole: "The Maya Gurung family". They are separators, so the surname is
  // found. A no-break space alone used to read as one word (Anonymous); now it finds it too.
  const exoticSpaces: [string, string][] = [
    ['no-break space after a title', 'Dr Maya\u00a0Gurung'],
    ['zero-width space after a title', 'Dr Maya\u200bGurung'],
    ['no-break space alone', 'Maya\u00a0Gurung'],
    ['ideographic space', 'Maya\u3000Gurung'],
    ['em space', 'Maya\u2003Gurung'],
    ['narrow no-break space', 'Maya\u202fGurung'],
    ['zero-width no-break space', 'Dr Maya\ufeffGurung'],
  ];

  it.each(exoticSpaces)('treats a %s as a separator', async (_label, input) => {
    expect(await evaluate('family', input)).toBe('The Gurung family');
  });

  // Not bugs to fix here: with no surname column the rule cannot know a title, or that a comma
  // means "given, surname". Pinned so it stays a documented decision (A5, ADR 0005), not a
  // surprise. Intake in spec 004 is where a name could be collected as two fields.
  const knownLimits: [string, string][] = [
    ['a comma between given name and surname', 'Maya, Gurung'],
    ['a comma with no space', 'Maya,Gurung'],
    ['a title and one name', 'Dr. Maya'],
  ];

  it.each(knownLimits)('known limit: %s shows the word it can find', async (_label, input) => {
    expect(await evaluate('family', input)).toBe('The Maya family');
  });

  it.each([
    ['', 'Anonymous'],
    ['   ', 'Anonymous'],
  ])('a public name that is blank %j shows %j', async (input, expected) => {
    expect(await evaluate('public', input)).toBe(expected);
  });

  it('leaves a public name unchanged', async () => {
    expect(await evaluate('public', 'Maya Gurung')).toBe('Maya Gurung');
  });

  it('hides the name of an anonymous donor', async () => {
    expect(await evaluate('anonymous', 'Maya Gurung')).toBe('Anonymous');
  });
});

describe('GET /api/campaigns/:slug/donations (which rows, in which order)', () => {
  it('never lists a refunded or failed donation and counts only completed ones', async () => {
    const items = await listItems(AANGAN, '?limit=50');
    const excluded = await ids([7, 8, 33, 36, 60, 61]);
    const listed = new Set(items.map((i) => i.id));
    for (const id of excluded) expect(listed.has(id)).toBe(false);
    expect(items).toHaveLength(49);
    expect(await listItems('annadaan-kitchen', '?limit=50')).toHaveLength(11);
    expect(await listItems('roof-repair-2025', '?limit=50')).toHaveLength(6);
  });

  it('lists the newest gifts first', async () => {
    const items = await listItems(AANGAN, '?limit=50');
    expect(items.slice(0, 3).map((i) => i.id)).toEqual(await ids([75, 73, 71]));
    const times = items.map((i) => Date.parse(i.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('breaks a created_at tie with the higher id first', async () => {
    const slug = 'test-order';
    const email = 'test-order@example.test';
    try {
      const campaignId = await insertCampaign(slug);
      const donorId = await insertDonor(email);
      const at = '2026-09-01T10:00:00Z';
      const low = '00000000-0000-4000-8000-000000000001';
      const high = '00000000-0000-4000-8000-000000000002';
      await insertDonation(campaignId, donorId, low, 'HCC-2026-000930', at);
      await insertDonation(campaignId, donorId, high, 'HCC-2026-000931', at);
      const items = await listItems(slug);
      expect(items.map((i) => i.id)).toEqual([high, low]);
    } finally {
      await dropSynthetic(slug, email);
    }
  });

  // The dedication rule is one expression shared by every mode; this pins the public branch,
  // since the real rows that show the half-filled case are family ones.
  it('shows no dedication for a public gift that has a type but no name', async () => {
    const slug = 'test-half-dedication';
    const email = 'half-dedication@synthetic.example';
    try {
      const campaignId = await insertCampaign(slug);
      const donorId = await insertDonor(email);
      const id = '00000000-0000-4000-8000-000000000003';
      await insertDonation(campaignId, donorId, id, 'HCC-2026-000932', '2026-09-01T10:00:00Z');
      await pool.query(
        `UPDATE donations SET privacy_mode = 'public', dedication_type = 'in_honor_of',
                dedication_name = NULL, message = 'Still shown.' WHERE id = $1`,
        [id],
      );

      const [item] = await listItems(slug);

      expect(item?.dedication).toBeNull();
      expect(item?.message).toBe('Still shown.');
    } finally {
      await dropSynthetic(slug, email);
    }
  });

  it('reflects a refund on the next read', async () => {
    const id = await idOf(75);
    try {
      await pool.query(`UPDATE donations SET status = 'refunded' WHERE id = $1`, [id]);
      const items = await listItems(AANGAN, '?limit=50');
      expect(items.map((i) => i.id)).not.toContain(id);
      expect(items[0]?.id).toBe(await idOf(73));
    } finally {
      await pool.query(`UPDATE donations SET status = 'completed' WHERE id = $1`, [id]);
    }
  });

  it('returns an empty list for a campaign with no completed gift', async () => {
    const slug = 'test-empty-list';
    try {
      await insertCampaign(slug);
      const res = await getList(slug);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    } finally {
      await pool.query('DELETE FROM campaigns WHERE slug = $1', [slug]);
    }
  });
});

describe('GET /api/campaigns/:slug/donations (limit)', () => {
  it('defaults to 20 items', async () => {
    expect(await listItems(AANGAN)).toHaveLength(20);
  });

  it('honours the bounds 1 and 50', async () => {
    expect(await listItems(AANGAN, '?limit=1')).toHaveLength(1);
    expect(await listItems(AANGAN, '?limit=50')).toHaveLength(49);
    expect(await listItems('annadaan-kitchen', '?limit=50')).toHaveLength(11);
  });

  const bad: [string, string, string][] = [
    ['?limit=0', '0', 'too_small'],
    ['?limit=51', '51', 'too_big'],
    ['?limit=-1', '-1', 'invalid_format'],
    ['?limit=1.5', '1.5', 'invalid_format'],
    ['?limit=abc', 'abc', 'invalid_format'],
    ['?limit=', '', 'invalid_format'],
    ['?limit=%205', ' 5', 'invalid_format'],
    ['?limit=1e1', '1e1', 'invalid_format'],
    ['?limit=1&limit=2', '', 'invalid_type'],
  ];

  it.each(bad)('rejects %s with 422 on field limit', async (query, value, issue) => {
    const res = await getList(AANGAN, query);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'The query is invalid.',
        details: [{ field: 'limit', issue }],
      },
    });
    if (value.length > 0) expect(res.text).not.toContain(`"${value}"`);
  });

  it('does not echo the offending value in the 422 body', async () => {
    const res = await getList(AANGAN, '?limit=abc');
    expect(res.status).toBe(422);
    expect(res.text).not.toContain('abc');
  });

  it('rejects an unknown query key with 422 on (query)', async () => {
    const res = await getList(AANGAN, '?page=2');
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'The query is invalid.',
        details: [{ field: '(query)', issue: 'unrecognized_keys' }],
      },
    });
  });

  it('answers 404 for a malformed slug before it looks at a bad limit', async () => {
    const res = await getList('Nope_X', '?limit=abc');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers 404 not_found for an unknown slug', async () => {
    const res = await getList('nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('GET /api/campaigns/:slug/donations (text rows)', () => {
  async function dbRow(receipt: number) {
    const { rows } = await pool.query<{
      message: string | null;
      dedication_type: string | null;
      dedication_name: string | null;
    }>('SELECT message, dedication_type, dedication_name FROM donations WHERE id = $1', [
      await idOf(receipt),
    ]);
    const row = rows[0];
    if (row === undefined) throw new Error(`no row for receipt ${String(receipt)}`);
    return row;
  }

  it('round-trips Devanagari text byte for byte', async () => {
    const item = byId(await listItems(AANGAN, '?limit=50'), await idOf(2));
    expect(item.displayName).toBe('अनिशा गुरुङ');
    expect(item.dedication).toEqual({ type: 'in_memory_of', name: 'बुबा' });
    expect(item.message).toBe('सधैं सम्झनामा।');
  });

  it('serves a script tag verbatim, because escaping is the page job', async () => {
    const item = byId(await listItems(AANGAN, '?limit=50'), await idOf(9));
    expect(item.message).toBe('<script>alert(1)</script>');
    expect(item.dedication).toEqual({ type: 'in_memory_of', name: 'Sano Bhai' });
  });

  it('serves an onerror payload verbatim', async () => {
    const item = byId(await listItems(AANGAN, '?limit=50'), await idOf(10));
    expect(item.message?.startsWith('<img src=x onerror="alert(')).toBe(true);
    expect(item.message).toBe((await dbRow(10)).message);
  });

  it('does not truncate a 283 code point message', async () => {
    const item = byId(await listItems(AANGAN, '?limit=50'), await idOf(14));
    expect(Array.from(item.message ?? '')).toHaveLength(283);
    expect(item.message).toBe((await dbRow(14)).message);
    expect(item.dedication).toEqual({ type: 'in_honor_of', name: 'My teacher, Mr. Rana' });
  });

  it('gives a gift without dedication or message null for both', async () => {
    const item = byId(await listItems(AANGAN, '?limit=50'), await idOf(3));
    expect(item.displayName).toBe('Priya Adhikari');
    expect(item.dedication).toBeNull();
    expect(item.message).toBeNull();
  });

  it('shows no dedication when the type is set but the name is missing', async () => {
    const stored = await dbRow(71);
    expect(stored.dedication_type).toBe('in_honor_of');
    expect(stored.dedication_name).toBeNull();
    const item = byId(await listItems(AANGAN, '?limit=50'), await idOf(71));
    expect(item.dedication).toBeNull();
    expect(item.message).toBe('Jay Nepal.');
  });

  it('keeps the dedication of a public gift', async () => {
    const item = byId(await listItems(AANGAN, '?limit=50'), await idOf(75));
    expect(item.displayName).toBe('Nisha Oli');
    expect(item.dedication).toEqual({ type: 'in_memory_of', name: 'Hajurama' });
    expect(item.message).toBe('For the community.');
  });
});

describe('GET /api/campaigns/:slug/donations (headers)', () => {
  it('sends Cache-Control: no-cache', async () => {
    const res = await getList(AANGAN);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});
