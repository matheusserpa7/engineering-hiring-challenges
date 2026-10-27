import type { DonationDetail, SessionUser } from '@aangan/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import { findDonationDetail, listDonationsOf } from '../repositories/donor-records.js';

// A malformed id is "not found" without a query: it can match nothing, and the caller gets the
// same answer as for an id that does not exist. `id` is unknown because Express types a
// route parameter as possibly repeated.
export async function getDonationFor(
  db: Kysely<Database>,
  viewer: SessionUser,
  id: unknown,
): Promise<DonationDetail | undefined> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return undefined;
  return findDonationDetail(db, {
    id: parsed.data,
    viewerId: viewer.id,
    isAdmin: viewer.role === 'admin',
  });
}

export const listMyDonations = (
  db: Kysely<Database>,
  viewer: SessionUser,
): Promise<DonationDetail[]> => listDonationsOf(db, viewer.id);
