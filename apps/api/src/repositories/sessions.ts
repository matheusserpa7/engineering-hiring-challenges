import type { SessionUser } from '@aangan/shared';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../db/database.js';

export interface Account {
  id: string;
  email: string;
  fullName: string;
  role: 'donor' | 'admin';
  passwordHash: string | null;
}

// donors.email is citext, so the comparison ignores case without lower() on either side.
export async function findAccountByEmail(
  db: Kysely<Database>,
  email: string,
): Promise<Account | undefined> {
  const row = await db
    .selectFrom('donors')
    .select(['id', 'email', 'full_name', 'role', 'password_hash'])
    .where('email', '=', email)
    .executeTakeFirst();
  return (
    row && {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      passwordHash: row.password_hash,
    }
  );
}

// The expiry is computed by the database clock, the same one that later compares it, so an
// application server with a skewed clock cannot issue a session that is born expired or never
// ends. The sweep keeps the table from growing by one row per login for ever.
export async function createSession(
  db: Kysely<Database>,
  { donorId, tokenHash, ttlHours }: { donorId: string; tokenHash: string; ttlHours: number },
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('sessions')
      .where('donor_id', '=', donorId)
      .where('expires_at', '<=', sql<Date>`now()`)
      .execute();
    await trx
      .insertInto('sessions')
      .values({
        token_hash: tokenHash,
        donor_id: donorId,
        expires_at: sql<Date>`now() + make_interval(hours => ${ttlHours})`,
      })
      .execute();
  });
}

// One indexed query on the unique token_hash. The role is read here on every request, never
// copied into the session, so a demotion takes effect at once.
export async function findViewerByTokenHash(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<SessionUser | undefined> {
  const row = await db
    .selectFrom('sessions as s')
    .innerJoin('donors as d', 'd.id', 's.donor_id')
    .select(['d.id', 'd.email', 'd.full_name', 'd.role'])
    .where('s.token_hash', '=', tokenHash)
    .where('s.expires_at', '>', sql<Date>`now()`)
    .executeTakeFirst();
  return row && { id: row.id, email: row.email, fullName: row.full_name, role: row.role };
}

export async function deleteSession(db: Kysely<Database>, tokenHash: string): Promise<void> {
  await db.deleteFrom('sessions').where('token_hash', '=', tokenHash).execute();
}
