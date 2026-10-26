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
