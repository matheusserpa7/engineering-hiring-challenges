import { sql, type Expression, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '../db/database.js';

// Every privacy decision is made here, in SQL, so a hidden name never leaves the database: the
// API process cannot leak what it never receives (ADR 0005). The select list is explicit and
// never names donor_id, an email or the raw donor_name of a row that is not public. Modes are
// matched by allow-list, so a mode added later shows nothing until someone decides what it shows.

// Postgres's [[:space:]] does not match a no-break space, a zero-width space and a few other
// characters that people use between words. Left alone, "Dr Maya<nbsp>Gurung" read as two words
// ("Dr", then one word) and came out whole as "The Maya Gurung family": the given name that
// family mode exists to hide. These are treated as spaces before the surname is looked for.
// A list can never be complete, so intake (spec 004) also has to normalise whitespace.
function spacedSql(donorName: Expression<string>): RawBuilder<string> {
  return sql<string>`regexp_replace(
    ${donorName},
    '[\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]',
    ' ',
    'g'
  )`;
}

// Family mode shows a surname only: "The Gurung family". With a comma the surname is the last
// word before it ("Shrestha, Bijay" is Shrestha). Without one it is the last word, but only when
// there are two or more words, because a single word could be the given name that family mode
// exists to hide. No match is NULL, which the caller turns into "Anonymous".
//
// It is an approximation without a surname column (A5): "Maya, Gurung" and "Dr. Maya" show
// "Maya". The tests pin those as known limits.
function surnameSql(donorName: Expression<string>): RawBuilder<string | null> {
  const name = spacedSql(donorName);
  return sql<string | null>`case
    when strpos(${name}, ',') > 0
      then substring(split_part(${name}, ',', 1) from '([^[:space:]]+)[[:space:]]*$')
    else substring(${name} from '[^[:space:]][[:space:]]+([^[:space:]]+)[[:space:]]*$')
  end`;
}

// Exported so the test can evaluate the rule on literal names without inserting rows. A public
// name that is blank shows as Anonymous, so the page never gets an empty name.
export function displayNameSql(
  privacyMode: Expression<string>,
  donorName: Expression<string>,
): RawBuilder<string> {
  return sql<string>`case ${privacyMode}
    when 'public' then case when btrim(${spacedSql(donorName)}) = '' then 'Anonymous' else ${donorName} end
    when 'family' then coalesce('The ' || ${surnameSql(donorName)} || ' family', 'Anonymous')
    else 'Anonymous'
  end`;
}

// Only public and family gifts show a dedication, and only when it is complete.
const showsDedication = sql<boolean>`(
  d.privacy_mode in ('public', 'family')
  and d.dedication_type is not null
  and d.dedication_name is not null
)`;

// Newest first, with the id as a tie-break so the order is the same on every read. Nothing from
// the request reaches ORDER BY, and the limit is a bound parameter.
export function listPublicDonations(db: Kysely<Database>, campaignId: string, limit: number) {
  return db
    .selectFrom('donations as d')
    .select([
      'd.id',
      'd.amount_cents',
      'd.created_at',
      displayNameSql(sql.ref<string>('d.privacy_mode'), sql.ref<string>('d.donor_name')).as(
        'display_name',
      ),
      sql<'in_honor_of' | 'in_memory_of' | null>`case when ${showsDedication}
        then d.dedication_type end`.as('dedication_type'),
      sql<string | null>`case when ${showsDedication} then d.dedication_name end`.as(
        'dedication_name',
      ),
      sql<string | null>`case when d.privacy_mode in ('public', 'family')
        then d.message end`.as('message'),
    ])
    .where('d.campaign_id', '=', campaignId)
    .where('d.status', '=', 'completed')
    .orderBy('d.created_at', 'desc')
    .orderBy('d.id', 'desc')
    .limit(limit)
    .execute();
}
