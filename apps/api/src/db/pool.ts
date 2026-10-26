import pg from 'pg';
import type { Logger } from '../logger.js';

// pg returns int8 as a string, because it can exceed 2^53. Money columns are int8 and a
// donation tops out at 2,500,000 cents, so the exact number is the useful form. A value
// past the safe range throws instead of rounding silently. numeric stays a string on
// purpose: an uncast SUM() then fails a type check instead of quietly becoming a float.
function parseSafeInt8(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError('int8 value is outside the safe integer range');
  }
  return parsed;
}

// campaigns.preset_cents is bigint[], and pg-types would return its elements as strings
// while the Database type says number[]. A NULL element or a nested array fails the safe
// integer check, so it throws instead of passing through. Neither occurs in the schema.
function parseSafeInt8Array(value: string): number[] {
  const body = value.slice(1, -1);
  return body === '' ? [] : body.split(',').map((item) => parseSafeInt8(item));
}

// Set on the pool rather than with pg.types.setTypeParser, which is global to the process.
const { INT8 } = pg.types.builtins;
// The OID of int8[] (_int8), which pg's builtins list does not include.
const INT8_ARRAY = 1016;
const types: pg.CustomTypesConfig = {
  getTypeParser: (oid, format) => {
    if (oid === INT8) return parseSafeInt8;
    // TypeId has no member for int8[], so compare as a plain number.
    const id: number = oid;
    if (id === INT8_ARRAY) return parseSafeInt8Array;
    // pg's own typing returns `any`; naming it unknown keeps that out of this file.
    const parser: unknown = pg.types.getTypeParser(oid, format);
    return parser;
  },
};

export function createPool(connectionString: string, logger: Logger): pg.Pool {
  // pg waits forever by default, both for a connection and for a query's answer. A database
  // that is down, or that stops answering on an open connection, must fail the request
  // instead of hanging it. A timed-out client is discarded, not reused.
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 2000,
    query_timeout: 5000,
    types,
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
