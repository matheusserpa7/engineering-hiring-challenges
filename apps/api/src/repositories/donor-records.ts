import type { AdminDonation, AdminDonationQuery, DonationDetail } from '@aangan/shared';
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

// Fixed map from the validated enum to a column: nothing from the request is spliced into SQL.
const SORT_COLUMNS = {
  createdAt: 'd.created_at',
  amountCents: 'd.amount_cents',
} as const;

// The user's text is data, not a pattern: backslash, % and _ are escaped so '%' finds a percent sign
// and not every row. The ESCAPE clause names the same backslash.
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

interface AdminListArgs {
  viewerId: string;
  isAdmin: boolean;
  query: AdminDonationQuery;
}

// The email match is a subquery, not a condition on the joined donors row: an OR across two
// joined tables is a join filter, which no index serves. As a subquery it runs on donors alone.
// `email::text`, not `email`: on citext, ILIKE picks citext's operator, which the (email::text)
// trigram index cannot serve.
function adminWhere({ viewerId, isAdmin, query }: AdminListArgs) {
  const conditions = [visibleTo(viewerId, isAdmin)];
  if (query.status !== undefined) conditions.push(sql<boolean>`d.status = ${query.status}`);
  if (query.q !== undefined) {
    const pattern = likePattern(query.q);
    conditions.push(
      sql<boolean>`(d.donor_name ilike ${pattern} escape '\\' or d.donor_id in (select id from donors where email::text ilike ${pattern} escape '\\'))`,
    );
  }
  return sql<boolean>`${sql.join(conditions, sql` and `)}`;
}

// Exported so the test can EXPLAIN the exact statement.
export function buildAdminDonationsQuery(db: Kysely<Database>, args: AdminListArgs) {
  const { sort, dir, page, pageSize } = args.query;
  return (
    donationDetailQuery(db)
      .innerJoin('donors as p', 'p.id', 'd.donor_id')
      .select(['p.email as donor_email', 'd.failure_code'])
      .where(adminWhere(args))
      // d.id breaks ties, so two rows with one timestamp keep a fixed place and OFFSET pages
      // never repeat or skip a row.
      .orderBy(SORT_COLUMNS[sort], dir)
      .orderBy('d.id', dir)
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  );
}

// The page and its count read one snapshot, so `total` and `data` agree even while donations
// arrive. READ COMMITTED would let the second statement see rows the first did not.
export async function listAdminDonationRows(
  db: Kysely<Database>,
  args: AdminListArgs,
): Promise<{ rows: AdminDonation[]; total: number }> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .setAccessMode('read only')
    .execute(async (trx) => {
      const rows = await buildAdminDonationsQuery(trx, args).execute();
      const count = await trx
        .selectFrom('donations as d')
        .select(sql<number>`count(*)`.as('total'))
        .where(adminWhere(args))
        .executeTakeFirstOrThrow();
      return {
        rows: rows.map((row) => ({
          ...toDonationDetail(row),
          donorEmail: row.donor_email,
          failureCode: row.failure_code,
        })),
        total: count.total,
      };
    });
}
