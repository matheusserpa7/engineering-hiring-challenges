import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/database.js';

export type RefundOutcome =
  | { kind: 'refunded' }
  | { kind: 'missing' }
  | { kind: 'conflict'; status: 'pending' | 'completed' | 'failed' | 'refunded' };

// One transaction: the status change and the audit row commit together or not at all.
//
// The conditional UPDATE is the whole concurrency story. It takes the row lock, so concurrent
// refunds of one donation queue behind the first. When the winner commits, Postgres re-checks
// each waiter's `status = 'completed'` against the new row version, finds it false and updates
// nothing. There is no read followed by a write, so there is no window between the two. The
// unique refunds.donation_id is a backstop that this code never reaches.
//
// Totals and the public list are derived from `status` when they are read (never stored), so
// they change at this commit and cannot drift from the audit row.
export async function refundDonation(
  db: Kysely<Database>,
  { id, actorId, reason }: { id: string; actorId: string; reason: string },
): Promise<RefundOutcome> {
  return db.transaction().execute(async (trx): Promise<RefundOutcome> => {
    const updated = await trx
      .updateTable('donations')
      .set({ status: 'refunded', refunded_at: sql<Date>`now()`, updated_at: sql<Date>`now()` })
      .where('id', '=', id)
      .where('status', '=', 'completed')
      .returning('amount_cents')
      .executeTakeFirst();

    if (!updated) {
      // Nothing was written, so this read only decides which refusal to give.
      const current = await trx
        .selectFrom('donations')
        .select('status')
        .where('id', '=', id)
        .executeTakeFirst();
      return current ? { kind: 'conflict', status: current.status } : { kind: 'missing' };
    }

    await trx
      .insertInto('refunds')
      .values({ donation_id: id, actor_id: actorId, reason, amount_cents: updated.amount_cents })
      .execute();
    return { kind: 'refunded' };
  });
}
