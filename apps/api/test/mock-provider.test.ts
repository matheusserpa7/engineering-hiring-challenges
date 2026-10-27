import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockProvider, PaymentError } from '../src/payments/mock-provider.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const request = { token: 'tok_ok', amountCents: 10100, idempotencyKey: 'k1' };

// Runs the call to the end of its simulated latency and returns how it settled.
async function settle(promise: Promise<unknown>) {
  const outcome = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  return outcome;
}

describe('createMockProvider', () => {
  it('charges tok_ok with the amount it was given', async () => {
    const result = await settle(createMockProvider().charge(request));
    expect(result).toMatchObject({ ok: true, value: { amountCents: 10100, last4: '4242' } });
    expect(result.ok && (result.value as { chargeId: string }).chargeId).toMatch(
      /^ch_[0-9a-f]{20}$/,
    );
  });

  it.each([
    ['tok_decline', 'card_declined'],
    ['tok_insufficient', 'insufficient_funds'],
  ])('declines %s with %s', async (token, code) => {
    const result = await settle(createMockProvider().charge({ ...request, token }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(PaymentError);
    expect(!result.ok && (result.error as PaymentError).code).toBe(code);
  });

  it('never settles for tok_timeout', async () => {
    let settled = false;
    void createMockProvider()
      .charge({ ...request, token: 'tok_timeout' })
      .then(
        () => (settled = true),
        () => (settled = true),
      );
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(settled).toBe(false);
  });

  it('rejects a float amount, a zero amount and an unknown token before any latency', async () => {
    const provider = createMockProvider();
    await expect(provider.charge({ ...request, amountCents: 101.5 })).rejects.toMatchObject({
      code: 'invalid_amount',
    });
    await expect(provider.charge({ ...request, amountCents: 0 })).rejects.toMatchObject({
      code: 'invalid_amount',
    });
    await expect(provider.charge({ ...request, token: 'tok_nope' })).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });

  it('fails tok_flaky once per key, then succeeds with the same key', async () => {
    const provider = createMockProvider();
    const flaky = { ...request, token: 'tok_flaky' };
    const first = await settle(provider.charge(flaky));
    expect(!first.ok && (first.error as PaymentError).code).toBe('provider_error');
    expect((await settle(provider.charge(flaky))).ok).toBe(true);
    // A different key has its own first failure.
    const other = await settle(provider.charge({ ...flaky, idempotencyKey: 'k2' }));
    expect(other.ok).toBe(false);
  });

  it('returns one charge id per key for tok_dup', async () => {
    const provider = createMockProvider();
    const dup = { ...request, token: 'tok_dup' };
    const a = await settle(provider.charge(dup));
    const b = await settle(provider.charge(dup));
    const c = await settle(provider.charge({ ...dup, idempotencyKey: 'k2' }));
    const id = (r: typeof a) => (r.ok ? (r.value as { chargeId: string }).chargeId : null);
    expect(id(a)).toBe(id(b));
    expect(id(c)).not.toBe(id(a));
  });

  it('shares no state between instances', async () => {
    const flaky = { ...request, token: 'tok_flaky' };
    expect((await settle(createMockProvider().charge(flaky))).ok).toBe(false);
    expect((await settle(createMockProvider().charge(flaky))).ok).toBe(false);
  });

  it('waits the configured latency before answering', async () => {
    let done = false;
    void createMockProvider({ latencyMs: 300 })
      .charge(request)
      .then(() => (done = true));
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
