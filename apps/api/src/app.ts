import express, { type Express } from 'express';
import type { Kysely } from 'kysely';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp, stdSerializers } from 'pino-http';
import type { Database } from './db/database.js';
import { createAuthRouter } from './http/auth.js';
import { createCampaignRouter } from './http/campaigns.js';
import { createDonationRouter } from './http/donations.js';
import { createErrorHandler, errorBody, notFound } from './http/errors.js';
import { createHealthHandler } from './http/health.js';
import {
  closedSecurity,
  corsFor,
  loginLimiter,
  originCheck,
  securityHeaders,
  type SecuritySettings,
} from './http/security.js';
import type { Logger } from './logger.js';
import type { AuthSettings } from './services/auth.js';
import type { IntakeSettings } from './services/donations.js';

const closedAuth: AuthSettings = {
  dummyHash: '',
  sessionTtlHours: 8,
  cookieSecure: true,
  verifyPassword: () => Promise.resolve(false),
};

export interface AppDeps {
  logger: Logger;
  pingDb: () => Promise<void>;
  db: Kysely<Database>;
  // Tests pin the clock; campaign phases depend on it.
  now?: () => Date;
  // The payment provider and the settings the donation intake runs with.
  intake: IntakeSettings;
  // Origins and limits for the browser-facing routes. Omitted means closed: no origin allowed.
  security?: SecuritySettings;
  // Omitted means no login can succeed: the dummy hash is not a hash, so nothing verifies.
  auth?: AuthSettings;
}

// Dependencies come in as arguments so tests can build the app with a failing database.
export function createApp({
  logger,
  pingDb,
  db,
  now = () => new Date(),
  intake,
  security = closedSecurity,
  auth = closedAuth,
}: AppDeps): Express {
  const app = express();

  // nginx is the one proxy in front of the API. Trusting exactly one hop makes req.ip the
  // address nginx appended, so a client-forged left-most X-Forwarded-For entry is ignored.
  // `true` would trust the whole header and let any client pick its own bucket.
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      // Docker polls the health check every few seconds; a failure is logged by the handler.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      serializers: {
        // A query string can carry an email (the admin `?q=` search), in the URL or in the
        // Referer a browser sends from that page: log paths only. pino-http hands this
        // function the already-serialized request, so it is re-serialized to reach both.
        req: (req: Parameters<typeof stdSerializers.req>[0]) => {
          const logged = stdSerializers.req(req);
          const referer = logged.headers.referer;
          return {
            ...logged,
            query: undefined,
            url: logged.url.split('?')[0],
            headers:
              typeof referer === 'string'
                ? { ...logged.headers, referer: referer.split('?')[0] }
                : logged.headers,
          };
        },
      },
    }),
  );
  app.use(securityHeaders);
  app.use(corsFor(security.allowedOrigins));
  // Before the limiters and the parser, so a forbidden origin costs nothing.
  app.use(originCheck(security.allowedOrigins));
  // Ahead of the body parser, so a flood of malformed or oversized bodies is counted too.
  // In memory and per instance: it resets on restart, which one instance can live with.
  app.post(
    '/api/donations',
    rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: intake.donationRateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // The library has already set Retry-After from the window.
      handler: (_req, res) => {
        res
          .status(429)
          .json(errorBody('rate_limited', 'Too many donation attempts. Please try again later.'));
      },
    }),
  );
  app.post('/api/auth/login', loginLimiter(security.loginRateLimit));
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', createHealthHandler(pingDb, logger));
  app.use('/api', createCampaignRouter({ db, now }));
  app.use('/api', createDonationRouter({ db, now, ...intake }));
  app.use('/api', createAuthRouter({ db, auth }));

  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
