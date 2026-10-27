import {
  progressPercent,
  type CampaignPhase,
  type PublicCampaign,
  type PublicDonation,
} from '@aangan/shared';
import type { Kysely } from 'kysely';
import type { Database } from '../db/database.js';
import { findCampaignId, findCampaignWithTotals } from '../repositories/campaigns.js';
import { listPublicDonations } from '../repositories/public-donations.js';

export interface CampaignDeps {
  db: Kysely<Database>;
  now: () => Date;
}

// The only business rule in this spec, and spec 004's intake will import it. Instants are
// compared, so no calendar maths and no time zone are involved. Both ends are inclusive.
export function campaignPhase(
  campaign: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): CampaignPhase {
  if (!campaign.isActive) return 'closed';
  if (campaign.startsAt && now < campaign.startsAt) return 'upcoming';
  if (campaign.endsAt && now > campaign.endsAt) return 'closed';
  return 'open';
}

export async function getPublicCampaign(
  { db, now }: CampaignDeps,
  slug: string,
): Promise<PublicCampaign | null> {
  const row = await findCampaignWithTotals(db, slug);
  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    story: row.story,
    currency: row.currency,
    goalCents: row.goal_cents,
    raisedCents: row.raised_cents,
    donorCount: row.donor_count,
    // Computed here so curl and the page agree. Uncapped: the page caps the bar, not the number.
    progressPercent: progressPercent(row.raised_cents, row.goal_cents),
    presetCents: row.preset_cents,
    minCents: row.min_cents,
    maxCents: row.max_cents,
    isActive: row.is_active,
    phase: campaignPhase(
      { isActive: row.is_active, startsAt: row.starts_at, endsAt: row.ends_at },
      now(),
    ),
    // Always a UTC string ending in Z, which is what PublicCampaignSchema accepts.
    startsAt: row.starts_at?.toISOString() ?? null,
    endsAt: row.ends_at?.toISOString() ?? null,
  };
}

// null means the campaign does not exist. The privacy rules are already applied by the query;
// this only reshapes a flat row into the DTO.
export async function listRecentDonations(
  { db }: CampaignDeps,
  slug: string,
  limit: number,
): Promise<PublicDonation[] | null> {
  const campaign = await findCampaignId(db, slug);
  if (!campaign) return null;

  const rows = await listPublicDonations(db, campaign.id, limit);
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    amountCents: row.amount_cents,
    // The query already nulls an incomplete dedication; this check is for the types only.
    dedication:
      row.dedication_type && row.dedication_name
        ? { type: row.dedication_type, name: row.dedication_name }
        : null,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  }));
}
