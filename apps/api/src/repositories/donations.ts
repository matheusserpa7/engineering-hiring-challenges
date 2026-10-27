import { sql, type Insertable, type Kysely, type Selectable } from 'kysely';
import type { Database, DonationsTable } from '../db/database.js';

type Executor = Kysely<Database>;
export type DonationRow = Selectable<DonationsTable>;

// Everything the intake needs to decide whether a gift is allowed, and nothing it does not.
export function findCampaignRules(db: Executor, slug: string) {
  return db
    .selectFrom('campaigns')
    .select(['id', 'currency', 'min_cents', 'max_cents', 'is_active', 'starts_at', 'ends_at'])
    .where('slug', '=', slug)
    .executeTakeFirst();
}

// One statement, so two requests for a new email cannot both insert. The no-op update is there
// to make RETURNING yield the existing row, and it leaves the stored name alone: a guest cannot
// prove they own an email, so a later gift must not rename the donor behind an earlier one.
export async function upsertDonor(db: Executor, email: string, fullName: string): Promise<string> {
  const row = await db
    .insertInto('donors')
    .values({ email, full_name: fullName })
    .onConflict((oc) => oc.column('email').doUpdateSet((eb) => ({ email: eb.ref('donors.email') })))
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

// The sequence is only ever advanced, never read back, so a rolled-back claim leaves a gap.
// Receipts are unique, not gapless.
export async function nextReceiptSequence(db: Executor): Promise<number> {
  const { rows } = await sql<{
    seq: number;
  }>`select nextval('receipt_number_seq')::bigint as seq`.execute(db);
  const seq = rows[0]?.seq;
  if (seq === undefined) throw new Error('receipt_number_seq returned no row');
  return seq;
}

// The unique index on idempotency_key is the arbiter between concurrent requests: a second
// insert with the same key waits for the first to commit and then does nothing, which shows up
// here as no row. That is a decision for the caller, not an error.
export function claimDonation(db: Executor, values: Insertable<DonationsTable>) {
  return db
    .insertInto('donations')
    .values(values)
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .returningAll()
    .executeTakeFirst();
}

export type Outcome =
  | { kind: 'completed'; chargeId: string; last4: string }
  | { kind: 'failed'; failureCode: string }
  | { kind: 'pending'; failureCode: string };

// Conditional on `status = 'pending'`, so a row that already holds an outcome is never
// overwritten by a late writer. No row back means someone else got there first.
export function recordOutcome(db: Executor, id: string, outcome: Outcome) {
  const values =
    outcome.kind === 'completed'
      ? {
          status: 'completed' as const,
          payment_charge_id: outcome.chargeId,
          payment_last4: outcome.last4,
          failure_code: null,
        }
      : { status: outcome.kind, failure_code: outcome.failureCode };

  return db
    .updateTable('donations')
    .set({ ...values, updated_at: sql<Date>`now()` })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst();
}
