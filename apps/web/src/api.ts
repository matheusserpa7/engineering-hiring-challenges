import { isApiErrorBody, type ErrorCode } from '@aangan/shared';

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

// Relative URLs only: in dev Vite proxies /api, in Docker nginx does, so the bundle never
// needs to know where the API lives. A network failure rejects with fetch's own TypeError.
export async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const body = await readBody(response);

  if (response.ok && body.parsed) return body.value;
  if (body.parsed && isApiErrorBody(body.value)) {
    throw new ApiError(response.status, body.value.error.code, body.value.error.message);
  }
  // A proxy's HTML error page, or a 2xx that isn't JSON: say nothing specific about it.
  throw new ApiError(
    response.status,
    'unexpected_response',
    'Something went wrong. Please try again.',
  );
}
