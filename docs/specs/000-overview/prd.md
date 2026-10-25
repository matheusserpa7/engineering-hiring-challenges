# PRD 000 — Aangan donation tracking page (project overview)

Status: draft, awaiting approval · Owner: Matheus · Source spec:
[`roles/full-stack-engineer/REQUIREMENTS.md`](../../../roles/full-stack-engineer/REQUIREMENTS.md)

## Problem and context

The Himalaya Cultural Centre needs one page for its **Aangan** courtyard campaign: the public
sees progress and recent donors, a donor gives (usually as a guest, on a phone), and the
office searches, filters and refunds what came in. The product is small on purpose. The
difficulty is getting **money, privacy, concurrency and refunds** exactly right, because a
wrong number or a leaked name reaches a real donor and nobody at the client can fix it.

This PRD scopes the whole take-home: 5–8 hours of work inside a 48-hour window, scored
against [`RUBRIC.md`](../../../roles/full-stack-engineer/RUBRIC.md).

## Goals

1. Every must-have (M1–M9) is complete, tested where it hurts, and runs from a clean clone
   with `cp .env.example .env && docker compose up --build`.
2. The three score-deciding properties hold, and are proven by a test, not asserted:
   integer-cent money, privacy enforced in the query, refunds reflected in every aggregate
   in the same transaction.
3. A retried or double-clicked donation creates exactly one donation and one charge
   (DATA-MODEL rule 7, which we treat as a must-have even though the spec lists it as S3).
4. A reviewer can see *why* from the README *Decisions* section, the specs and the ADRs,
   without reading the router.

## Non-goals (explicitly out of scope)

- Real payment processing. Only the provided mock provider is used.
- Registration, password reset, social login, MFA. The three seeded accounts are the only
  logins.
- Email sending (a confirmation is logged, not sent).
- Design polish beyond "legible, and usable at 375px".
- A scheduler for recurring donations (S2 would only persist the intent).
- Should-haves other than S3 and the S4 rate limits, and every stretch goal, until all
  must-haves are done and verified. Order after that: S0, then X1 (see `tasks.md`).
- A live deployment (X4).

## Personas

- **Visitor** — anonymous, on a phone, during a fundraising push.
- **Donor** — gives as a guest or is one of the two seeded donor accounts.
- **Admin** — office staff: searches, filters, refunds.
- **Reviewer** — the grader. Clones the repo, follows the README literally, probes the API
  with `curl`.

## User stories and acceptance criteria

### US-1 — Reviewer runs it (M7, M1)
- **Given** a fresh clone and a pruned build cache, **when** the reviewer runs
  `cp .env.example .env && docker compose up --build`, **then** db, api and web become
  healthy without any other step, migrations and seed have run, and
  `http://localhost:3000` shows the Aangan campaign with $43,058.00 raised.
- **Given** the stack has already been started once, **when** it restarts, **then** the seed
  does not duplicate rows (still 75 donations).
- **Given** the repository, **when** `npm run lint` and `npm test` run, **then** both pass
  with zero warnings.

### US-2 — Visitor sees the campaign (M3)
- **Given** the seeded data, **when** `GET /api/campaigns/aangan-courtyard` is called,
  **then** `raisedCents = 4305800`, the goal is 15,000,000 cents, and refunded and failed
  donations are excluded from the total and the donor count.
- **Given** an anonymous donation, **when** the public donations list is fetched, **then** its
  item has `displayName: "Anonymous"` and the raw JSON contains no donor name, email or
  donor id. The fields are absent, not null.
- **Given** a family donation by "Maya Gurung", **then** its `displayName` is
  "The Gurung family".
- **Given** a campaign with no completed donations, **then** the page shows 0% (never
  `NaN%`) and an empty-state message. **Given** the API is down, **then** the page shows an
  error state with a retry.
- **Given** the seeded XSS payloads, **when** they are rendered on the public page or the
  admin table, **then** they appear as literal text and no script runs.

### US-3 — Donor gives (M4, S3)
- **Given** the form, **then** presets $21/$51/$101/$501/$1,001 and a custom amount are
  offered, privacy defaults to `public` with a one-sentence explanation, and the dedication
  (type + name) and the 280-character message are optional.
- **Given** `amountCents` of 99, 2500001, -100, `"abc"` or `null`, **when** it is POSTed,
  **then** the API answers 422 `validation_failed` and creates no row. 100 and 2500000 are
  accepted.
- **Given** `tok_ok`, **then** the response is 201 with a receipt number (`HCC-YYYY-NNNNNN`),
  and the total moves on the next read.
- **Given** `tok_decline` or `tok_insufficient`, **then** the response is 402 with the
  provider code, the donor sees an honest "your card was declined", and no `completed` row
  exists.
- **Given** `tok_timeout`, **then** after `PAYMENT_TIMEOUT_MS` the API answers 202 with a
  `pending` donation and a receipt number. The donor is told the payment is being confirmed,
  not that it failed. The request never hangs.
- **Given** 20 concurrent identical requests with the same `Idempotency-Key`, **then**
  exactly one donation row exists and the provider was charged exactly once.
- **Given** an unknown field in the body (e.g. `"status": "completed"`), **then** 422.

### US-4 — Donor sees only their own records (M5, M6)
- **Given** `donor@` is logged in, **when** they fetch one of `other@`'s donations by id,
  **then** 404. **When** they call any `/api/admin/*` route, **then** 403.
- **Given** `donor@` lists their donations, **then** exactly their 3 seeded donations come
  back (the refunded one labelled as refunded).
- **Given** no session, **then** every non-public route returns 401.

### US-5 — Admin manages donations (M5)
- **Given** an admin, **when** searching `गुरुङ`, **then** the Devanagari donor
  `अनिशा गुरुङ` is returned. Searching by part of an email also works.
- **Given** the status filter set to `completed`, `refunded` or `failed`, **then** only
  those rows come back.
- **Given** a completed donation, **when** the admin refunds it with a reason, **then** in one
  transaction the status becomes `refunded`, `refunded_at` is set, and an audit row records
  who, when and why. The next public read shows a lower total, a lower donor count (if it
  was that donor's only gift) and the donation gone from the list.
- **Given** an already-refunded donation, **then** refund answers 409. **Given** 20
  concurrent refunds of one donation, **then** exactly one succeeds and one audit row exists.

### US-6 — Login is safe (M5, M6)
- **Given** a wrong password or an unknown email, **then** the response body and status are
  identical, and the timing is comparable.
- **Given** more than the allowed login or donation attempts per window, **then** 429 with
  `Retry-After`.
- **Given** a successful login, **then** the session cookie is `HttpOnly`, `SameSite=Strict`
  and `Secure`, and expires after `SESSION_TTL_HOURS`.

## Traceability

| Item | Covered by |
|---|---|
| M1 monorepo, shared package, lint | US-1 · spec 001, 002 |
| M2 migrations, DB constraints, seed 75 rows, indexes | US-1, US-2 · spec 002 |
| M3 public page, privacy, refunds excluded, states, 375px | US-2 · spec 003 |
| M4 donation flow, server-side amount, decline/timeout, receipt | US-3 · spec 004 |
| M5 login, role separation in query, Devanagari search, status filter, refund | US-4, US-5 · spec 005 |
| M6 security baseline (7 non-negotiables + hashing, sessions, headers, CORS) | US-2, US-4, US-6 · all specs, swept in 006 |
| M7 Docker (multi-stage, healthcheck, non-root, .dockerignore) | US-1 · spec 001, swept in 006 |
| M8 money / authz / refund tests (+ privacy payload, concurrency, e2e) | US-2..US-5 · specs 002–006 |
| M9 READMEs, AI-USAGE.md, video | spec 006 |
| S3 idempotency (rubric bonus +2) | US-3 · spec 004 |
| S4 rate limiting + audit log (partial) | US-5, US-6 · specs 004, 005 |
| Rubric cat. 3 "correctness under awkward input" | US-2, US-3, US-5 |
| Rubric cat. 4 security checks (all seven rows) | US-2, US-3, US-4, US-6 |

## Assumptions (pending answers to the clarification email)

| # | Assumption | Why | Depends on |
|---|---|---|---|
| A1 | Imported seed rows are **legacy data**: they may break rules that apply to new donations (row 14 is 283 chars, row 71 has a dedication type but no name, closed-campaign gifts are dated after the campaign ended). The exemption is explicit (`source = 'import'`), not a weaker constraint. | M2 requires all 75 rows; truncating or dropping them would destroy data. | Q1, Q2, Q3 |
| A2 | `donorCount` = distinct donors with a completed donation (Aangan: 46). | "Donor count" names people, not gifts. | Q4 |
| A3 | Anonymous donations also withhold the dedication and message from the public payload (`null`, as in the API example). Identifying fields stay absent. | A dedication line can identify the donor. | Q5 |
| A4 | Emails are case-insensitive: rows 11 and 12 are one donor. | A donor gives from three devices (DATA-MODEL). | — |
| A5 | Family display name = "The {last word of the NFC name} family". | No surname column in the seed. A known limitation. | — |
| A6 | "Recent" = the latest N completed donations (default 20, max 50). | A time window can be empty on a quiet day. | — |
| A7 | The $25,000 cap is per donation, as written. Per-campaign limits from `campaigns.json` apply within the global $1–$25,000 envelope. | Spec wording; per-day limits are a rate-limit concern. | — |
| A8 | Inactive or ended campaigns reject new donations (422 `campaign_closed`). | A closed campaign is closed. | Q3 |
| A9 | A refunded donation stays visible to its own donor, labelled refunded. | It is their record. | — |
| A10 | Presets do not change near the goal. Exceeding the goal is allowed. | The closed campaign already exceeds its goal. | — |
| A11 | Guest donations are linked to the donor record by email, including a registered donor's email. | Guest checkout cannot verify email ownership; the risk is documented. | — |
| A12 | Message length counts Unicode code points, the same on the client, in Zod and in Postgres (`char_length`). | JS `.length` counts UTF-16 units; emoji would disagree. | — |

## Open questions (to email)

- **Q1** Row `000014`: 283 characters vs the documented 280 limit.
- **Q2** Row `000071`: a dedication type with no name.
- **Q3** `roof-repair-2025`: completed donations dated after the campaign ended. Should new
  ones be rejected?
- **Q4** `donorCount`: distinct donors or completed donations?
- **Q5** Anonymous: withhold the dedication and message too?
