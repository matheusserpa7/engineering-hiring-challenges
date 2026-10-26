import { loadConfig } from '../config.js';
import { createDb } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { createLogger } from '../logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(createPool(config.DATABASE_URL, logger));

try {
  await runMigrations(db);
  logger.info('migrations are up to date');
} catch (error) {
  logger.error({ err: error }, 'migration failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
