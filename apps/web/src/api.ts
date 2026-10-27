import { isApiErrorBody, type ErrorCode } from '@aangan/shared';
import type { z } from 'zod';

// The message is safe to show: it is either the API's own client-facing message or our
// generic one, never a raw response body.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'unexpected_response',
    message: string,
    readonly details?: unknown,
    // Seconds, from the Retry-After header; null when absent or not a plain number.
    readonly retryAfter: number | null = null,
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

function parseRetryAfter(value: string | null): number | null {
  return value !== null && /^\d{1,6}$/.test(value) ? Number(value) : null;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit,
  options: { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    signal: options.signal,
  });
  const body = await readBody(response);

  if (response.ok && body.parsed) {
    const result = schema.safeParse(body.value);
    if (result.success) return result.data;
  } else if (body.parsed && isApiErrorBody(body.value)) {
    const { code, message, details } = body.value.error;
    throw new ApiError(
      response.status,
      code,
      message,
      details,
      parseRetryAfter(response.headers.get('Retry-After')),
    );
  }
  // A proxy's HTML error page, or a 2xx that isn't the shape we expect: say nothing specific.
  throw new ApiError(response.status, 'unexpected_response', UNEXPECTED_MESSAGE);
}

// Relative URLs only: in dev Vite proxies /api, in Docker nginx does, so the bundle never
// needs to know where the API lives. A network failure rejects with fetch's own TypeError, and
// an aborted request with an AbortError: callers decide what those mean.
// A 2xx that fails the schema is contract drift, so it reads as unexpected_response and the
// page shows its error state instead of rendering undefined.
export function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  return request(path, schema, { headers: { Accept: 'application/json' } }, options);
}

// Any 2xx is a success, so a 202 (accepted, outcome pending) reads like a 201: the schema
// carries the status the caller acts on. The key is required because every POST here moves money.
export function postJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  options: { idempotencyKey: string; signal?: AbortSignal },
): Promise<T> {
  return request(
    path,
    schema,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey,
      },
      body: JSON.stringify(body),
    },
    options,
  );
}
