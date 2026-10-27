import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { testIntake } from './intake.js';
import { neverConnectingDb } from './never-connecting-db.js';

const WEB = 'http://localhost:3000';
const OTHER_PORT = 'http://localhost:3001';

// Nothing here reaches the database: a POST without an Idempotency-Key is refused (400) before
// any query, so a 400 means "the origin check let it through" and a 403 means "it did not".
function build() {
  return createApp({
    logger: createLogger('silent'),
    pingDb: () => Promise.resolve(),
    db: neverConnectingDb(),
    intake: testIntake,
    security: { allowedOrigins: [WEB, 'http://127.0.0.1:3000'], loginRateLimit: 10 },
  });
}

describe('origin check', () => {
  it.each([
    ['another site', 'https://evil.example'],
    ['the same host on another port', OTHER_PORT],
    ['the literal null origin', 'null'],
    ['the right host over https', 'https://localhost:3000'],
    ['a host that only starts with a listed origin', 'http://localhost:3000.evil.example'],
    ['a listed origin with a trailing slash', 'http://localhost:3000/'],
    ['a listed origin in upper case', 'HTTP://LOCALHOST:3000'],
  ])('refuses a POST from %s with 403 origin_not_allowed', async (_label, origin) => {
    const res = await request(build()).post('/api/donations').set('Origin', origin).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { code: 'origin_not_allowed', message: expect.any(String) as string },
    });
  });

  it('refuses before the body is parsed, so a malformed body from a bad origin is a 403', async () => {
    const res = await request(build())
      .post('/api/donations')
      .set('Origin', 'https://evil.example')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(403);
  });

  it('lets a POST from a listed origin through', async () => {
    const res = await request(build()).post('/api/donations').set('Origin', WEB).send({});
    expect(res.status).toBe(400);
  });

  // curl and CI send no Origin and carry no victim's cookie (tech spec 005 F5).
  it('lets a POST with no Origin through', async () => {
    const res = await request(build()).post('/api/donations').send({});
    expect(res.status).toBe(400);
  });

  it('checks DELETE, PUT and PATCH as well', async () => {
    const app = build();
    const evil = 'https://evil.example';
    const statuses = [
      (await request(app).delete('/api/donations').set('Origin', evil)).status,
      (await request(app).put('/api/donations').set('Origin', evil)).status,
      (await request(app).patch('/api/donations').set('Origin', evil)).status,
    ];
    expect(statuses).toEqual([403, 403, 403]);
  });

  it('does not check a GET: reads change nothing', async () => {
    const res = await request(build()).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
  });
});

describe('CORS', () => {
  it('echoes a listed origin and allows credentials', async () => {
    const res = await request(build()).get('/api/health').set('Origin', WEB);
    expect(res.headers['access-control-allow-origin']).toBe(WEB);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers.vary).toContain('Origin');
  });

  it.each([
    ['an unlisted origin', 'https://evil.example'],
    ['the null origin', 'null'],
    ['the same host on another port', OTHER_PORT],
  ])('sends no CORS header to %s', async (_label, origin) => {
    const res = await request(build()).get('/api/health').set('Origin', origin);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never answers with a wildcard', async () => {
    const res = await request(build()).get('/api/health').set('Origin', WEB);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('answers a preflight from a listed origin and gives an unlisted one nothing', async () => {
    const listed = await request(build())
      .options('/api/auth/login')
      .set('Origin', WEB)
      .set('Access-Control-Request-Method', 'POST');
    expect(listed.status).toBe(204);
    expect(listed.headers['access-control-allow-origin']).toBe(WEB);

    const unlisted = await request(build())
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('security headers', () => {
  it('sends a CSP that allows nothing, since the API only returns JSON', async () => {
    const res = await request(build()).get('/api/health');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
  });

  it('keeps the other helmet headers', async () => {
    const res = await request(build()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('no security settings given', () => {
  it('refuses every browser origin instead of allowing all of them', async () => {
    const app = createApp({
      logger: createLogger('silent'),
      pingDb: () => Promise.resolve(),
      db: neverConnectingDb(),
      intake: testIntake,
    });
    const res = await request(app).post('/api/donations').set('Origin', WEB).send({});
    expect(res.status).toBe(403);
  });
});
