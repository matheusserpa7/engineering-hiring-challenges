import { pino, type DestinationStream, type LevelWithSilent, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: LevelWithSilent, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      // Session cookies and credentials must never reach the logs.
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    destination,
  );
}
