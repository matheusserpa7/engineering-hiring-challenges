import pg from 'pg';
import { createDb } from '../src/db/database.js';

// A Kysely instance over a pool that never opens a connection: pg.Pool connects lazily, so a
// test that builds the app but never reaches a campaign query needs no database. If a query
// does run it fails: port 9 is usually refused at once, and the connection timeout covers a
// host that silently drops the packets instead.
export function neverConnectingDb() {
  return createDb(
    new pg.Pool({
      connectionString: 'postgres://nobody@127.0.0.1:9/none',
      connectionTimeoutMillis: 500,
    }),
  );
}
