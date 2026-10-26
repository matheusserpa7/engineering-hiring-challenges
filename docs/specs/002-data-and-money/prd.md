# PRD 002 — Data and money: schema, migrations, seed, shared money helpers

Status: draft, awaiting approval · Parent: [000 overview](../000-overview/prd.md) ·
Depends on: [001 foundation](../001-foundation/prd.md)

## Problem and context

Every later spec reads or writes donations, and two of the automatic deductions in the
rubric come from this layer: money stored or calculated as a float (−8), and a seed that
breaks on an awkward row. The seed data is built to catch bugs on purpose. Its traps
include:

- a name with a comma *and* quotes
- Devanagari text
- the exact minimum and maximum amounts
- refunded and failed rows that must not count
- one email in two capitalisations
- a 283-character message where 280 is documented
- dollar strings that must become cents exactly once

If the data layer is wrong, every number the page shows is wrong, and no endpoint can fix
it. So the schema, the constraints and the money conversion come first, before any endpoint
exists, and they are proven by tests against a real Postgres.

## Goals

1. A migration, checked in, creates the whole schema from tech spec 000 §4: tables,
   `CHECK` / `NOT NULL` / foreign-key / `UNIQUE` constraints, indexes with a one-line reason
   each, and the receipt-number sequence. It runs automatically when the API starts, and
   with `npm run db:migrate`.
2. A seed loads `campaigns.json`, all 75 rows of `donations.csv` and the three login
   accounts. It is idempotent: running it again changes nothing. It runs automatically on
   start, and with `npm run db:seed`.
3. `packages/shared` holds the money helpers and the amount schema, so the CSV import and
   (from spec 004) the donation form both parse dollars the same way.
4. Money never touches a float: `bigint` columns, a `pg` type parser that returns safe
   integers or fails loudly, `SUM` cast to `bigint`, and dollar strings parsed by a regex,
   never by `parseFloat`.
5. `cp .env.example .env && docker compose up --build` ends with the seeded data in place,
   with no extra step.

## Non-goals

- Any HTTP endpoint that reads or writes this data: specs 003–005. In this spec, nothing
  outside the database can see the data yet.
- The privacy projection (`displayName`) and the donor count: spec 003. This spec only
  makes their inputs correct.
- Generating receipt numbers for new donations: spec 004. Here, only the sequence and its
  starting value.
- Login, sessions and refunds: spec 005. Here, only the password-hashing function the seed
  needs for the three accounts.
- DTO types and request schemas for endpoints: they arrive with their endpoints in 003–005.
  Shipping them now would be code with no caller.
- Audit rows for the seeded refunds. The CSV has no actor, time or reason for them.

## User stories and acceptance criteria

**US-1 — Reviewer gets seeded data from one command**
- **Given** a fresh clone, **when** `cp .env.example .env && docker compose up --build
  --wait` runs, **then** the API is healthy only after migrations and the seed have
  finished, and the database holds 3 campaigns and 75 donations.
- **Given** the stack is restarted, or `npm run db:seed` runs again, **then** nothing
  is duplicated: still 75 donations, 3 campaigns, the same donors.
- **Given** a migration or the seed fails, **then** the API process exits with a non-zero
  code and a log line that names the step. It never reports healthy with a half-built
  database.

**US-2 — The seed survives every trap**
- **Given** the seed has run, **then**:
  - **status:** 66 `completed`, 7 `refunded`, 2 `failed`;
  - **privacy mode:** 48 `public`, 15 `anonymous`, 12 `family`;
  - **total:** completed donations for `aangan-courtyard` sum to exactly 4,305,800
    cents, read back as the number `4305800`, not a string or a float.
- **Given** row `000001`, **then** the donor name is stored byte for byte as
  `Shrestha, Bijay "BJ"`.
- **Given** row `000002`, **then** the name `अनिशा गुरुङ`, the dedication `बुबा` and the
  message `सधैं सम्झनामा।` are stored in NFC and read back unchanged.
- **Given** rows `000011` and `000012`, **then** they belong to one donor (emails are
  case-insensitive, A4).
- **Given** row `000014` (283 characters) and row `000071` (a dedication type without a
  name), **then** they are imported as legacy data (`source = 'import'`, A1). A new row
  breaking the same rules is rejected by the database.
- **Given** the seed file was checked out with CRLF line endings (Windows), **then** the
  result is identical to LF.

**US-3 — The database refuses bad data on its own**
- **Given** an insert bypassing the application, **then** Postgres rejects:
  - an amount of 99 or 2,500,001 cents;
  - a duplicate receipt number, or a duplicate idempotency key;
  - an unknown status or privacy mode;
  - for a non-import row, a message over 280 characters, or a dedication type without a
    name;
  - a donation pointing at a campaign or donor that doesn't exist.
- **Given** two donors whose emails differ only in case, **then** the second insert fails
  on the unique email.

**US-4 — Money helpers are exact (M8 money test)**
- **Given** the shared amount schema, **then** it accepts 100 and 2,500,000 cents. It
  rejects 99, 2,500,001, −100, `1.5`, `"100"` and `null`.
- **Given** `parseDollarsToCents`, **then**:
  - `"0.99"` → 99, `"1.00"` → 100, `"25000.00"` → 2,500,000, `"25000.01"` → 2,500,001.
    Range checks are the schema's job.
  - `" 51 "` → 5,100, because it trims.
  - `"abc"`, `""`, `"-1"`, `"1e9"`, `"1,000.00"`, `"1.234"` and `null` → rejected.
- **Given** `formatCents(4305800)`, **then** it gives `$43,058.00` with no float in the
  path.
- **Given** `progressPercent`, **then** a goal with nothing raised gives 0, never `NaN`,
  and over-goal values are not capped (the page caps the bar).

**US-5 — Seeded accounts can log in later**
- **Given** the seed, **then** `admin@`, `donor@` and `other@himalayacc.example` exist:
  - their roles are admin, donor and donor;
  - their passwords are stored as scrypt hashes, never in plain text;
  - every other donor is a guest, with a null password hash.
- **Given** the seed is re-run, **then** the accounts are unchanged and no password is
  re-hashed over an existing one.

## Traceability

| Item | Where |
|---|---|
| M1 shared package is real (money imported by the importer now, the web app from 003) | US-4 · T1 |
| M1 root scripts `db:migrate`, `db:seed` | US-1 · T2, T5 |
| M2 migrations, DB constraints, 75 rows, indexes with reasons | US-1, US-2, US-3 · T2, T5 |
| M6 / M8 money as integer cents, boundary tests | US-2, US-4 · T1, T2 |
| M7 migrations and seed run automatically in Docker | US-1 · T5, T6 |
| DATA-MODEL rules 1–4 and 6 | US-2, US-3 · T2 |
| Rubric cat. 3, correctness under awkward input | US-2 · T4, T5 |
| Rubric cat. 4, money as integer cents, correct arithmetic | US-2, US-4 · T1, T2 |
| `docs/04` §1: seed passwords are fixtures, not secrets | US-5 · T3 |

## Assumptions

Inherited from PRD 000: A1 (legacy import exemption), A4 (case-insensitive email), A12
(length in code points). New in this spec:

- **B1:** The first CSV row for an email (by `created_at`) sets the donor's `full_name`.
  Each donation keeps its own `donor_name` snapshot (tech spec 000 §4).
- **B2:** Seeded refunds keep `refunded_at` null and get no `refunds` audit row. The CSV
  carries no timestamp, actor or reason, and inventing them would be fake history. The
  status alone already removes them from every aggregate.
- **B3:** The seed's three passwords are the fixtures from `SETUP.md`, hard-coded in the
  seed and listed in the README. `docs/04` §1 allows exactly this.
- **B4:** The seed runs on every API start, and is idempotent by natural key: campaigns by
  `slug`, donors by `email`, donations by `receipt_number`. It never updates an existing
  row, so data written by the app survives a restart.

## Open questions

None blocking. Q1–Q3 in PRD 000 (rows 14 and 71, closed-campaign gifts) still apply to the
import, through A1.
