import {
  pino,
  stdSerializers,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
} from 'pino';

export type { Logger };

// A Postgres error carries the failing row in `detail` and `where` (a name, an email, a message)
// and in `internalQuery`. pino copies every property of an error into the line, so a rejected
// insert would write a donor's data into the log. The code, constraint and table stay: they
// say what failed without saying for whom.
const ROW_DATA_KEYS = new Set(['detail', 'where', 'internalQuery']);

function serializeError(error: Error): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(stdSerializers.err(error)).filter(([key]) => !ROW_DATA_KEYS.has(key)),
  );
}

export function createLogger(level: LevelWithSilent, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      serializers: { err: serializeError },
      // Session cookies and credentials must never reach the logs.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    destination,
  );
}
