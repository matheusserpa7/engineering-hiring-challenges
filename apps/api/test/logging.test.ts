import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';

it('keeps cookies and credentials out of the request log', async () => {
  const lines: string[] = [];
  const logger = createLogger('info', { write: (line: string) => lines.push(line) });
  const app = createApp({ logger, pingDb: () => Promise.resolve() });

  await request(app)
    .get('/api/nope')
    .set('Cookie', 'sid=session-secret')
    .set('Authorization', 'Bearer token-secret');

  const log = lines.join('');
  expect(log).toContain('/api/nope');
  expect(log).toContain('[Redacted]');
  expect(log).not.toContain('session-secret');
  expect(log).not.toContain('token-secret');
});

// A Postgres error carries the failing row in `detail` and `where` (a name, an email, a
// message). pino copies every property of an error, so without a serializer one rejected
// insert would write a donor's data into the log.
it('keeps the failing row of a database error out of the log', () => {
  const lines: string[] = [];
  const logger = createLogger('info', { write: (line: string) => lines.push(line) });
  const databaseError = Object.assign(new Error('new row violates check constraint'), {
    code: '23514',
    constraint: 'donations_amount_cents_check',
    table: 'donations',
    detail: 'Failing row contains (Ana Souza, ana.souza@example.com, a private message)',
    where: 'SQL statement "INSERT ... ana.souza@example.com"',
  });

  logger.error({ err: databaseError }, 'insert failed');

  const log = lines.join('');
  expect(log).toContain('23514');
  expect(log).toContain('donations_amount_cents_check');
  expect(log).not.toContain('ana.souza@example.com');
  expect(log).not.toContain('a private message');
});
