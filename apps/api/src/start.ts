import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool, pingDb } from './db/pool.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL, logger);
const app = createApp({ logger, pingDb: () => pingDb(pool) });

const server = app.listen(config.PORT, (error) => {
  if (error) {
    logger.fatal({ err: error }, 'API failed to start');
    process.exit(1);
  }
  logger.info({ port: config.PORT }, 'API listening');
});

// Node as PID 1 in a container has no default SIGTERM handler, so without this
// `docker compose down` would wait 10 s and then kill the process mid-request.
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // A request stuck on a dead database would hold close() open. Exit before Docker's
  // 10 s SIGKILL so the shutdown is still ours and still logged.
  setTimeout(() => {
    logger.warn('shutdown timed out, forcing exit');
    process.exit(1);
  }, 8000).unref();

  server.close(() => {
    pool.end().catch((error: unknown) => {
      logger.error({ err: error }, 'closing the database pool failed');
      process.exitCode = 1;
    });
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
