import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, getJson, postJson } from '../src/api';

const Health = z.strictObject({ status: z.literal('ok') });

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
  it('returns the body parsed by the schema, sending same-origin credentials', async () => {
    respondWith(200, '{"status":"ok"}');

    await expect(getJson('/api/health', Health)).resolves.toEqual({ status: 'ok' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('passes the abort signal to fetch', async () => {
    respondWith(200, '{"status":"ok"}');
    const { signal } = new AbortController();

    await getJson('/api/health', Health, { signal });

    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ signal }));
  });

  it('throws unexpected_response for a 2xx that fails the schema', async () => {
    respondWith(200, '{"status":"degraded"}');

    const error = await errorOf(getJson('/api/health', Health));

    expect(error.status).toBe(200);
    expect(error.code).toBe('unexpected_response');
  });

  it('throws unexpected_response for a 2xx with no body when the schema wants one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );

    const error = await errorOf(getJson('/api/session', Health));

    expect(error.code).toBe('unexpected_response');
  });

  it('throws unexpected_response for a 2xx whose body is not JSON', async () => {
    respondWith(200, '<!doctype html><div id="app"></div>', 'text/html');

    const error = await errorOf(getJson('/api/health', Health));

    expect(error.status).toBe(200);
    expect(error.code).toBe('unexpected_response');
  });

  it('throws ApiError with the envelope code and message on an API error', async () => {
    respondWith(503, '{"error":{"code":"unavailable","message":"Try again soon."}}');

    const error = await errorOf(getJson('/api/health', Health));

    expect(error.status).toBe(503);
    expect(error.code).toBe('unavailable');
    expect(error.message).toBe('Try again soon.');
  });

  it('keeps the code of a 422 envelope', async () => {
    respondWith(
      422,
      '{"error":{"code":"validation_failed","message":"Check the highlighted fields."}}',
    );

    const error = await errorOf(getJson('/api/health', Health));

    expect(error.status).toBe(422);
    expect(error.code).toBe('validation_failed');
  });

  it('throws a generic unexpected_response for a body that is not our envelope', async () => {
    respondWith(502, '<html><body>nginx: Bad Gateway upstream 10.0.0.7</body></html>', 'text/html');

    const error = await errorOf(getJson('/api/health', Health));

    expect(error.status).toBe(502);
    expect(error.code).toBe('unexpected_response');
    expect(error.message).not.toContain('nginx');
  });
});

describe('postJson', () => {
  const Receipt = z.strictObject({ id: z.string() });

  function respond(status: number, body: string, headers: Record<string, string> = {}): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(body, {
            status,
            headers: { 'Content-Type': 'application/json', ...headers },
          }),
        ),
      ),
    );
  }

  it('sends the JSON body with the Idempotency-Key header', async () => {
    respond(201, '{"id":"a"}');

    await expect(
      postJson('/api/donations', { amountCents: 100 }, Receipt, { idempotencyKey: 'key-1' }),
    ).resolves.toEqual({ id: 'a' });

    expect(fetch).toHaveBeenCalledWith(
      '/api/donations',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: '{"amountCents":100}',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': 'key-1',
        }) as unknown,
      }),
    );
  });

  it('sends no Idempotency-Key header and no body when the caller gives neither', async () => {
    respond(201, '{"id":"a"}');

    await postJson('/api/auth/logout', undefined, Receipt);

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
    expect(Object.keys(init?.headers ?? {})).not.toContain('Idempotency-Key');
  });

  it('accepts a 202 as a success', async () => {
    respond(202, '{"id":"a"}');

    await expect(postJson('/api/donations', {}, Receipt, { idempotencyKey: 'k' })).resolves.toEqual(
      { id: 'a' },
    );
  });

  it('keeps the status, details and Retry-After of an error', async () => {
    respond(
      429,
      '{"error":{"code":"rate_limited","message":"Slow down.","details":[{"field":"x"}]}}',
      { 'Retry-After': '42' },
    );

    const error = await errorOf(postJson('/api/donations', {}, Receipt, { idempotencyKey: 'k' }));

    expect(error.status).toBe(429);
    expect(error.code).toBe('rate_limited');
    expect(error.details).toEqual([{ field: 'x' }]);
    expect(error.retryAfter).toBe(42);
  });

  it('reads a junk Retry-After as null', async () => {
    respond(409, '{"error":{"code":"request_in_progress","message":"Busy."}}', {
      'Retry-After': 'soon',
    });

    const error = await errorOf(postJson('/api/donations', {}, Receipt, { idempotencyKey: 'k' }));

    expect(error.retryAfter).toBeNull();
  });

  it('throws unexpected_response for a 2xx that fails the schema', async () => {
    respond(201, '{"id":1}');

    const error = await errorOf(postJson('/api/donations', {}, Receipt, { idempotencyKey: 'k' }));

    expect(error.code).toBe('unexpected_response');
  });
});
