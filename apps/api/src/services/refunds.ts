import type { AdminDonation, SessionUser } from '@aangan/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import { AppError } from '../http/errors.js';
import { findAdminDonation } from '../repositories/donor-records.js';
import { refundDonation } from '../repositories/refunds.js';

// No Idempotency-Key (tech spec 005 F2): completed -> refunded happens once, so a retry meets a
// row that is no longer completed and gets 409 without writing anything.
export async function refundAs(
  db: Kysely<Database>,
  actor: SessionUser,
  id: unknown,
  reason: string,
): Promise<AdminDonation> {
  const parsed = z.uuid().safeParse(id);
  // A malformed id is "not found", like an id nobody has.
  if (!parsed.success) throw notFound();

  const outcome = await refundDonation(db, { id: parsed.data, actorId: actor.id, reason });
  if (outcome.kind === 'missing') throw notFound();
  if (outcome.kind === 'conflict') {
    throw outcome.status === 'refunded'
      ? new AppError(409, 'already_refunded', 'This donation has already been refunded.')
      : new AppError(409, 'not_refundable', 'Only a completed donation can be refunded.');
  }

  const donation = await findAdminDonation(db, parsed.data);
  // The row was updated in this request, so it exists.
  if (!donation) throw notFound();
  return donation;
}

const notFound = () => new AppError(404, 'not_found', 'Donation not found.');
