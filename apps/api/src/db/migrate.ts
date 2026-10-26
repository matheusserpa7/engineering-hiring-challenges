import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Database } from './database.js';
import * as initial from './migrations/0001_initial.js';

// A static list rather than FileMigrationProvider: the same imports resolve under tsx,
// Vitest and the compiled dist/, with no folder scan or .ts/.js extension guessing.
const migrations = { '0001_initial': initial };

// Kysely takes a Postgres advisory lock while migrating, so two API instances starting at
// once cannot both run it. Running it again when nothing is pending does nothing.
export async function runMigrations(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
  const { error } = await migrator.migrateToLatest();
  if (error) {
    throw error instanceof Error ? error : new Error('migration failed', { cause: error });
  }
}
