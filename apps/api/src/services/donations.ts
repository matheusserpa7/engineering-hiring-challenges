import { createHash } from 'node:crypto';
import type { DonationReceipt, DonationRequest } from '@aangan/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { AppError } from '../http/errors.js';
import type { Logger } from '../logger.js';
import { chargeWithPolicy, type PaymentProvider } from '../payments/charge.js';
import {
  claimDonation,
  findByKey,
  findCampaignRules,
  nextReceiptSequence,
  recordOutcome,
  upsertDonor,
  type DonationRow,
  type KeyedDonation,
  type Outcome,
} from '../repositories/donations.js';
import { campaignPhase } from './campaigns.js';

export interface IntakeSettings {
  payments: PaymentProvider;
  paymentTimeoutMs: number;
  orgTimezone: string;
  donationRateLimit: number;
}

export interface DonationDeps extends IntakeSettings {
  db: Kysely<Database>;
  now: () => Date;
  logger: Logger;
}

// `HCC-{year}-{sequence}`. The sequence is padded in code, not with SQL lpad: lpad truncates
// from the right, so number 1,234,567 would become 123456 and collide.
export function receiptNumber(year: number, sequence: number): string {
  return `HCC-${String(year)}-${String(sequence).padStart(6, '0')}`;
}

// The year people read on a receipt is the organisation's, not the server's or UTC's.
export function receiptYear(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at));
}

// Hashes the parsed, normalised request in a fixed field order, so key order, spacing and
// NFD versus NFC in the client's JSON cannot make one attempt look like two. An omitted
// message and an explicit null are the same request.
export function requestHash(request: DonationRequest): string {
  const fields = [
    request.campaignSlug,
    request.amountCents,
    request.donor.fullName,
    request.donor.email,
    request.dedication?.type ?? null,
    request.dedication?.name ?? null,
    request.message ?? null,
    request.privacyMode,
    request.isRecurring,
    request.paymentToken,
  ];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function toReceipt(row: DonationRow): DonationReceipt {
  // A failed row is never given back as a receipt; the caller answers it with an error.
  if (row.status === 'failed') throw new Error('a failed donation has no receipt');
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export interface IntakeResult {
  httpStatus: 201 | 202;
  receipt: DonationReceipt;
  replayed: boolean;
}

// A request that has had no outcome for longer than its own deadline plus this margin cannot
// still be running (a crash, a restart), so it is answered 202 instead of locking the key.
const IN_FLIGHT_MARGIN_MS = 5000;

// The answer is derived from the row, not stored: the row is the record of what happened.
function answerFromRow(row: DonationRow, replayed: boolean): IntakeResult {
  const headers = replayed ? { 'Idempotent-Replayed': 'true' } : undefined;
  if (row.status === 'failed') {
    if (row.failure_code === 'provider_error') {
      throw new AppError(
        502,
        'payment_provider_error',
        'The payment provider is unavailable.',
        undefined,
        headers,
      );
    }
    if (row.failure_code === 'insufficient_funds') {
      throw new AppError(
        402,
        'insufficient_funds',
        'The card has insufficient funds.',
        undefined,
        headers,
      );
    }
    throw new AppError(402, 'card_declined', 'The card was declined.', undefined, headers);
  }
  return {
    httpStatus: row.status === 'pending' ? 202 : 201,
    receipt: toReceipt(row),
    replayed,
  };
}

function replayExisting(existing: KeyedDonation, hash: string): IntakeResult {
  if (existing.request_hash !== hash) {
    throw new AppError(
      422,
      'idempotency_key_mismatch',
      'This Idempotency-Key was already used with a different request.',
    );
  }
  if (existing.status === 'pending' && existing.failure_code === null && existing.is_fresh) {
    throw new AppError(
      409,
      'request_in_progress',
      'This donation is already being processed.',
      undefined,
      { 'Retry-After': '1' },
    );
  }
  return answerFromRow(existing, true);
}

export async function submitDonation(
  deps: DonationDeps,
  idempotencyKey: string,
  request: DonationRequest,
): Promise<IntakeResult> {
  const { db, now, logger } = deps;
  const hash = requestHash(request);
  const freshForMs = deps.paymentTimeoutMs + IN_FLIGHT_MARGIN_MS;

  // The key is looked up before the rules: a retry must get its original outcome back, not a
  // rule that changed since. This read only short-cuts; the unique index below stays the arbiter.
  const existing = await findByKey(db, idempotencyKey, freshForMs);
  if (existing) return replayExisting(existing, hash);

  const campaign = await findCampaignRules(db, request.campaignSlug);
  if (!campaign) throw new AppError(404, 'not_found', 'Campaign not found.');
  const phase = campaignPhase(
    { isActive: campaign.is_active, startsAt: campaign.starts_at, endsAt: campaign.ends_at },
    now(),
  );
  if (phase !== 'open') {
    throw new AppError(422, 'campaign_closed', 'This campaign is not accepting donations.');
  }
  // The charge amount is this checked value, never a total or price the client could send.
  if (request.amountCents < campaign.min_cents || request.amountCents > campaign.max_cents) {
    throw new AppError(
      422,
      'amount_out_of_range',
      'The amount is outside what this campaign accepts.',
      [{ field: 'amountCents', issue: 'out_of_range' }],
    );
  }

  // Claim the key in a short transaction that commits before any network call, so no database
  // connection or lock is held while the provider is slow.
  const claimed = await db.transaction().execute(async (trx) => {
    const donorId = await upsertDonor(trx, request.donor.email, request.donor.fullName);
    const sequence = await nextReceiptSequence(trx);
    return claimDonation(trx, {
      campaign_id: campaign.id,
      donor_id: donorId,
      donor_name: request.donor.fullName,
      amount_cents: request.amountCents,
      currency: campaign.currency,
      status: 'pending',
      privacy_mode: request.privacyMode,
      dedication_type: request.dedication?.type ?? null,
      dedication_name: request.dedication?.name ?? null,
      message: request.message ?? null,
      is_recurring: request.isRecurring,
      receipt_number: receiptNumber(receiptYear(now(), deps.orgTimezone), sequence),
      idempotency_key: idempotencyKey,
      request_hash: hash,
    });
  });
  if (!claimed) {
    // A concurrent request with this key won the insert. Its row is committed by now.
    const winner = await findByKey(db, idempotencyKey, freshForMs);
    if (!winner) throw new Error('idempotency key conflicted but no donation holds it');
    return replayExisting(winner, hash);
  }

  const charge = await chargeWithPolicy(
    deps.payments,
    {
      token: request.paymentToken,
      amountCents: request.amountCents,
      idempotencyKey: claimed.id,
    },
    deps.paymentTimeoutMs,
  );

  // Only a definite answer leaves `pending`. Unknown stays pending: the money may have moved,
  // and a donation marked failed after a successful charge is the failure that matters.
  let outcome: Outcome;
  switch (charge.kind) {
    case 'charged':
      outcome = { kind: 'completed', chargeId: charge.chargeId, last4: charge.last4 };
      break;
    case 'declined':
      outcome = { kind: 'failed', failureCode: charge.code };
      break;
    case 'provider_error':
      outcome = { kind: 'failed', failureCode: 'provider_error' };
      break;
    case 'unknown':
      outcome = { kind: 'pending', failureCode: 'provider_timeout' };
      break;
  }

  let row: DonationRow | undefined;
  try {
    row = await recordOutcome(db, claimed.id, outcome);
  } catch (error) {
    // The charge may already have happened. Telling the donor "error" invites a retry under a
    // new key and a second charge, so answer from the pending row instead.
    logger.error({ err: error, donationId: claimed.id }, 'recording the payment outcome failed');
    return { httpStatus: 202, receipt: toReceipt(claimed), replayed: false };
  }
  if (!row) {
    // Something else recorded an outcome first; answer from what is stored.
    const current = await findByKey(db, idempotencyKey, freshForMs);
    if (!current) throw new Error('donation vanished before its outcome was recorded');
    return answerFromRow(current, false);
  }

  logger.info(
    { donationId: row.id, receiptNumber: row.receipt_number, status: row.status },
    'donation processed',
  );

  return answerFromRow(row, false);
}
