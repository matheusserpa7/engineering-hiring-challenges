import type { ZodType } from 'zod';
import { AppError } from './errors.js';

// Zod's own messages are never sent: one can quote the input, and the input is whatever the
// caller typed. Only the field and the issue code leave. An issue with no path (an unknown
// key on a strict object) is reported as the input as a whole, so the key name is not echoed.
export function parseInput<T>(schema: ZodType<T>, value: unknown, source: 'query' | 'body'): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw new AppError(
    422,
    'validation_failed',
    `The ${source} is invalid.`,
    result.error.issues.map((issue) => ({
      field: issue.path.join('.') || `(${source})`,
      issue: issue.code,
    })),
  );
}
