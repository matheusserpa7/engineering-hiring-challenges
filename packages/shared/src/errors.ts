// The one error shape every API response uses (tech spec 000 §5). The API builds it from
// these types and the web client reads it with isApiErrorBody, so both sides share one
// list of codes. Each spec adds the codes its endpoints need.
export const ERROR_CODES = [
  'bad_request',
  'malformed_json',
  'payload_too_large',
  'not_found',
  'validation_failed',
  'unavailable',
  'idempotency_key_required',
  'idempotency_key_mismatch',
  'request_in_progress',
  'card_declined',
  'insufficient_funds',
  'payment_provider_error',
  'campaign_closed',
  'amount_out_of_range',
  'rate_limited',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

const knownCodes: ReadonlySet<string> = new Set(ERROR_CODES);

// The guard promises code: ErrorCode, so it must check membership or the narrowing would
// lie. The accepted cost: a browser running an older bundle shows a generic error when a
// newer API sends a code it doesn't know yet.
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    knownCodes.has(error.code) &&
    'message' in error &&
    typeof error.message === 'string'
  );
}
