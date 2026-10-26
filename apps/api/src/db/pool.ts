import pg from 'pg';
import type { Logger } from '../logger.js';

export function createPool(connectionString: string, logger: Logger): pg.Pool {
  // pg waits forever by default, both for a connection and for a query's answer. A database
  // that is down, or that stops answering on an open connection, must fail the request
  // instead of hanging it. A timed-out client is discarded, not reused.
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 2000,
    query_timeout: 5000,
  });
  // An idle client that loses its connection emits 'error' on the pool. With no listener,
  // Node treats that as an uncaught error and the whole process exits.
  pool.on('error', (error) => {
    logger.error({ err: error }, 'idle database client failed');
  });
  return pool;
}

export async function pingDb(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}
