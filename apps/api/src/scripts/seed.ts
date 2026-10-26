import { loadConfig } from '../config.js';
import { createDb } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { loadSeed, runSeed } from '../db/seed/seed.js';
import { createLogger } from '../logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(createPool(config.DATABASE_URL, logger));

try {
  // Migrating first, so `db:seed` also works on a database nobody has migrated yet.
  await runMigrations(db);
  await runSeed(db, loadSeed(config.SEED_DIR));
  logger.info('seed is up to date');
} catch (error) {
  logger.error({ err: error }, 'seed failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
