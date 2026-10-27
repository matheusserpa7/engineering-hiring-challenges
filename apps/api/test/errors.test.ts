import { isApiErrorBody } from '@aangan/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createErrorHandler } from '../src/http/errors.js';
import { createLogger } from '../src/logger.js';
import { neverConnectingDb } from './never-connecting-db.js';
import { testIntake } from './intake.js';

const app = createApp({
  logger: createLogger('silent'),
  pingDb: () => Promise.resolve(),
  db: neverConnectingDb(),
  intake: testIntake,
});

describe('error responses', () => {
  it.each(['/api/nope', '/nope'])('answers 404 not_found for %s', async (path) => {
    const res = await request(app).get(path);

    expect(res.status).toBe(404);
    expect(isApiErrorBody(res.body)).toBe(true);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });

  it('answers 400 malformed_json for a body that is not valid JSON', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"amountCents":');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'malformed_json' } });
  });

  it('answers 413 payload_too_large for a body over 16 kB', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(17 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('answers a client error from body parsing with its 4xx status, not 500', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('answers 400 bad_request for a malformed percent-encoding without an error-level log', async () => {
    const lines: string[] = [];
    const logger = createLogger('error', { write: (line: string) => lines.push(line) });
    const logged = createApp({
      logger,
      pingDb: () => Promise.resolve(),
      db: neverConnectingDb(),
      intake: testIntake,
    });

    const res = await request(logged).get('/api/campaigns/%E0%A4%A');

    expect(res.status).toBe(400);
    expect(isApiErrorBody(res.body)).toBe(true);
    expect(res.body).toMatchObject({ error: { code: 'bad_request' } });
    expect(Object.keys((res.body as { error: object }).error).sort()).toEqual(['code', 'message']);
    expect(res.text).not.toContain('%E0');
    expect(res.text).not.toMatch(/node_modules|\.ts/);
    // A client typo is not a server fault, so it must not page anyone.
    expect(lines.join('')).toBe('');
  });

  const cause = new Error('password=hunter2 in /srv/app/db.ts');
  const handlers = {
    sync: () => {
      throw cause;
    },
    async: () => Promise.reject(cause),
  };

  it.each(Object.entries(handlers))(
    'answers 500 for a %s throw, logging but not leaking the cause',
    async (_kind, handler) => {
      const lines: string[] = [];
      const logger = createLogger('error', { write: (line: string) => lines.push(line) });
      const throwing = express();
      throwing.get('/boom', handler);
      throwing.use(createErrorHandler(logger));

      const res = await request(throwing).get('/boom');

      expect(res.status).toBe(500);
      expect(isApiErrorBody(res.body)).toBe(true);
      expect(res.body).toMatchObject({ error: { code: 'internal_error' } });
      expect(res.text).not.toContain('hunter2');
      expect(res.text).not.toContain('/srv/app');
      expect(res.text).not.toMatch(/\bat\s/);
      expect(lines.join('')).toContain('hunter2');
    },
  );
});
