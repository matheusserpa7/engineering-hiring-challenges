import { randomUUID } from 'node:crypto';
import type { PaymentProvider } from './charge.js';

// A port of roles/full-stack-engineer/reference/mock-payment-provider.js. The outcomes are the
// brief's fixture and must stay as they are. The one difference: the reference keeps its flaky
// and duplicate state at module level and needs a test-only reset, while here each provider
// instance owns it.

const OUTCOMES = {
  tok_ok: { kind: 'success' },
  tok_decline: { kind: 'decline', code: 'card_declined' },
  tok_insufficient: { kind: 'decline', code: 'insufficient_funds' },
  tok_timeout: { kind: 'timeout' },
  tok_flaky: { kind: 'flaky' },
  tok_dup: { kind: 'duplicate' },
} as const;

type OutcomeToken = keyof typeof OUTCOMES;

const isKnownToken = (token: string): token is OutcomeToken => Object.hasOwn(OUTCOMES, token);

export class PaymentError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

const randomChargeId = (): string => `ch_${randomUUID().replaceAll('-', '').slice(0, 20)}`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createMockProvider({
  latencyMs = 250,
}: { latencyMs?: number } = {}): PaymentProvider {
  const duplicateChargeIds = new Map<string, string>();
  const flakyAttempts = new Set<string>();

  const receipt = (chargeId: string, amountCents: number) => ({
    chargeId,
    amountCents,
    last4: '4242',
    createdAt: new Date().toISOString(),
  });

  return {
    async charge({ token, amountCents, idempotencyKey }) {
      // A float reaching a payment provider shows up on a bank statement weeks later.
      if (!Number.isInteger(amountCents)) {
        throw new PaymentError('invalid_amount', 'amountCents must be an integer number of cents');
      }
      if (amountCents <= 0) {
        throw new PaymentError('invalid_amount', 'amountCents must be positive');
      }
      if (!isKnownToken(token)) {
        throw new PaymentError('invalid_token', 'Unknown payment token');
      }

      await sleep(latencyMs);

      const outcome = OUTCOMES[token];
      const key = idempotencyKey ?? 'default';
      switch (outcome.kind) {
        case 'success':
          return receipt(randomChargeId(), amountCents);
        case 'decline':
          throw new PaymentError(outcome.code, 'The card was declined');
        case 'timeout':
          // The provider accepted the request and never answers: the caller's deadline is the
          // only thing that ends this call.
          return new Promise<never>(() => undefined);
        case 'flaky':
          if (!flakyAttempts.has(key)) {
            flakyAttempts.add(key);
            throw new PaymentError('provider_error', 'Temporary provider failure, safe to retry');
          }
          return receipt(randomChargeId(), amountCents);
        case 'duplicate': {
          // The same key always yields the same charge id, as a real provider's idempotency does.
          const chargeId = duplicateChargeIds.get(key) ?? randomChargeId();
          duplicateChargeIds.set(key, chargeId);
          return receipt(chargeId, amountCents);
        }
      }
    },
  };
}
