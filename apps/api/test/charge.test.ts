import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeWithPolicy, type PaymentProvider } from '../src/payments/charge.js';
import { PaymentError } from '../src/payments/mock-provider.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const request = { token: 'tok_ok', amountCents: 10100, idempotencyKey: 'donation-1' };
const receipt = { chargeId: 'ch_1', amountCents: 10100, last4: '4242', createdAt: 'x' };

// A provider whose calls are scripted: each step waits `afterMs`, then resolves or throws.
type Step = { afterMs: number; throws?: Error };
function scripted(steps: Step[]) {
  const calls: { idempotencyKey?: string | undefined }[] = [];
  const provider: PaymentProvider = {
    charge: (req) => {
      calls.push({ idempotencyKey: req.idempotencyKey });
      const step = steps[calls.length - 1] ?? { afterMs: 0 };
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (step.throws !== undefined) reject(step.throws);
          else resolve(receipt);
        }, step.afterMs);
      });
    },
  };
  return { provider, calls };
}

const providerError = () => new PaymentError('provider_error', 'try again');

describe('chargeWithPolicy', () => {
  it('returns the charge id and last4 on success', async () => {
    const { provider, calls } = scripted([{ afterMs: 10 }]);
    const pending = chargeWithPolicy(provider, request, 5000);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({ kind: 'charged', chargeId: 'ch_1', last4: '4242' });
    expect(calls).toHaveLength(1);
  });

  it.each(['card_declined', 'insufficient_funds'])(
    'reports %s as a decline, without retry',
    async (code) => {
      const { provider, calls } = scripted([{ afterMs: 5, throws: new PaymentError(code, 'no') }]);
      const pending = chargeWithPolicy(provider, request, 5000);
      await vi.advanceTimersByTimeAsync(5);
      expect(await pending).toEqual({ kind: 'declined', code });
      expect(calls).toHaveLength(1);
    },
  );

  it('retries a provider_error once with the same idempotency key', async () => {
    const { provider, calls } = scripted([{ afterMs: 5, throws: providerError() }, { afterMs: 5 }]);
    const pending = chargeWithPolicy(provider, request, 5000);
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).kind).toBe('charged');
    expect(calls).toEqual([{ idempotencyKey: 'donation-1' }, { idempotencyKey: 'donation-1' }]);
  });

  it('gives up after a second provider_error', async () => {
    const { provider, calls } = scripted([
      { afterMs: 5, throws: providerError() },
      { afterMs: 5, throws: providerError() },
      { afterMs: 5 },
    ]);
    const pending = chargeWithPolicy(provider, request, 5000);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toEqual({ kind: 'provider_error' });
    expect(calls).toHaveLength(2);
  });

  it('answers unknown when the deadline passes', async () => {
    const { provider } = scripted([{ afterMs: 60_000 }]);
    const pending = chargeWithPolicy(provider, request, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ kind: 'unknown' });
  });

  it('shares one deadline between the attempt and its retry', async () => {
    // 600 ms to fail, then 600 ms for the retry: the retry would finish at 1200 ms.
    const { provider, calls } = scripted([
      { afterMs: 600, throws: providerError() },
      { afterMs: 600 },
    ]);
    const pending = chargeWithPolicy(provider, request, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ kind: 'unknown' });
    expect(calls).toHaveLength(2);
  });

  it('does not start a retry after the deadline has passed', async () => {
    // The first attempt fails at 1500 ms, after the 1000 ms deadline: no second call may follow.
    const { provider, calls } = scripted([
      { afterMs: 1500, throws: providerError() },
      { afterMs: 5 },
    ]);
    const pending = chargeWithPolicy(provider, request, 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ kind: 'unknown' });
    expect(calls).toHaveLength(1);
  });

  it('treats a non-PaymentError throw as unknown, never as a decline', async () => {
    const { provider, calls } = scripted([{ afterMs: 5, throws: new TypeError('boom') }]);
    const pending = chargeWithPolicy(provider, request, 5000);
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toEqual({ kind: 'unknown' });
    expect(calls).toHaveLength(1);
  });

  it('clears its timer when the charge finishes first', async () => {
    const { provider } = scripted([{ afterMs: 5 }]);
    const pending = chargeWithPolicy(provider, request, 5000);
    await vi.advanceTimersByTimeAsync(5);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
