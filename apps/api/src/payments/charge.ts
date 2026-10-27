import { PaymentError } from './mock-provider.js';

export interface ChargeRequest {
  token: string;
  amountCents: number;
  idempotencyKey?: string | undefined;
}

export interface ChargeReceipt {
  chargeId: string;
  amountCents: number;
  last4: string;
  createdAt: string;
}

// The port the intake service depends on. The mock is the only implementation; a real
// provider would sit behind the same shape.
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeReceipt>;
}

// `unknown` is a different answer from `declined`: we asked and never learned the result, so
// the money may have moved. The caller must keep the donation pending, never mark it failed.
export type ChargeOutcome =
  | { kind: 'charged'; chargeId: string; last4: string }
  | { kind: 'declined'; code: string }
  | { kind: 'provider_error' }
  | { kind: 'unknown' };

const UNKNOWN: ChargeOutcome = { kind: 'unknown' };

// One deadline covers the attempt and its retry, so the donor waits at most timeoutMs.
// A provider_error is the provider saying "safe to retry", and the retry carries the same
// idempotency key, which is what makes it safe. Any other PaymentError is a definite no.
export async function chargeWithPolicy(
  provider: PaymentProvider,
  request: ChargeRequest,
  timeoutMs: number,
): Promise<ChargeOutcome> {
  let expired = false;
  let timer: NodeJS.Timeout | undefined;

  const attempts = async (): Promise<ChargeOutcome> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const { chargeId, last4 } = await provider.charge(request);
        return { kind: 'charged', chargeId, last4 };
      } catch (error) {
        // Anything that is not the provider's own answer (a bug, a dropped connection) says
        // nothing about whether the charge happened.
        if (!(error instanceof PaymentError)) return UNKNOWN;
        if (error.code !== 'provider_error') return { kind: 'declined', code: error.code };
        if (attempt === 2) return { kind: 'provider_error' };
        // The race below already answered 202; a retry now would charge after the donor was told
        // the outcome is unknown.
        if (expired) return UNKNOWN;
      }
    }
  };

  const deadline = new Promise<ChargeOutcome>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(UNKNOWN);
    }, timeoutMs);
  });

  try {
    return await Promise.race([attempts(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
