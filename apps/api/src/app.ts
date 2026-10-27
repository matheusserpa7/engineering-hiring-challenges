import express, { type Express } from 'express';
import type { Kysely } from 'kysely';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Database } from './db/database.js';
import { createCampaignRouter } from './http/campaigns.js';
import { createDonationRouter } from './http/donations.js';
import { createErrorHandler, notFound } from './http/errors.js';
import { createHealthHandler } from './http/health.js';
import type { Logger } from './logger.js';
import type { IntakeSettings } from './services/donations.js';

export interface AppDeps {
  logger: Logger;
  pingDb: () => Promise<void>;
  db: Kysely<Database>;
  // Tests pin the clock; campaign phases depend on it.
  now?: () => Date;
  // The payment provider and the settings the donation intake runs with.
  intake: IntakeSettings;
}

// Dependencies come in as arguments so tests can build the app with a failing database.
export function createApp({
  logger,
  pingDb,
  db,
  now = () => new Date(),
  intake,
}: AppDeps): Express {
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
  app.use('/api', createCampaignRouter({ db, now }));
  app.use('/api', createDonationRouter({ db, now, ...intake }));

  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
