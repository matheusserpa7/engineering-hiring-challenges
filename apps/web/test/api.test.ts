import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getJson } from '../src/api';

function respondWith(status: number, body: string, contentType = 'application/json'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(new Response(body, { status, headers: { 'Content-Type': contentType } })),
    ),
  );
}

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected getJson to reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getJson', () => {
  it('returns the parsed body on 2xx, sending same-origin credentials', async () => {
    respondWith(200, '{"status":"ok"}');

    await expect(getJson('/api/health')).resolves.toEqual({ status: 'ok' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('returns undefined for a 2xx with no body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    await expect(getJson('/api/session')).resolves.toBeUndefined();
  });

  it('throws unexpected_response for a 2xx whose body is not JSON', async () => {
    respondWith(200, '<!doctype html><div id="app"></div>', 'text/html');

    const error = await errorOf(getJson('/api/health'));

    expect(error.status).toBe(200);
    expect(error.code).toBe('unexpected_response');
  });

  it('throws ApiError with the envelope code and message on an API error', async () => {
    respondWith(503, '{"error":{"code":"unavailable","message":"Try again soon."}}');

    const error = await errorOf(getJson('/api/health'));

    expect(error.status).toBe(503);
    expect(error.code).toBe('unavailable');
    expect(error.message).toBe('Try again soon.');
  });

  it('throws a generic unexpected_response for a body that is not our envelope', async () => {
    respondWith(502, '<html><body>nginx: Bad Gateway upstream 10.0.0.7</body></html>', 'text/html');

    const error = await errorOf(getJson('/api/health'));

    expect(error.status).toBe(502);
    expect(error.code).toBe('unexpected_response');
    expect(error.message).not.toContain('nginx');
  });
});
