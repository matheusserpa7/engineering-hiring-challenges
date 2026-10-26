import { sql, type Kysely } from 'kysely';

// The whole schema in one reviewed migration. Up only: a schema change is a new migration,
// because a `down` that is never run is untested code.
//
// Money is bigint cents. Legacy rows (source = 'import') are exempt from four checks that
// new donations must pass, so the exemption is explicit and visible in the schema.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists citext`.execute(db);
  await sql`create extension if not exists pg_trgm`.execute(db);

  await db.schema
    .createTable('campaigns')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('slug', 'text', (col) => col.notNull().unique())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('story', 'text')
    .addColumn('goal_cents', 'bigint', (col) => col.notNull().check(sql`goal_cents > 0`))
    .addColumn('currency', 'char(3)', (col) => col.notNull().defaultTo('USD'))
    .addColumn('min_cents', 'bigint', (col) => col.notNull())
    .addColumn('max_cents', 'bigint', (col) => col.notNull())
    .addColumn('preset_cents', sql`bigint[]`, (col) => col.notNull())
    .addColumn('starts_at', 'timestamptz')
    .addColumn('ends_at', 'timestamptz')
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'campaigns_amount_bounds_check',
      sql`min_cents >= 100 and max_cents <= 2500000 and min_cents <= max_cents`,
    )
    .execute();

  await db.schema
    .createTable('donors')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // citext makes the unique constraint case-insensitive: "A@x.org" and "a@x.org" collide.
    .addColumn('email', sql`citext`, (col) => col.notNull().unique())
    .addColumn('full_name', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text')
    .addColumn('role', 'text', (col) =>
      col
        .notNull()
        .defaultTo('donor')
        .check(sql`role in ('donor', 'admin')`),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('donations')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('campaign_id', 'uuid', (col) => col.notNull().references('campaigns.id'))
    .addColumn('donor_id', 'uuid', (col) => col.notNull().references('donors.id'))
    // A snapshot: guest checkout cannot prove who owns an email, so a later donation must
    // not be able to rename the donor on an earlier public one.
    .addColumn('donor_name', 'text', (col) => col.notNull())
    .addColumn('amount_cents', 'bigint', (col) =>
      col.notNull().check(sql`amount_cents between 100 and 2500000`),
    )
    .addColumn('currency', 'char(3)', (col) => col.notNull())
    .addColumn('status', 'text', (col) =>
      col.notNull().check(sql`status in ('pending', 'completed', 'failed', 'refunded')`),
    )
    .addColumn('privacy_mode', 'text', (col) =>
      col
        .notNull()
        .defaultTo('public')
        .check(sql`privacy_mode in ('public', 'anonymous', 'family')`),
    )
    .addColumn('dedication_type', 'text', (col) =>
      col.check(sql`dedication_type in ('in_honor_of', 'in_memory_of')`),
    )
    .addColumn('dedication_name', 'text')
    .addColumn('message', 'text')
    .addColumn('is_recurring', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('receipt_number', 'text', (col) => col.notNull().unique())
    // The unique constraint is what makes a retried or doubled request a single row.
    .addColumn('idempotency_key', 'text', (col) => col.unique())
    .addColumn('request_hash', 'text')
    .addColumn('payment_charge_id', 'text')
    .addColumn('payment_last4', 'char(4)')
    .addColumn('failure_code', 'text')
    .addColumn('source', 'text', (col) =>
      col
        .notNull()
        .defaultTo('web')
        .check(sql`source in ('web', 'import')`),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('refunded_at', 'timestamptz')
    // char_length counts code points, not UTF-16 units, so 280 emoji fit.
    .addCheckConstraint(
      'donations_message_length_check',
      sql`source = 'import' or char_length(message) <= 280`,
    )
    .addCheckConstraint(
      'donations_dedication_pair_check',
      sql`source = 'import' or (dedication_type is null) = (dedication_name is null)`,
    )
    .addCheckConstraint(
      'donations_idempotency_key_required_check',
      sql`source = 'import' or idempotency_key is not null`,
    )
    // The CSV has no refund timestamps, so imported refunds keep refunded_at null.
    .addCheckConstraint(
      'donations_refunded_at_check',
      sql`source = 'import' or (status = 'refunded') = (refunded_at is not null)`,
    )
    .execute();

  await db.schema
    .createTable('refunds')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Unique: a second audit row for the same refund is impossible, even if the app is wrong.
    .addColumn('donation_id', 'uuid', (col) => col.notNull().unique().references('donations.id'))
    .addColumn('actor_id', 'uuid', (col) => col.notNull().references('donors.id'))
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('amount_cents', 'bigint', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Only the hash is stored, so a leaked table is not a set of usable sessions.
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('donor_id', 'uuid', (col) => col.notNull().references('donors.id'))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`create sequence receipt_number_seq`.execute(db);

  // Public list and campaign totals: filter by campaign and status, newest first.
  await sql`create index donations_campaign_status_created_idx
    on donations (campaign_id, status, created_at desc)`.execute(db);
  // A donor's own history.
  await sql`create index donations_donor_created_idx
    on donations (donor_id, created_at desc)`.execute(db);
  // Admin search by name or email with ILIKE '%term%'. receipt_number needs no index of its
  // own: its unique constraint already has one.
  await sql`create index donations_donor_name_trgm_idx
    on donations using gin (donor_name gin_trgm_ops)`.execute(db);
  await sql`create index donors_email_trgm_idx
    on donors using gin ((email::text) gin_trgm_ops)`.execute(db);
}
