import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { hashPassword } from '../../auth/password.js';
import type { Database } from '../database.js';
import { parseSeed, type SeedCampaign, type SeedDonation } from './read-seed.js';

export type ParsedSeed = ReturnType<typeof parseSeed>;

// The three demo logins from SETUP.md, listed in the README in plain text on purpose: the
// reviewers sign in with them. docs/04 §1 allows exactly this. Not a place for real secrets.
const ACCOUNTS = [
  {
    email: 'admin@himalayacc.example',
    fullName: 'HCC Admin',
    role: 'admin',
    password: 'admin12345',
  },
  {
    email: 'donor@himalayacc.example',
    fullName: 'Test Donor',
    role: 'donor',
    password: 'donor12345',
  },
  {
    email: 'other@himalayacc.example',
    fullName: 'Other Donor',
    role: 'donor',
    password: 'other12345',
  },
] as const;

export function loadSeed(seedDir: string): ParsedSeed {
  return parseSeed({
    campaignsJson: readFileSync(resolve(seedDir, 'campaigns.json'), 'utf8'),
    donationsCsv: readFileSync(resolve(seedDir, 'donations.csv'), 'utf8'),
  });
}

// Everything is INSERT ... ON CONFLICT DO NOTHING on a natural key (slug, email, receipt
// number) and nothing is ever updated, so a restart is a no-op and rows the app wrote since
// survive. Two instances seeding at once insert in the same order, so the loser waits on the
// winner's unique key, then skips: no deadlock and no duplicate. One transaction, so a bad row
// leaves nothing half-seeded.
export async function runSeed(db: Kysely<Database>, seed: ParsedSeed): Promise<void> {
  await db.transaction().execute(async (trx) => {
    // Accounts first: a CSV row with one of these emails then attaches to the account that
    // has the role and password, instead of creating a plain donor under the same address.
    await insertAccounts(trx);
    await insertCampaigns(trx, seed.campaigns);
    await insertDonors(trx, seed.donations);
    await insertDonations(trx, seed.donations);
    await advanceReceiptSequence(trx, seed.donations);
  });
}

async function insertAccounts(db: Kysely<Database>): Promise<void> {
  const existing = await db
    .selectFrom('donors')
    .select('email')
    .where(
      'email',
      'in',
      ACCOUNTS.map((account) => account.email),
    )
    .execute();
  const present = new Set(existing.map((row) => row.email.toLowerCase()));

  // One at a time: each hash takes 128 MiB, and the hash is skipped when the account is
  // already there, which keeps a restart fast.
  for (const account of ACCOUNTS) {
    if (present.has(account.email)) continue;
    await db
      .insertInto('donors')
      .values({
        email: account.email,
        full_name: account.fullName,
        role: account.role,
        password_hash: await hashPassword(account.password),
      })
      .onConflict((conflict) => conflict.column('email').doNothing())
      .execute();
  }
}

async function insertCampaigns(db: Kysely<Database>, campaigns: SeedCampaign[]): Promise<void> {
  await db
    .insertInto('campaigns')
    .values(
      campaigns.map((campaign) => ({
        slug: campaign.slug,
        title: campaign.title,
        story: campaign.story,
        goal_cents: campaign.goalCents,
        currency: campaign.currency,
        min_cents: campaign.minCents,
        max_cents: campaign.maxCents,
        preset_cents: campaign.presetCents,
        starts_at: campaign.startsAt,
        ends_at: campaign.endsAt,
        is_active: campaign.isActive,
      })),
    )
    .onConflict((conflict) => conflict.column('slug').doNothing())
    .execute();
}

// Oldest first, with the receipt number as tie-break, so "the first row for an email" and the
// insert order are the same on every run.
function inSeedOrder(donations: SeedDonation[]): SeedDonation[] {
  return [...donations].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.receiptNumber.localeCompare(b.receiptNumber),
  );
}

async function insertDonors(db: Kysely<Database>, donations: SeedDonation[]): Promise<void> {
  // The first donation for an email names the donor (B1). Each donation keeps its own
  // donor_name, so a later spelling never rewrites an earlier public gift.
  const names = new Map<string, string>();
  for (const donation of inSeedOrder(donations)) {
    if (!names.has(donation.donorEmail)) names.set(donation.donorEmail, donation.donorName);
  }
  await db
    .insertInto('donors')
    .values([...names].map(([email, fullName]) => ({ email, full_name: fullName })))
    .onConflict((conflict) => conflict.column('email').doNothing())
    .execute();
}

async function insertDonations(db: Kysely<Database>, donations: SeedDonation[]): Promise<void> {
  // Only this seed's rows, not every donor the app has collected since.
  const slugs = [...new Set(donations.map((donation) => donation.campaignSlug))];
  const emails = [...new Set(donations.map((donation) => donation.donorEmail))];
  const campaigns = await db
    .selectFrom('campaigns')
    .select(['id', 'slug', 'currency'])
    .where('slug', 'in', slugs)
    .execute();
  const donors = await db
    .selectFrom('donors')
    .select(['id', 'email'])
    .where('email', 'in', emails)
    .execute();
  const campaignBySlug = new Map(campaigns.map((campaign) => [campaign.slug, campaign]));
  const donorIdByEmail = new Map(donors.map((donor) => [donor.email.toLowerCase(), donor.id]));

  const rows = inSeedOrder(donations).map((donation) => {
    const campaign = campaignBySlug.get(donation.campaignSlug);
    const donorId = donorIdByEmail.get(donation.donorEmail);
    if (!campaign || !donorId) {
      throw new Error(`Seed row ${donation.receiptNumber} has no campaign or donor to attach to`);
    }
    return {
      campaign_id: campaign.id,
      donor_id: donorId,
      donor_name: donation.donorName,
      amount_cents: donation.amountCents,
      currency: campaign.currency,
      status: donation.status,
      privacy_mode: donation.privacyMode,
      dedication_type: donation.dedicationType,
      dedication_name: donation.dedicationName,
      message: donation.message,
      is_recurring: donation.isRecurring,
      receipt_number: donation.receiptNumber,
      // 'import' is what exempts legacy rows from the checks new donations must pass (A1).
      // refunded_at stays null: the CSV has no refund time, and inventing one would be fake
      // history (B2).
      source: 'import' as const,
      created_at: donation.createdAt,
      updated_at: donation.createdAt,
    };
  });
  await db
    .insertInto('donations')
    .values(rows)
    .onConflict((conflict) => conflict.column('receipt_number').doNothing())
    .execute();
}

// The first receipt the app issues must follow the seeded ones. greatest() makes it only ever
// move forward, so a restart after real donations cannot hand out a number twice. A nextval
// between the read and the setval inside this one statement could still be undone, but the
// seed runs before the server listens.
async function advanceReceiptSequence(
  db: Kysely<Database>,
  donations: SeedDonation[],
): Promise<void> {
  // Starting at 1: setval cannot take 0, the sequence's minimum.
  const highest = donations.reduce(
    (max, donation) => Math.max(max, Number(donation.receiptNumber.slice(-6))),
    1,
  );
  await sql`
    select setval(
      'receipt_number_seq',
      greatest(
        ${highest}::bigint,
        (select case when is_called then last_value else 0 end from receipt_number_seq)
      )
    )`.execute(db);
}
