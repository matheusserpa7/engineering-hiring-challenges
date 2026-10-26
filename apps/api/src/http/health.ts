import type { RequestHandler } from 'express';
import type { Logger } from '../logger.js';
import { errorBody } from './errors.js';

// Docker's healthcheck calls this, so a database outage marks the API unhealthy.
export function createHealthHandler(pingDb: () => Promise<void>, logger: Logger): RequestHandler {
  return async (req, res) => {
    try {
      await pingDb();
      res.json({ status: 'ok' });
    } catch (error) {
      logger.warn({ err: error, reqId: req.id }, 'health check failed: database unreachable');
      res.status(503).json(errorBody('unavailable', 'The service is temporarily unavailable.'));
    }
  };
}
