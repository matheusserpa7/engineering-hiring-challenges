import type { DonationDetail } from '@aangan/shared';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/database.js';

// Ownership lives in the WHERE of these queries, not in the route (ADR 0005): a row that is not
// the viewer's is simply not found, so the caller cannot tell it from an id that never
// existed. The admin exception is a bound boolean from the session row, never from the client.

const MY_DONATIONS_LIMIT = 100;

// The caller's own rows (`donor_id = viewer`) or, for an admin, any row. It names the table by
// the alias `d`, so every query that uses it must select from `donations as d`.
const visibleTo = (viewerId: string, isAdmin: boolean) => sql<boolean>`
  (d.donor_id = ${viewerId} or ${isAdmin}::boolean)`;

function donationDetailQuery(db: Kysely<Database>) {
  return db
    .selectFrom('donations as d')
    .innerJoin('campaigns as c', 'c.id', 'd.campaign_id')
    .select([
      'd.id',
      'd.receipt_number',
      'c.slug as campaign_slug',
      'c.title as campaign_title',
      'd.donor_name',
      'd.amount_cents',
      'd.currency',
      'd.status',
      'd.privacy_mode',
      'd.dedication_type',
      'd.dedication_name',
      'd.message',
      'd.created_at',
      'd.refunded_at',
    ]);
}

type DetailRow = Awaited<
  ReturnType<ReturnType<typeof donationDetailQuery>['executeTakeFirstOrThrow']>
>;

export function toDonationDetail(row: DetailRow): DonationDetail {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    campaign: { slug: row.campaign_slug, title: row.campaign_title },
    donorName: row.donor_name,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    privacyMode: row.privacy_mode,
    dedication:
      row.dedication_type !== null && row.dedication_name !== null
        ? { type: row.dedication_type, name: row.dedication_name }
        : null,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    refundedAt: row.refunded_at?.toISOString() ?? null,
  };
}

export async function findDonationDetail(
  db: Kysely<Database>,
  { id, viewerId, isAdmin }: { id: string; viewerId: string; isAdmin: boolean },
): Promise<DonationDetail | undefined> {
  const row = await donationDetailQuery(db)
    .where('d.id', '=', id)
    .where(visibleTo(viewerId, isAdmin))
    .executeTakeFirst();
  return row && toDonationDetail(row);
}

// "Mine" is the viewer's own even for an admin: no admin exception here.
export async function listDonationsOf(
  db: Kysely<Database>,
  viewerId: string,
): Promise<DonationDetail[]> {
  const rows = await donationDetailQuery(db)
    .where('d.donor_id', '=', viewerId)
    .orderBy('d.created_at', 'desc')
    .orderBy('d.id', 'desc')
    .limit(MY_DONATIONS_LIMIT)
    .execute();
  return rows.map(toDonationDetail);
}
