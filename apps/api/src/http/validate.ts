import type { ZodType } from 'zod';
import { AppError } from './errors.js';

// Zod's own messages are never sent: one can quote the input, and the input is whatever the
// caller typed. Only the field and the issue code leave. An issue with no path (an unknown
// key on a strict object) is reported as the query as a whole, so the key name is not echoed.
export function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (result.success) return result.data;

  throw new AppError(
    422,
    'validation_failed',
    'The query is invalid.',
    result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(query)',
      issue: issue.code,
    })),
  );
}
