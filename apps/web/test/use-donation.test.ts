import type { DonationRequest } from '@aangan/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDonation } from '../src/composables/use-donation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function request(overrides: Partial<DonationRequest> = {}): DonationRequest {
  return {
    campaignSlug: 'aangan-courtyard',
    amountCents: 10_100,
    donor: { fullName: 'Priya Sharma', email: 'priya@example.com' },
    dedication: null,
    message: null,
    privacyMode: 'public',
    isRecurring: false,
    paymentToken: 'tok_ok',
    ...overrides,
  };
}

const RECEIPT = {
  id: '33333333-3333-4333-8333-333333333333',
  receiptNumber: 'HCC-2026-000076',
  amountCents: 10_100,
  currency: 'USD',
  status: 'completed',
  createdAt: '2026-10-27T12:00:00.000Z',
};

type Reply = Response | Error;

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function apiError(status: number, code: string, headers: Record<string, string> = {}): Response {
  return reply(status, { error: { code, message: 'm' } }, headers);
}

function stubFetch(...replies: Reply[]): ReturnType<typeof vi.fn> {
  const queue = [...replies];
  const stub = vi.fn(() => {
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected request');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

function keyOf(stub: ReturnType<typeof vi.fn>, call: number): string {
  const init = stub.mock.calls[call]?.[1] as { headers: Record<string, string> } | undefined;
  return init?.headers['Idempotency-Key'] ?? '';
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDonation', () => {
  it('sends a UUID v4 Idempotency-Key', async () => {
    const stub = stubFetch(reply(201, RECEIPT));
    const { submit } = useDonation();

    await submit(request());

    expect(keyOf(stub, 0)).toMatch(UUID);
  });

  it('reports a receipt for 201 and for 202', async () => {
    stubFetch(reply(201, RECEIPT), reply(202, { ...RECEIPT, status: 'pending' }));
    const { state, submit } = useDonation();

    await submit(request());
    expect(state.value).toMatchObject({
      status: 'finished',
      outcome: { kind: 'receipt', receipt: { status: 'completed' } },
    });

    await submit(request({ amountCents: 5100 }));
    expect(state.value).toMatchObject({
      outcome: { kind: 'receipt', receipt: { status: 'pending' } },
    });
  });

  it('reuses the key after a network failure and a 409', async () => {
    const stub = stubFetch(
      new TypeError('Failed to fetch'),
      apiError(409, 'request_in_progress', { 'Retry-After': '1' }),
      reply(201, RECEIPT),
    );
    const { state, submit } = useDonation();

    await submit(request());
    expect(state.value).toMatchObject({ outcome: { kind: 'network' } });
    await submit(request());
    expect(state.value).toMatchObject({ outcome: { kind: 'in_progress' } });
    await submit(request());

    expect(keyOf(stub, 1)).toBe(keyOf(stub, 0));
    expect(keyOf(stub, 2)).toBe(keyOf(stub, 0));
  });

  it('uses a new key after a decline, and after a success', async () => {
    const stub = stubFetch(
      apiError(402, 'card_declined'),
      reply(201, RECEIPT),
      reply(201, RECEIPT),
    );
    const { state, submit } = useDonation();

    await submit(request());
    expect(state.value).toMatchObject({ outcome: { kind: 'declined', code: 'card_declined' } });
    await submit(request());
    await submit(request());

    expect(keyOf(stub, 1)).not.toBe(keyOf(stub, 0));
    expect(keyOf(stub, 2)).not.toBe(keyOf(stub, 1));
  });

  it('uses a new key when any field changes after a network failure', async () => {
    const stub = stubFetch(new TypeError('Failed to fetch'), reply(201, RECEIPT));
    const { submit } = useDonation();

    await submit(request());
    await submit(request({ amountCents: 5100 }));

    expect(keyOf(stub, 1)).not.toBe(keyOf(stub, 0));
  });

  it('sends one request for a double click', async () => {
    const stub = stubFetch(reply(201, RECEIPT));
    const { submit } = useDonation();

    await Promise.all([submit(request()), submit(request())]);

    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('maps the other answers to outcomes', async () => {
    stubFetch(
      apiError(502, 'payment_provider_error'),
      apiError(429, 'rate_limited', { 'Retry-After': '90' }),
      apiError(422, 'validation_failed'),
      new Response('<html>bad gateway</html>', { status: 502 }),
    );
    const { state, submit } = useDonation();

    await submit(request());
    expect(state.value).toMatchObject({ outcome: { kind: 'provider_error' } });
    await submit(request());
    expect(state.value).toMatchObject({ outcome: { kind: 'rate_limited', retryAfter: 90 } });
    await submit(request());
    expect(state.value).toMatchObject({ outcome: { kind: 'rejected', code: 'validation_failed' } });
    await submit(request());
    expect(state.value).toMatchObject({ outcome: { kind: 'unexpected' } });
  });

  it('returns to idle on reset', async () => {
    stubFetch(reply(201, RECEIPT));
    const { state, submit, reset } = useDonation();
    await submit(request());

    reset();

    expect(state.value).toEqual({ status: 'idle' });
  });
});
