import { DonationReceiptSchema, type DonationReceipt, type DonationRequest } from '@aangan/shared';
import { shallowRef, type Ref } from 'vue';
import { ApiError, postJson } from '../api';
import { newIdempotencyKey } from '../idempotency-key';

export type DonationOutcome =
  // 201 completed, or 202 pending: the receipt's status says which.
  | { kind: 'receipt'; receipt: DonationReceipt }
  | { kind: 'declined'; code: 'card_declined' | 'insufficient_funds' }
  | { kind: 'provider_error' }
  | { kind: 'in_progress' }
  | { kind: 'rate_limited'; retryAfter: number | null }
  // The server refused the request itself (422, 404, 400): details name the fields.
  | { kind: 'rejected'; code: string; message: string; details: unknown }
  | { kind: 'network' }
  | { kind: 'unexpected' };

export type DonationState =
  { status: 'idle' } | { status: 'submitting' } | { status: 'finished'; outcome: DonationOutcome };

// Whether the server may still be working on, or may have recorded, the attempt. Only then must
// the next try reuse the key: a new one could charge the donor twice. Every other answer is final.
function outcomeIsUnknown(outcome: DonationOutcome): boolean {
  return (
    outcome.kind === 'network' ||
    outcome.kind === 'in_progress' ||
    outcome.kind === 'rate_limited' ||
    outcome.kind === 'unexpected'
  );
}

function toOutcome(error: unknown): DonationOutcome {
  if (!(error instanceof ApiError)) return { kind: 'network' };
  switch (error.code) {
    case 'card_declined':
    case 'insufficient_funds':
      return { kind: 'declined', code: error.code };
    case 'payment_provider_error':
      return { kind: 'provider_error' };
    case 'request_in_progress':
      return { kind: 'in_progress' };
    case 'rate_limited':
      return { kind: 'rate_limited', retryAfter: error.retryAfter };
    case 'unexpected_response':
    case 'internal_error':
    case 'unavailable':
      return { kind: 'unexpected' };
    default:
      return { kind: 'rejected', code: error.code, message: error.message, details: error.details };
  }
}

export function useDonation(): {
  state: Ref<DonationState>;
  submit: (request: DonationRequest) => Promise<void>;
  reset: () => void;
} {
  const state = shallowRef<DonationState>({ status: 'idle' });
  // The key belongs to one serialised body: the same body may retry under it, an edited one
  // is a different gift and gets its own.
  let attempt: { key: string; body: string } | null = null;

  async function submit(request: DonationRequest): Promise<void> {
    if (state.value.status === 'submitting') return;
    const body = JSON.stringify(request);
    if (attempt?.body !== body) attempt = { key: newIdempotencyKey(), body };
    const { key } = attempt;
    state.value = { status: 'submitting' };

    let outcome: DonationOutcome;
    try {
      const receipt = await postJson('/api/donations', request, DonationReceiptSchema, {
        idempotencyKey: key,
      });
      outcome = { kind: 'receipt', receipt };
    } catch (error) {
      outcome = toOutcome(error);
    }
    if (!outcomeIsUnknown(outcome)) attempt = null;
    state.value = { status: 'finished', outcome };
  }

  return { state, submit, reset: () => (state.value = { status: 'idle' }) };
}
