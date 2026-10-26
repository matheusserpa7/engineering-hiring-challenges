import { Kysely, PostgresDialect, type Generated } from 'kysely';
import type pg from 'pg';

// Written by hand next to migration 0001. If they drift, the integration tests fail, because
// every query runs against the migrated schema. bigint columns are `number` because the pool
// parses int8 into a safe integer (see pool.ts).

export interface CampaignsTable {
  id: Generated<string>;
  slug: string;
  title: string;
  story: string | null;
  goal_cents: number;
  currency: Generated<string>;
  min_cents: number;
  max_cents: number;
  preset_cents: number[];
  starts_at: Date | null;
  ends_at: Date | null;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DonorsTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  password_hash: string | null;
  role: Generated<'donor' | 'admin'>;
  created_at: Generated<Date>;
}

export interface DonationsTable {
  id: Generated<string>;
  campaign_id: string;
  donor_id: string;
  donor_name: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  privacy_mode: Generated<'public' | 'anonymous' | 'family'>;
  dedication_type: 'in_honor_of' | 'in_memory_of' | null;
  dedication_name: string | null;
  message: string | null;
  is_recurring: Generated<boolean>;
  receipt_number: string;
  idempotency_key: string | null;
  request_hash: string | null;
  payment_charge_id: string | null;
  payment_last4: string | null;
  failure_code: string | null;
  source: Generated<'web' | 'import'>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  refunded_at: Date | null;
}

export interface RefundsTable {
  id: Generated<string>;
  donation_id: string;
  actor_id: string;
  reason: string;
  amount_cents: number;
  created_at: Generated<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  token_hash: string;
  donor_id: string;
  expires_at: Date;
  created_at: Generated<Date>;
}

export interface Database {
  campaigns: CampaignsTable;
  donors: DonorsTable;
  donations: DonationsTable;
  refunds: RefundsTable;
  sessions: SessionsTable;
}

// Kysely owns the pool from here: db.destroy() also ends it.
export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
