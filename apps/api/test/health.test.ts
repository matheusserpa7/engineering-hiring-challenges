import { isApiErrorBody } from '@aangan/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { neverConnectingDb } from './never-connecting-db.js';

const logger = createLogger('silent');

describe('GET /api/health', () => {
  it('answers 200 ok when the database answers', async () => {
    const app = createApp({ logger, pingDb: () => Promise.resolve(), db: neverConnectingDb() });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('answers 503 unavailable, without the driver error, when the database does not', async () => {
    const pingDb = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const app = createApp({ logger, pingDb, db: neverConnectingDb() });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(isApiErrorBody(res.body)).toBe(true);
    expect(res.body).toMatchObject({ error: { code: 'unavailable' } });
    expect(res.text).not.toContain('ECONNREFUSED');
  });
});
