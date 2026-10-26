# Tech Spec 002 — Data and money

Status: draft, awaiting approval · Implements [`prd.md`](prd.md) · Inherits
[000 techspec](../000-overview/techspec.md) §3 (money) and §4 (data model), and ADR 0002.

## 1. Approach and affected components

```
packages/shared/src/money.ts        parseDollarsToCents, formatCents, progressPercent,
                                    MIN/MAX_DONATION_CENTS, AmountCentsSchema (Zod)
apps/api/src/db/
  pool.ts                           + per-pool int8 / int8[] parser (safe integer or throw)
  database.ts                       Kysely instance + the hand-written Database types
  migrations/0001_initial.ts        the whole schema, up only
  migrate.ts                        runMigrations(db): Kysely Migrator, static provider
  seed/read-seed.ts                 pure: files → validated records (csv-parse, Zod, NFC)
  seed/seed.ts                      runSeed(db): accounts, campaigns, donors, donations, setval
apps/api/src/auth/password.ts       hashPassword / verifyPassword (scrypt)
apps/api/src/start.ts               migrate → seed → listen
apps/api/src/scripts/{migrate,seed}.ts   the npm run db:migrate / db:seed entry points
apps/api/Dockerfile                 + the seed folder in the runtime image
```

Libraries added: `kysely` (ADR 0001), `csv-parse`, `zod` in shared, and
`@testcontainers/postgresql` (dev).

## 2. Money (`packages/shared`)

- `MIN_DONATION_CENTS = 100`, `MAX_DONATION_CENTS = 2_500_000`.
- `AmountCentsSchema = z.number().int().min(MIN).max(MAX)`. It rejects `1.5`, strings and
  `null`.
- `parseDollarsToCents(input: unknown): number | null`:
  - It trims the input, then matches `^(\d{1,7})(?:\.(\d{1,2}))?$`.
  - The result is `dollars * 100 + cents` in integer maths. A one-digit fraction counts
    as tens of cents (`"51.5"` → 5150).
  - It rejects thousands separators, signs, exponents, a third decimal, and anything that
    isn't a string. Commas are rejected rather than guessed, because `1,000` means one
    thousand in en-US but one in many other locales.
  - Range is the schema's job, not the parser's.
- `formatCents(cents, locale = 'en-US')`, always in USD:
  - It builds the exact decimal string (`"43058.00"`) by slicing the digits, with no
    division.
  - It passes that string to `Intl.NumberFormat`, which formats numeric strings exactly
    (ES2023). Not even the display path divides by 100.
  - There's no `currency` parameter: cents assume two decimal places, and JPY or BHD would
    silently misformat. Every campaign is USD; a second currency would bring its own
    minor-unit rule.
- `progressPercent(raisedCents, goalCents)`:
  - `Math.floor((raised * 100) / goal)`, an integer. It returns 0 when the goal is not
    positive, so the result is never `NaN`.
  - It isn't capped: the page caps the bar, and the number can honestly read 115%.
- The dependency: shared gains `zod` as a runtime dependency. The API image must
  contain it (spec 001 forward note), and T6 checks this.

## 3. Data model — migration `0001_initial`

The DDL is tech spec 000 §4, unchanged in substance. It is written with Kysely's schema
builder plus `sql` fragments for `CHECK`s and extensions. The details that matter:

- **Extensions:** `citext` (case-insensitive email) and `pg_trgm` (search, used by spec
  005).
- **`campaigns`:**
  - `goal_cents bigint check (> 0)`;
  - `min_cents` / `max_cents bigint`, with `min_cents >= 100`, `max_cents <= 2500000` and
    `min_cents <= max_cents`;
  - `preset_cents bigint[] not null`;
  - `currency char(3)`, `starts_at` / `ends_at timestamptz` (nullable), `is_active`.
- **`donors`:**
  - `email citext unique`;
  - `full_name text`;
  - `password_hash text null`;
  - `role text check in ('donor','admin')`.
- **`donations`:**
  - all of 000 §4: `amount_cents bigint check between 100 and 2500000`, the status and
    privacy enums as `CHECK`s, `receipt_number unique`, `idempotency_key unique null`, the
    `source` column;
  - the four legacy-exempt checks for rows not from the import: message ≤ 280 code
    points (`char_length`), a dedication type and name both set or both null, an
    idempotency key, and `refunded` ⇔ `refunded_at`.
- **`refunds`:** `donation_id unique` and `actor_id`. **`sessions`:** `token_hash unique`.
  Both are created now so the schema is one reviewed migration, and used by spec 005.
- **Sequence:** `receipt_number_seq`.
- **Indexes,** each with a one-line comment in the migration:
  - `donations (campaign_id, status, created_at desc)`, for the public list and totals;
  - `donations (donor_id, created_at desc)`, for donor history;
  - GIN `gin_trgm_ops` on `donations.donor_name` and `donors (email::text)`, for admin
    search. The donor index is on the cast because citext has no `gin_trgm_ops`.
    Forward note, spec 005: admin search must filter on `email::text ILIKE …`, or the
    planner can't use it.
  - No extra index on `receipt_number`: its unique constraint already is one.
- **Timestamps:** `timestamptz`, with `default now()`. The seed sets `created_at` and
  `updated_at` from the CSV.
- **Migrations are up only.** A schema change is a new migration. That's a deliberate
  choice for a take-home: `down` functions that are never run are untested code.

## 4. Database access

- **`pg` int8 parser, per pool, not global:**
  - The pool's `types.getTypeParser` returns, for OID 20 (`int8`), a parser that does
    `Number(value)` and throws unless `Number.isSafeInteger`.
  - It does the same for OID 1016 (`int8[]`, e.g. `campaigns.preset_cents`), each element
    through the same check. pg-types returns `bigint[]` elements as strings, so a column
    typed `number[]` would silently arrive as `string[]` and a later `formatCents('1000')`
    or sum would break. The schema has no arrays containing NULL, so the array parser may
    reject them.
  - `numeric` (OID 1700) is deliberately left as a string. An uncast `SUM()` then surfaces
    as a type error in TypeScript and in a test, instead of silently becoming a float.
  - Per pool, rather than `pg.types.setTypeParser`, so nothing else in the process
    changes behaviour.
- **`Database` types:** hand-written in `database.ts`, next to the migration. The drift
  risk (000 §15) is covered only for queries that go through Kysely, run by the
  integration tests against the migrated schema. T2 adds a typed round-trip test (insert
  and select through `db` for campaigns, donors and donations, including `preset_cents`
  as `number[]` and the nullable and `Generated` columns); the T5 seed tests cover the
  rest.
- **Migrator:**
  - Kysely's `Migrator` with a **static provider** (`{ '0001_initial': m0001 }`), not
    `FileMigrationProvider`. It is the same import graph under `tsx`, Vitest and compiled
    `dist/`, with no filesystem globbing or `.ts`/`.js` extension guessing.
  - Kysely takes a Postgres advisory lock while migrating, so two API instances starting
    together can't both migrate.

## 5. Seed

`read-seed.ts` is pure: it takes file contents, never touches the database, and is
unit-tested.

- `campaigns.json` is parsed with a strict Zod schema.
- `donations.csv` is parsed with `csv-parse`:
  - RFC 4180, `columns: true`, with auto-detected line endings (CRLF and LF);
  - `bom: true`, `trim: false`.
- Each row is validated with Zod:
  - amounts through `parseDollarsToCents` (a row that fails stops the seed and names its
    receipt number);
  - enums checked, `created_at` parsed as ISO UTC.
- All text is NFC-normalised. Emails are NFC and lower-cased.

`runSeed(db)` runs in one transaction, in this order:

1. **Accounts first** (B3):
   - `INSERT … ON CONFLICT (email) DO NOTHING` for `admin@`, `donor@` and `other@`;
   - the scrypt hash is computed only when the account doesn't exist yet, so restarts stay
     fast.
2. **Campaigns:** `INSERT … ON CONFLICT (slug) DO NOTHING`.
3. **Donors:** one per distinct lower-cased email. The first row by `created_at` sets the
   `full_name` (B1). `ON CONFLICT (email) DO NOTHING`, so an account keeps its role and
   password.
4. **Donations:**
   - `source = 'import'`, `refunded_at = null` (B2), with no charge id and no key;
   - `ON CONFLICT (receipt_number) DO NOTHING`.
5. **The sequence:** `setval('receipt_number_seq', max(seeded number))`, so spec 004's
   first receipt is `…000076`. Never lower: it takes `greatest()` with the current value.

**Idempotency and concurrency.** Natural keys plus `ON CONFLICT DO NOTHING` make a re-run
a no-op, and two seeds racing simply both no-op on the loser's rows. The seed never
updates, so donations written by the app survive restarts (B4). No transaction-level
locking is needed beyond the unique constraints.

## 6. Passwords (`apps/api/src/auth/password.ts`)

- **Algorithm:** `scrypt` from `node:crypto`, N = 2^17, r = 8, p = 1, a 16-byte random salt
  and a 32-byte key (ADR 0004). `maxmem` is raised to 256 MiB, because N = 2^17 needs
  128 MiB and Node's default limit is 32 MiB.
- **Stored format:** `scrypt$N$r$p$saltB64$keyB64`, so the parameters can change later
  without breaking old hashes.
- **Verify:** `verifyPassword(password, stored)` reads N, r and p from the stored value and
  compares with `timingSafeEqual`. It returns false, never throws, on a malformed hash:
  - The key length is fixed at 32 bytes; any other length is false. The format carries no
    key length and scrypt output is prefix-consistent, so a truncated stored key would
    verify against its own first bytes and weaken the check.
  - Salt and key are decoded with a strict base64 round-trip, because Node's decoder
    silently skips junk.
  - Parameters scrypt refuses (N not a power of two, or above `maxmem`, e.g. N = 2^30) are
    caught and give false. That is the only bound on a hostile stored value; r and p have
    no separate cap. The value comes from our own database, so this is defence in depth,
    not a trust boundary. A very large p within `maxmem` could still be slow: accepted.
- **Normalisation:** the password is NFC-normalised on hash and on verify.
- **Scope:** the dummy-hash comparison for unknown emails belongs to the login flow in
  spec 005.

## 7. Start-up, scripts and Docker

- **`start.ts`:**
  - `loadConfig` → `runMigrations` → `runSeed` → `listen`.
  - A failure in either step logs `{ step: 'migrate' | 'seed' }` and exits 1.
  - Health stays unreachable until then, so `compose up --wait` can only succeed on a
    fully seeded database.
- **Root scripts:** `db:migrate` / `db:seed` call
  `npm run db:migrate|db:seed -w apps/api`, which runs `tsx src/scripts/*.ts` with the
  root `.env`. The entry points just call the same functions as `start.ts`.
- **Seed files in Docker:**
  - The seed files are read from `SEED_DIR`, default `roles/full-stack-engineer/seed`
    resolved from the repo root.
  - The runtime image copies that folder to the same relative path, so the files are the
    unmodified originals, as reviewers can check.
- **CI `stack` job:** adds `docker compose exec -T db psql …` to assert 75 donations and the
  4,305,800-cent total.
- **CI `check` job:** Testcontainers needs Docker, which `ubuntu-latest` has.

## 8. Errors, validation, authorisation

- **Validation:** Zod at the seed boundary (both files) and the amount schema in shared.
  The database constraints are the last line, and the tests prove they hold on their own.
- **Errors:**
  - A bad seed row fails the whole seed transaction, naming the receipt number, never the
    row's content (it has PII).
  - A migration error aborts start-up.
  - No HTTP surface changes.
- **Authorisation:** not applicable; no endpoint touches this data yet.

## 9. Test plan

| Test | Type | Proves |
|---|---|---|
| `packages/shared/test/money.test.ts` | Unit | **M8 money:** the boundaries 0.99 / 1.00 / 25,000.00 / 25,000.01; negative, string, `null`, `1.5`, `"1e9"`, `"1,000.00"`, `" 51 "`, `"51.5"`; `formatCents(4305800)` = `$43,058.00` and `formatCents(100)` = `$1.00`; `progressPercent` with 0, partial and over-goal |
| `apps/api/test/password.test.ts` | Unit | Hash then verify is true; a wrong password is false; two hashes of one password differ (salt). Parameters are read from the stored value: a hand-built cheap hash with non-default r/p verifies, and a key derived with other parameters than claimed is false. NFC and NFD forms of one password are equal. About 26 malformed variants, including a wrong key length, are false, not a throw. N = 2^30 is false in under 2 s |
| `apps/api/test/read-seed.test.ts` | Unit, on the real files | 3 campaigns and 75 rows. Row 1's name is byte for byte `Shrestha, Bijay "BJ"`. Row 2's Devanagari is in NFC. Amounts are integers and row 3 is 2,500,000. The same CSV with LF and with CRLF gives identical records. A row with `"12.345"` fails naming its receipt number |
| `apps/api/test/db/migration.test.ts` | Integration (Testcontainers `postgres:16-alpine`) | Raw inserts are rejected: amount 99 and 2,500,001, a duplicate receipt, an unknown status, a non-import message of 281 code points, a non-import dedication type without a name, an unknown campaign, an email differing only in case. 280 emoji is accepted (code points, A12). `int8` comes back as a `number`; an unsafe one throws. `int8[]` comes back as `number[]`; an unsafe element throws. A typed round-trip through `db` (campaigns, donors, donations: `preset_cents`, nullable and `Generated` columns) matches the `Database` types. `receipt_number_seq` exists, checked in `pg_sequences` without `nextval`, so T5 still sees 76 |
| `apps/api/test/db/seed.test.ts` | Integration | Counts 75 / 66-7-2 / 48-15-12. Aangan `SUM(amount_cents)::bigint` = the number 4305800. Rows 11 and 12 belong to one donor. 3 accounts with roles and verifiable passwords; everyone else's hash is null. A second `runSeed` changes no row count and no hash. A donation inserted between runs survives. The next sequence value is 76 |

Vitest runs two projects:

- **`unit`** (`test/*.test.ts`): no Docker. `vitest run --project unit` runs it alone.
- **`integration`** (`test/db/**`): owns the container. It shares **one** per run: its
  `globalSetup` starts it, migrates, and passes the URL with `provide`.
  - Each file truncates the tables it writes. It runs with `fileParallelism: false`:
    TRUNCATE takes an ACCESS EXCLUSIVE lock, so parallel files on shared tables would wipe
    each other's rows or deadlock.
  - A cold run adds the image pull plus about 3 s.

## 10. Alternatives considered

| Chosen | Rejected | Why |
|---|---|---|
| Static migration provider | Kysely `FileMigrationProvider` | The same imports under tsx, Vitest and `dist/`; no globbing or extension guessing |
| Migrate and seed inside `start.ts` | A separate one-shot `migrate` compose service | One service fewer. Kysely's advisory lock already makes concurrent starts safe |
| Up-only migrations | `up` + `down` | A `down` that is never run is untested code; a fix is a new migration |
| Per-pool int8 parser | `pg.types.setTypeParser` (global) | Doesn't change behaviour for anything else that uses `pg` in the process |
| Leave `numeric` as a string | Parse `numeric` to a number | An uncast `SUM()` then fails loudly instead of quietly becoming a float |
| Seed: `ON CONFLICT DO NOTHING` by natural key | Truncate and reload, or upsert | Never destroys or overwrites data the app wrote |
| Seed on every start | Seed only when tables are empty | The same result, but a row-by-row no-op also repairs a partial seed |
| `Intl.NumberFormat` on an exact decimal string | `cents / 100` | No float, even at the display edge |
| Reject `"1,000.00"` | Strip commas | Locale-ambiguous; a donor typing it gets a clear error |
| Testcontainers | The compose `db` | Tests don't depend on a running dev database or its state |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Testcontainers on Windows / Docker Desktop (Ryuk, named pipes) | Resolved in T2: the container starts and stops cleanly on Windows with Ryuk enabled, in about 4 s warm. No fallback needed |
| `npm test` now needs Docker | `CLAUDE.md` already says so; the README says it in spec 006. Unit tests stay runnable alone through the project split: `vitest run --project unit` (§9) |
| The pool's `query_timeout: 5000` also applies to migrations, because `start.ts` reuses the pool. A slow migration (backfill, index build) or an instance waiting on the advisory lock could be aborted client-side | Not needed for 0001 on an empty database. T5 gives `start.ts` its own pool for migrate + seed with a longer `query_timeout`, or revisits the decision then |
| scrypt N=2^17 is slow per hash (~0.3 s) | Only on the first seed (3 hashes). Tests use the same parameters, because a weaker test hash would test a different thing |
| CRLF working copies on Windows | csv-parse auto-detects line endings; a test feeds both |
| Shared's new runtime dependency (`zod`) missing from the API image | T6 checks `node -e "import('@aangan/shared')"` inside the built image |
| Hand-written Kysely types drift from the migration | Holds only for queries through Kysely: the T2 typed round-trip test, then the T5 seed tests, run them against the migrated schema (§4) |
