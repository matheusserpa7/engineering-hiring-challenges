import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { testIntake } from './intake.js';
import { neverConnectingDb } from './never-connecting-db.js';

const LIMIT = 3;

// Every request below is refused for its missing Idempotency-Key before the database is
// touched, so the limiter is the only thing under test and no Postgres is needed.
function build() {
  return createApp({
    logger: createLogger('silent'),
    pingDb: () => Promise.resolve(),
    db: neverConnectingDb(),
    intake: { ...testIntake, donationRateLimit: LIMIT },
  });
}

const attempt = (app: ReturnType<typeof build>, forwardedFor?: string) => {
  const req = request(app).post('/api/donations');
  if (forwardedFor) void req.set('X-Forwarded-For', forwardedFor);
  return req.send({});
};

async function exhaust(app: ReturnType<typeof build>, forwardedFor?: string) {
  for (let i = 0; i < LIMIT; i++) {
    expect((await attempt(app, forwardedFor)).status).toBe(400);
  }
}

describe('donation rate limit', () => {
  it('answers 429 rate_limited with Retry-After and our error envelope past the limit', async () => {
    const app = build();
    await exhaust(app);
    const res = await attempt(app);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: { code: 'rate_limited' } });
    // The library sets this from the 10-minute window.
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(600);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts a malformed body too, because the limiter runs before the body parser', async () => {
    const app = build();
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app)
        .post('/api/donations')
        .set('Content-Type', 'application/json')
        .send('{not json');
      expect(res.status).toBe(400);
    }
    const res = await request(app)
      .post('/api/donations')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(429);
  });

  it('shares one bucket between callers that differ only in a forged left-most entry', async () => {
    const app = build();
    await exhaust(app, '1.1.1.1, 9.9.9.9');
    // nginx appended 9.9.9.9 to both; the client-chosen first entry must not matter.
    expect((await attempt(app, '2.2.2.2, 9.9.9.9')).status).toBe(429);
  });

  it('keeps callers behind different proxy-appended addresses in separate buckets', async () => {
    const app = build();
    await exhaust(app, '1.1.1.1, 9.9.9.9');
    expect((await attempt(app, '1.1.1.1, 8.8.8.8')).status).toBe(400);
  });

  it('trusts a lone X-Forwarded-For entry, the case of a client calling the API directly', async () => {
    const app = build();
    await exhaust(app, '1.1.1.1');
    expect((await attempt(app, '1.1.1.1')).status).toBe(429);
    expect((await attempt(app, '3.3.3.3')).status).toBe(400);
  });

  it('does not limit other routes', async () => {
    const app = build();
    await exhaust(app);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
