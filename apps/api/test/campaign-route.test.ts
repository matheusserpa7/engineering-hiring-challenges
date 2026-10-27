import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { neverConnectingDb } from './never-connecting-db.js';

// The database here refuses every connection, so what a request returns shows whether it
// reached a query. That makes the order "validate the slug, then query" observable without
// Docker: a slug that fails validation is answered 404 and never touches the pool, while a
// well-formed slug that reaches the query dies on the refused connection with a 500.
const app = createApp({
  logger: createLogger('silent'),
  pingDb: () => Promise.resolve(),
  db: neverConnectingDb(),
});

describe('GET /api/campaigns/:slug validates the slug before it queries', () => {
  it.each([
    ['upper case and an underscore', 'Aangan_Courtyard'],
    ['a NUL byte', 'a%00b'],
    ['a doubled hyphen', 'a--b'],
    ['65 characters', 'a'.repeat(65)],
  ])('answers 404 without a query for a slug with %s', async (_label, slug) => {
    const res = await request(app).get(`/api/campaigns/${slug}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });

  it('runs the query for a well-formed slug, so a down database is a 500', async () => {
    const res = await request(app).get('/api/campaigns/nope');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'internal_error' } });
  });
});
