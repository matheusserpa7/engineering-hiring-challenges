import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/database.js';

// One statement, so the total and the donor count come from the same snapshot and cannot
// disagree. The status filter is part of the JOIN condition, not the WHERE: in the WHERE it
// would turn the outer join into an inner one, and a campaign with no completed gift would
// come back as no row, which the route reads as a 404.
//
// SUM(bigint) is numeric, which the pool leaves as a string, so it is cast back to bigint.
// count(DISTINCT donor_id) counts people, not gifts: two gifts from one donor are one donor.
export function findCampaignWithTotals(db: Kysely<Database>, slug: string) {
  return db
    .selectFrom('campaigns as c')
    .leftJoin('donations as d', (join) =>
      join.onRef('d.campaign_id', '=', 'c.id').on('d.status', '=', 'completed'),
    )
    .select([
      'c.id',
      'c.slug',
      'c.title',
      'c.story',
      'c.currency',
      'c.goal_cents',
      'c.min_cents',
      'c.max_cents',
      'c.preset_cents',
      'c.is_active',
      'c.starts_at',
      'c.ends_at',
      sql<number>`coalesce(sum(d.amount_cents), 0)::bigint`.as('raised_cents'),
      sql<number>`count(distinct d.donor_id)`.as('donor_count'),
    ])
    .where('c.slug', '=', slug)
    .groupBy('c.id')
    .executeTakeFirst();
}

// The list needs only the id. The id found here is still the
// campaign's when the list query runs a moment later (no route deletes a campaign).
export function findCampaignId(db: Kysely<Database>, slug: string) {
  return db.selectFrom('campaigns').select('id').where('slug', '=', slug).executeTakeFirst();
}
