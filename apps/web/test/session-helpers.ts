import type { SessionUser } from '@aangan/shared';
import { vi } from 'vitest';

export const donorUser: SessionUser = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'donor@himalayacc.example',
  fullName: 'Test Donor',
  role: 'donor',
};

export const adminUser: SessionUser = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'admin@himalayacc.example',
  fullName: 'HCC Admin',
  role: 'admin',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const apiError = (
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response => json({ error: { code, message } }, status, headers);

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

// Only the network is stubbed, keyed by "METHOD /path". An unlisted request fails the test
// loudly instead of returning something plausible.
export function stubApi(handlers: Record<string, Handler>): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      const handler = handlers[key];
      if (!handler) return Promise.reject(new Error(`unexpected request: ${key}`));
      return Promise.resolve(handler(init));
    }),
  );
  return calls;
}
