import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { createErrorHandler, notFound } from './http/errors.js';
import { createHealthHandler } from './http/health.js';
import type { Logger } from './logger.js';

export interface AppDeps {
  logger: Logger;
  pingDb: () => Promise<void>;
}

// Dependencies come in as arguments so tests can build the app with a failing database.
export function createApp({ logger, pingDb }: AppDeps): Express {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      // Docker polls the health check every few seconds; a failure is logged by the handler.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', createHealthHandler(pingDb, logger));

  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
