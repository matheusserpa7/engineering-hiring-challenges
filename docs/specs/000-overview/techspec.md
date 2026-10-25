# Tech Spec 000 — Architecture and cross-cutting decisions

Status: draft, awaiting approval · Implements [`prd.md`](prd.md) · Key decisions are
recorded as ADRs in [`docs/adr/`](../../adr/).

## 1. Approach

A boring three-service stack: **Postgres 16**, a **Node 24 + Express 5 API**, and a **Vue 3
SPA served by nginx**. nginx also reverse-proxies `/api` to the API, so the browser talks to
one origin. This mirrors production, where the front end reaches the backend through a
server-side proxy. Business rules live in the API's service and repository modules. The
shared package holds the contract (types, Zod schemas, money), so a contract change breaks
both builds.

| Layer | Choice | Why (one sentence) |
|---|---|---|
| Runtime | Node 24 LTS, TypeScript `strict` | The target in `docs/08`; strict, or don't claim types. |
| Workspaces | npm workspaces | Ships with Node; one lockfile, `npm ci` in Docker, nothing extra to install. |
| API | Express 5 | The framework I know best. Express 5 forwards async errors natively, which closes the old gap with Fastify. |
| Validation | Zod 4, in `packages/shared` | One schema validates on the server, gives the form its client-side check, and generates the TS types. |
| DB access | Kysely + `pg` | Typed and parameterised, but still reads as SQL, so `FOR UPDATE`, `ON CONFLICT` and conditional updates stay visible. Ships its own migrator. |
| DB | Postgres 16 | Real transactions, `citext`, `pg_trgm`, constraints. The problem is about concurrency. |
| Front end | Vue 3 + Vite + vue-router | My strongest framework. The UI is a small SPA with no SSR need. Auto-escaping templates. |
| Password hashing | `node:crypto` scrypt | OWASP-approved, built in, and no native module to break on arm64 vs amd64. |
| Logging | pino + pino-http | Structured logs with header redaction, without writing a logger. |
| Security middleware | helmet, cors, express-rate-limit | One line each for headers, a named origin and 429 with `Retry-After`. |
| CSV import | csv-parse | RFC 4180 done right. A hand-rolled `split(',')` is exactly the trap in the seed. |
| Tests | Vitest, Supertest, Testcontainers, Playwright | Unit, HTTP-level integration against a real Postgres, and one e2e path. |

## 2. Repository layout

The project lives at the **root of the fork**, so `docker compose up --build` runs from the
root. The challenge's own files stay where they are. The seed is read from
`roles/full-stack-engineer/seed/`, so every reviewer can see it is the unmodified data.

```
package.json            workspaces + root scripts (dev build test lint typecheck db:migrate db:seed)
.nvmrc .gitattributes .editorconfig eslint.config.js .prettierrc
docker-compose.yml  .env.example  .dockerignore
apps/api/               Express API — src/{http,services,repositories,db,payments,config}
apps/web/               Vue SPA + nginx.conf
packages/shared/        money, Zod schemas, DTO types, error codes
e2e/                    Playwright (runs against the compose stack)
docs/specs/ docs/adr/   this process
CLAUDE.md  .claude/     agent conventions (spec 001)
```

API layering, one direction only: `http` (routes, parse with Zod, map errors) → `services`
(business rules, transactions) → `repositories` (SQL only). Route handlers contain no
business rules, and repositories contain no HTTP.

## 3. Money

- Integer cents everywhere: `bigint` columns, `number` in TS, `amountCents` in the API.
  `Number.isSafeInteger` is checked at every boundary. Cents comfortably fit in 2^53.
- `pg` returns `int8` as a string. We register a type parser that converts to `number` and
  throws if the value is not a safe integer. **`SUM(bigint)` returns `numeric`**, so
  aggregates are cast `::bigint` in SQL. This exact trap is covered by an integration test.
- `packages/shared/money.ts`: `parseDollarsToCents(input: string)` (strict regex, no
  `parseFloat`, used by the CSV import and the custom-amount input), `formatCents(cents,
  locale)` via `Intl.NumberFormat` (display edge only), and `progressPercent(raised, goal)`
  (integer maths, 0 for an empty campaign, never `NaN`).
- An ESLint `no-restricted-properties`/`no-restricted-globals` rule bans `parseFloat` and
  `toFixed` in `apps/` and `packages/`.

## 4. Data model (first migration, spec 002)

```sql
create extension citext; create extension pg_trgm;

campaigns(id uuid pk, slug text unique not null, title text not null, story text,
  goal_cents bigint not null check (goal_cents > 0), currency char(3) not null default 'USD',
  min_cents bigint not null, max_cents bigint not null, preset_cents bigint[] not null,
  starts_at timestamptz, ends_at timestamptz, is_active boolean not null default true,
  created_at, updated_at timestamptz not null default now(),
  check (min_cents >= 100 and max_cents <= 2500000 and min_cents <= max_cents))

donors(id uuid pk, email citext unique not null, full_name text not null,
  password_hash text null, role text not null default 'donor' check (role in ('donor','admin')),
  created_at timestamptz not null default now())

donations(id uuid pk, campaign_id uuid not null fk, donor_id uuid not null fk,
  donor_name text not null,               -- snapshot at donation time, see below
  amount_cents bigint not null check (amount_cents between 100 and 2500000),
  currency char(3) not null,
  status text not null check (status in ('pending','completed','failed','refunded')),
  privacy_mode text not null default 'public' check (privacy_mode in ('public','anonymous','family')),
  dedication_type text null check (dedication_type in ('in_honor_of','in_memory_of')),
  dedication_name text null, message text null,
  is_recurring boolean not null default false,
  receipt_number text unique not null,
  idempotency_key text unique null, request_hash text null,
  payment_charge_id text null, payment_last4 char(4) null, failure_code text null,
  source text not null default 'web' check (source in ('web','import')),
  created_at, updated_at timestamptz not null default now(), refunded_at timestamptz null,
  check (source = 'import' or char_length(message) <= 280),                         -- A1, A12
  check (source = 'import' or (dedication_type is null) = (dedication_name is null)), -- A1
  check (source = 'import' or idempotency_key is not null),
  check (source = 'import' or (status = 'refunded') = (refunded_at is not null)))
  -- the CSV has no refund timestamps; imported refunds keep refunded_at null rather than an invented date

refunds(id uuid pk, donation_id uuid not null unique fk, actor_id uuid not null fk donors,
  reason text not null, amount_cents bigint not null, created_at timestamptz not null default now())

sessions(id uuid pk, token_hash text unique not null, donor_id uuid not null fk,
  expires_at timestamptz not null, created_at timestamptz not null default now())

create sequence receipt_number_seq;
```

Decisions inside the model:
- **`raised_cents` is not stored.** Totals are derived with
  `SUM(amount_cents)::bigint ... WHERE status = 'completed'` on an index, so a refund
  "updates every aggregate" by construction and nothing can drift.
- **`donor_name` is snapshotted on the donation.** Guest checkout cannot verify email
  ownership. If a new donation could overwrite `donors.full_name`, anyone could rename
  another donor's past public gifts. The donor upsert never overwrites the stored name.
- **`source = 'import'` is the legacy-data exemption (A1).** Seed rows that break a rule for
  new donations are allowed explicitly and visibly. New rows get the full constraints.
- **`refunds.donation_id` is unique.** A second audit row for the same refund is impossible
  even if application logic fails.
- **Never hard-delete** donations or refunds. Sessions are credentials, not business records,
  so logout deletes the row.

Indexes, each commented in the migration: `donations(campaign_id, status, created_at desc)`
(public list and totals) · `donations(donor_id, created_at desc)` (donor history) ·
GIN `gin_trgm_ops` on `donations.donor_name` and `donors.email` (admin search). No extra
index on `receipt_number`, because its unique constraint already creates one.

**Receipt numbers:** `HCC-{year in ORG_TIMEZONE}-{nextval, zero-padded to 6}`. The seed
calls `setval` past the highest seeded number. Sequential numbers are enumerable and leak
volume. We accept that because receipts are never a lookup key on a public endpoint (there
is no public `GET /donations/receipt/:n`). Gaps from failed inserts are fine: receipts are
unique, not gapless.

**Unicode:** every text input is normalised to NFC in the Zod schemas (and in the importer)
before it is written. Emails are lower-cased and NFC-normalised. Message length is counted
in code points (A12).

## 5. API contract

Base `/api`. JSON in and out. Amounts are integer cents. Every error uses one shape:
`{ "error": { "code", "message", "details"? } }`. No stack, SQL or path ever leaves the
server: the error middleware logs the detail with the request id and returns a code.

| Method & path | Auth | Success | Errors |
|---|---|---|---|
| `GET /health` | — | 200 `{status:"ok"}` (DB ping) | 503 |
| `GET /campaigns/:slug` | — | 200 campaign + `raisedCents`, `donorCount`, `presetCents`, `minCents`, `maxCents`, `isActive` | 404 |
| `GET /campaigns/:slug/donations?limit=` | — | 200 `{data: PublicDonation[]}` | 404, 422 |
| `POST /donations` (header `Idempotency-Key`) | — | 201 completed · 202 pending | 400, 402, 404, 409, 422, 429, 502 |
| `POST /auth/login` | — | 200 `{user}` + cookie | 401, 422, 429 |
| `POST /auth/logout` · `GET /auth/me` | session | 204 · 200 | 401 |
| `GET /me/donations` | session | 200 own donations | 401 |
| `GET /donations/:id` | session, owner or admin | 200 | 401, 404 |
| `GET /admin/donations?q=&status=&sort=&dir=` | admin | 200 pagination envelope | 401, 403, 422 |
| `POST /admin/donations/:id/refund` `{reason}` | admin | 200 refunded donation | 401, 403, 404, 409, 422 |

`PublicDonation` is a dedicated DTO built from a dedicated query (§7):
`{ id, displayName, amountCents, dedication: {type,name} | null, message: string | null, createdAt }`.

Deviation from the suggested contract, to be documented in the README: `message` is a
top-level request field rather than inside `dedication`, because the seed has messages
without a dedication (row 4) and the response already keeps them separate.

Status-code rules: 400 for malformed JSON or a missing `Idempotency-Key` · 422 for schema
or business-rule failures (`validation_failed`, `campaign_closed`, `amount_out_of_range`,
`idempotency_key_mismatch`) · 402 `card_declined`/`insufficient_funds` · 409
`request_in_progress` / `already_refunded` · 502 `payment_provider_error` · 404 for
missing **or not yours**.

## 6. Donation intake — idempotency and provider failure modes (ADR 003)

`Idempotency-Key` is **required**. The web client generates a UUID per checkout attempt and
reuses it on retries and double clicks. A key is optional in Stripe's API, but here
"exactly once per payment" is non-negotiable (rule 7), so an optional key would make the
guarantee optional.

1. Validate the body with the strict Zod schema (unknown keys → 422). Load the campaign:
   active, inside its dates, `min ≤ amount ≤ max` (else 422). The amount charged is the
   validated `amountCents` checked against the campaign's rules. Nothing else from the
   client is trusted.
2. **Claim the key with one statement, inside a transaction with the donor upsert:**
   `INSERT INTO donations (... status 'pending', idempotency_key, request_hash) ON CONFLICT
   (idempotency_key) DO NOTHING RETURNING id`. The unique constraint arbitrates between
   concurrent requests. There is no read-then-write, so there is no race.
3. If nothing was returned, the key already exists. Read that row:
   - different `request_hash` → 422 `idempotency_key_mismatch`
   - `pending` with no outcome yet → 409 `request_in_progress`
   - `completed` / `failed` / timed-out `pending` → **replay the original response**
     (201 / 402 / 202) with the same receipt number
4. Only the request that inserted the row calls the provider, with
   `idempotencyKey = donation.id`, raced against `PAYMENT_TIMEOUT_MS`.
   - success → `UPDATE ... SET status='completed', charge id, last4 WHERE id=$1 AND
     status='pending'` → 201
   - decline → `status='failed', failure_code` → 402
   - `provider_error` (`tok_flaky`) → **one** retry with the same idempotency key (safe for
     exactly that reason); if it fails again → `failed` → 502
   - timeout → the row stays `pending` with `failure_code='provider_timeout'` (which is what
     distinguishes it from "in progress" on replay) → 202: "We're confirming your
     payment; your reference is HCC-…; you will not be charged twice."
5. The confirmation is logged (email is out of scope).

Why a pending row before the charge: if the API dies mid-charge, the row still records that
a charge may exist. "A donor charged with no record" is the failure the brief says matters.
Rejected: 504 with no row, which leaves exactly that gap. The mock has no status-lookup API,
so reconciliation of `pending` rows is documented and left to the admin view rather than
built. That goes in Known issues.

## 7. Privacy and authorisation in the query (ADR 005)

- **The public projection is its own SQL query.** It never selects `email`, `donor_id` or
  `donor_name` as such. It selects:
  `CASE privacy_mode WHEN 'public' THEN donor_name WHEN 'family' THEN 'The ' ||
  substring(donor_name from '([^[:space:]]+)$') || ' family' ELSE 'Anonymous' END AS
  display_name`, plus the dedication and message nulled for anonymous rows (A3). The PII
  never leaves the database, so no serialiser change can leak it.
- **A viewer-scoped repository.** The session middleware resolves `viewer = {id, role}`.
  `findDonationForViewer(id, viewer)` and `listDonationsForViewer(viewer, filters)` put
  `AND (donor_id = :viewerId OR :isAdmin)` in the `WHERE`. A row that is not yours is
  indistinguishable from a missing one, so the API returns 404.
- Route guards: `requireSession` (401) and `requireRole('admin')` (403) on `/admin/*`.
  Role comes from the database via the session, never from the request.
- **Admin search:** `q` is NFC-normalised, LIKE wildcards (`% _ \`) are escaped, and the
  value is bound as a parameter: `donor_name ILIKE $1 OR email ILIKE $1`, served by the
  trigram indexes. This works for Devanagari, which has no case, so case folding is
  irrelevant for it.
- `sort`/`dir` are Zod enums mapped through a fixed object to Kysely column references.
  Nothing from the request is interpolated. Order always ends with `id desc` to stay
  deterministic. The response uses the pagination envelope from day one. `page`/`pageSize`
  belong to S0.

## 8. Refunds (spec 005)

One transaction: `UPDATE donations SET status='refunded', refunded_at=now() WHERE id=$1 AND
status='completed' RETURNING *`. With zero rows, re-read to choose between 404 (missing)
and 409 (`already_refunded`, or not refundable). Then `INSERT INTO refunds`. The
conditional update takes the row lock, so 20 concurrent refunds serialise and exactly one
matches `status='completed'`. `refunds.donation_id unique` backs this up in the database.
Totals are derived, so the next read is correct without touching any aggregate. The mock
provider has no refund call, so this is a state change only (documented).

## 9. Sessions, CSRF, headers (ADR 004)

- Login: Zod-validated. scrypt (N=2^17, r=8, p=1, 16-byte salt, `timingSafeEqual`). An
  unknown email is verified against a fixed dummy hash, so the timing is comparable, and
  the 401 `invalid_credentials` is identical.
- Session token: 32 random bytes (base64url) in an `HttpOnly; Secure; SameSite=Strict;
  Path=/` cookie. Only its SHA-256 is stored. A fast hash is fine for a 256-bit random
  value, and a stolen table is not a set of live sessions. TTL is `SESSION_TTL_HOURS`,
  checked in the lookup query. Logout deletes the row. **No `SESSION_SECRET`:** opaque
  tokens are validated against the database, so there is nothing to sign. The example env
  in `SETUP.md` lists one, and we explain the deviation.
- CSRF: `SameSite=Strict`, JSON-only bodies (`express.json` rejects form encodings), and an
  `Origin` allow-list check on unsafe methods. The allow-list is needed because
  `localhost:3000` and `localhost:4000` count as the *same site*.
- CORS names exactly `CORS_ORIGIN`, with credentials. Browser traffic is same-origin
  through nginx anyway, so this mainly makes any future cross-origin client fail closed.
- helmet on the API (`default-src 'none'`). nginx sets the SPA's CSP: `default-src 'self';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Vite emits no inline script.
  Vue templates escape output, and `v-html` is banned by lint (`vue/no-v-html`).
- Rate limits (in-memory store, single instance, documented): login per IP + email,
  donation intake per IP, both 429 with `Retry-After`. The limits come from env so tests can
  raise them.

## 10. Configuration and "today"

`apps/api/src/config.ts` parses `process.env` with Zod at boot and fails fast with a clear
message. It is the one place for `ORG_TIMEZONE=America/Chicago`, which is used for the
receipt-number year. Timestamps are `timestamptz`, stored in UTC, and formatted in the
browser.

## 11. Docker (M7)

- `db`: `postgres:16-alpine`, named volume, `pg_isready` healthcheck, published only on
  `127.0.0.1:5433` (for the local dev path; this avoids clashing with a reviewer's own
  Postgres).
- `api`: multi-stage (deps → build → runtime `node:24-alpine`, prod deps only, `USER node`),
  `HEALTHCHECK` on `/health`, `depends_on: db: service_healthy`. Entrypoint
  `node dist/start.js` runs migrate, then seed (idempotent), then listen. It is a JS
  entrypoint rather than a shell script, so CRLF line endings cannot break it.
- `web`: multi-stage (Vite build → `nginxinc/nginx-unprivileged` pinned alpine tag, non-root),
  SPA fallback, `/api` proxied to `http://api:4000`, healthcheck, `depends_on: api:
  service_healthy`. The browser uses relative `/api`, so **no build-time API URL** is baked
  into the bundle.
- `.dockerignore`: `node_modules .git dist coverage .env playwright-report test-results
  roles/qa-engineer`. The seed folder is included deliberately.
- `.gitattributes`: `* text=auto eol=lf`. This Windows machine has `core.autocrlf=true`.

## 12. Test plan

| Layer | Tool | What it proves |
|---|---|---|
| Unit — shared | Vitest | Money: $0.99 / $1.00 / $25,000.00 / $25,000.01, negatives, `"abc"`, `null`, `1.5`, `1e9`, `"1,000.00"`, `" 51 "`. Formatting. `progressPercent` with 0 and over-goal. Schema rejects unknown keys and bad enums. Message limit counts code points (emoji at 280 vs 281). |
| Integration — API | Vitest + Supertest + Testcontainers `postgres:16-alpine` (one container per run, migrated once, tables truncated per test) | **Seed:** 75 rows, 66/7/2, 48/15/12, Aangan 4,305,800 cents and 46 donors, comma-quote name and Devanagari round-trip byte-identical. Re-running the seed is a no-op. **Privacy:** the serialised public JSON for anonymous rows contains neither the donor's name nor their email (string search over the raw body), keys are absent, family → "The Gurung family". **Totals:** the empty campaign gives 0. **Donations:** boundaries over HTTP, unknown field 422, decline 402 with no completed row, timeout 202 pending with a short `PAYMENT_TIMEOUT_MS`, flaky retried once, closed campaign 422. **Concurrency/idempotency:** 20 parallel identical requests with one key → 1 row and 1 provider call; same key with a different body → 422; replay returns the same receipt. **Authz:** donor→other's donation 404, donor→admin route 403, no session 401, `/me/donations` returns exactly 3. **Auth:** identical failure bodies, cookie flags, expired session 401, 429 after the limit. **Refund:** total, donor count and public list move together; audit row written; second refund 409; 20 concurrent refunds → exactly 1 succeeds and 1 audit row. |
| E2E | Playwright against `docker compose up` (Chromium + WebKit) | Land → donate with `tok_ok` → see it in the list and the total move. The seeded XSS payloads render as text, and a `dialog` listener fails the test if a script runs. Admin login → refund → total corrects. WebKit covers the `Secure`-cookie-on-localhost risk. |

The provider is injected behind a `PaymentProvider` interface. Tests use the real mock
module wrapped in a call-counting spy, so they never assert the mock against itself.

## 13. CI (GitHub Actions, spec 001 then grows)

`check` job: Node 24, `npm ci`, `lint`, `typecheck`, `test` (Testcontainers works on
`ubuntu-latest`). `stack` job: `cp .env.example .env`, `docker compose up --build --wait`
(blocks on healthchecks), a `curl` smoke test (`/health`; `raisedCents == 4305800`; no
email in the public list), Playwright e2e, `docker compose logs` on failure, then `down -v`.

## 14. Alternatives considered

| Choice | Rejected alternative | Why rejected |
|---|---|---|
| Vue 3 SPA | Next.js (the client's stack) | The brief calls matching it "a small advantage, not worth learning a framework for". I'm fastest in Vue, and there is no SSR need. Noted honestly in the README. |
| Express 5 | Fastify | Its main win is JSON-Schema validation, but our schemas are Zod shared with the client. Familiarity matters more on a clock. |
| Kysely | Prisma / Drizzle / raw `pg` | Prisma hides locking and ships an engine binary. Raw `pg` loses types and needs a migration tool anyway. Drizzle would be fine; Kysely's SQL shape is easier to defend line by line. |
| Postgres | SQLite | Concurrency is the hard part, and Postgres gives us constraints and row locks. |
| Derived totals | Denormalised `raised_cents` | It can drift, and our scale doesn't need it. I'd revisit with materialised counters at ~10⁶ donations. |
| Required idempotency key + pending row | Natural unique constraint on `payment_charge_id` | The charge id only exists *after* charging, which is too late to stop the second charge. |
| Conditional `UPDATE` for refunds | `SELECT … FOR UPDATE` then `UPDATE` | One statement does the same locking with less code. A row lock would be the choice if the refund had to call the provider first. |
| Opaque DB sessions | JWT | Revocation would need a denylist, which is a session table again. |
| scrypt (built in) | bcrypt / argon2 (native addons) | Same security class with no native build across arm64 and amd64. |
| Testcontainers | Tests against the compose `db` | Tests would depend on the dev database's state and on a manually started service. |
| nginx serving the SPA + `/api` proxy | Separate origins with CORS + `SameSite=None` | Cross-site cookies are weaker, and Vite would need a build-time URL. |

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Clean-clone failure (20 points) | CI runs `compose up --build --wait` on every push. A clean-clone rehearsal goes on the spec 006 checklist. Cold-build time noted in the README. |
| Safari rejects `Secure` cookies on `http://localhost` | Playwright WebKit project in e2e. Fallback: `COOKIE_SECURE` env flag, documented. |
| Port 3000/4000/5433 already in use on the reviewer's machine | Ports are documented, and the host ports are env-overridable in compose. |
| Hand-written Kysely `Database` types drift from the migrations | Integration tests exercise every query against the migrated schema. |
| Testcontainers on Windows / Docker Desktop not running | Documented. The Docker daemon is a precondition (Phase 0 found it stopped). |
| Over-running 5–8 h on process overhead | Specs stay short. Must-haves first. Time is logged per spec in `tasks.md`. |
| The emailed answers contradict assumptions A1–A5 | Each assumption is isolated (the `source` exemption, one CASE expression, one count query), so a change touches one place. |
| Mock provider state is in memory | It only affects `tok_flaky`/`tok_dup` across restarts. Acceptable for a fixture; documented. |
