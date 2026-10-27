import { isApiErrorBody, type ErrorCode } from '@aangan/shared';
import type { z } from 'zod';

// The message is safe to show: it is either the API's own client-facing message or our
// generic one, never a raw response body.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'unexpected_response',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Body = { parsed: true; value: unknown } | { parsed: false };

// An empty body (a 204) is valid. Anything else must be JSON: a 200 HTML page means the
// request never reached the API, for example nginx serving index.html for a bad route.
async function readBody(response: Response): Promise<Body> {
  const text = await response.text();
  if (text === '') return { parsed: true, value: undefined };
  try {
    const value: unknown = JSON.parse(text);
    return { parsed: true, value };
  } catch {
    return { parsed: false };
  }
}

const UNEXPECTED_MESSAGE = 'Something went wrong. Please try again.';

// Relative URLs only: in dev Vite proxies /api, in Docker nginx does, so the bundle never
// needs to know where the API lives. A network failure rejects with fetch's own TypeError, and
// an aborted request with an AbortError: callers decide what those mean.
// A 2xx that fails the schema is contract drift, so it reads as unexpected_response and the
// page shows its error state instead of rendering undefined.
export async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });
  const body = await readBody(response);

  if (response.ok && body.parsed) {
    const result = schema.safeParse(body.value);
    if (result.success) return result.data;
  } else if (body.parsed && isApiErrorBody(body.value)) {
    throw new ApiError(response.status, body.value.error.code, body.value.error.message);
  }
  // A proxy's HTML error page, or a 2xx that isn't the shape we expect: say nothing specific.
  throw new ApiError(response.status, 'unexpected_response', UNEXPECTED_MESSAGE);
}
