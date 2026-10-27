# PRD 005 — Login, donor records, admin list and refunds

Status: draft, awaiting approval · Parent: [000](../000-overview/prd.md) · Depends on: 002,
003, 004 · Decisions: [ADR 0004](../../adr/0004-sessions.md), [ADR 0005](../../adr/0005-privacy-and-authz-in-sql.md)

## Problem and context

Anyone can give; nobody can log in. M5 is the last must-have, and it holds the rubric's
heaviest checks: donor A reading donor B's record (−8, the test reviewers look for first), a
refund that leaves a public total wrong, Devanagari search that returns nothing, a login that
reveals which emails exist, and an `ORDER BY` built from the query string.

## Goals

1. `/api/auth/{login,logout,me}`: scrypt, 32-byte tokens stored as SHA-256 with an expiry,
   an `HttpOnly; Secure; SameSite=Strict` cookie, one identical failure for every bad login.
2. Ownership in the SQL `WHERE` for `GET /api/me/donations` and `GET /api/donations/:id` (a
   foreign record is 404); `/api/admin/*` needs the admin role read from the database (403).
3. `GET /api/admin/donations`: name/email search (Devanagari), status filter, allow-listed
   sort, pagination envelope.
4. `POST /api/admin/donations/:id/refund`: conditional `UPDATE` + audit row in one
   transaction; 20 concurrent refunds → exactly one success.
5. Close 004's open items: `Origin` allow-list, CORS naming origins, API CSP, login limit.
6. Vue: login, "My donations", admin table with refund.

## Non-goals

- Registration, password reset, MFA, "log out everywhere". Partial refunds. A provider
  refund call (the mock has none: a refund is a state change, 000 §8).
- Date filter and CSV export (S0 → 007). Login → refund e2e in a browser (006). Pending
  reconciliation (Known issues). A modal dialog with focus trap (X3).

## User stories and acceptance criteria

Tests: API `test/db/{auth,authz,admin-donations,refunds}.test.ts`, unit
`test/{security-middleware,password,config}.test.ts`; shared `test/auth.test.ts`; web
`test/{session,login-page,my-donations,admin-page}.test.ts`.

### US-1 — Logging in is safe (M5, M6, S4)
- **Given** `admin@`/`admin12345`, **then** 200 `{ user: { id, email, fullName, role } }` and a
  cookie with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, `Max-Age` = TTL; the
  `sessions` row holds the token's SHA-256, never the token. *(auth › "strict cookie")*
- **Given** a wrong password, an unknown email, or a seeded guest email (no password),
  **then** 401 `invalid_credentials` with byte-identical bodies, and the unknown-email median
  time is within 0.5×–2× of the wrong-password one. *(auth › "failures are indistinguishable")*
- **Given** `LOGIN_RATE_LIMIT` login attempts from one IP in 15 min, **then** the next is 429 with
  `Retry-After` and no hash runs; successes count too. *(security-middleware › "login limit")*
- **Given** an extra key or a non-string password, **then** 422, and the password is in
  neither the response nor the logs. *(auth › "strict body, no echo")*
- **Given** an expired, logged-out or tampered token, **then** `/auth/me` is 401
  `unauthenticated`. *(auth › "expired, revoked, forged")*

### US-2 — A donor sees only their own records (M5, M8, cat. 4)
- **Given** `donor@`, **when** it reads `other@`'s donation (receipt 22) by id, **then** 404,
  byte-identical to a random UUID's 404. *(authz › "another donor's donation")*
- **Given** `donor@`, **then** `/me/donations` returns exactly receipts 19, 20, 21, with 21
  `refunded` (A9). *(authz › "my donations")*
- **Given** `donor@` on `GET /admin/donations` or the refund route, **then** 403 `forbidden`
  and nothing changes; **given** no session, **then** 401 on every route here but login.
  An admin reads any donation by id. *(authz › "guards")*
- **Given** the admin list repository called with a donor viewer, **then** only that donor's
  rows (F9). *(admin-donations › "viewer scope in SQL")*

### US-3 — The admin finds donations (M5, cat. 3, cat. 4)
- **Given** `q=गुरुङ` in NFC or NFD, **then** receipt 2 (`अनिशा गुरुङ`); `q=ANISHA.GUR`
  finds it by email; `q=%` and `q=_` find nothing. *(admin-donations › "search")*
- **Given** `status=completed|refunded|failed`, **then** `total` 66 / 7 / 2, each item with
  that status. *(admin-donations › "status filter")*
- **Given** `sort=amountCents&dir=asc`, **then** receipt 4 first; `sort=amount_cents`,
  `dir=sideways` or an unknown key → 422. *(admin-donations › "sort allow-list")*
- **Given** `pageSize=10`, **then** pages 1–8 hold all 75 ids exactly once; page 9 is 200 and
  empty. *(admin-donations › "pages never repeat or skip")*
- **Given** the seeded XSS messages, **then** the admin table shows them as text.
  *(admin-page › "hostile text")*

### US-4 — A refund moves every number together (M5, M8, S4)
- **Given** completed receipt 3 (Priya's only gift), **when** refunded with a reason, **then**
  200 `refunded` with `refundedAt`; one audit row (actor, reason, 2,500,000 cents); next reads:
  `raisedCents` 1,805,800, `donorCount` 45, receipt 3 off the public list, on the admin
  `refunded` filter. *(refunds › "aggregates move together")*
- **Given** the audit insert fails, **then** 500 and the donation is still `completed`.
  *(refunds › "one transaction")*
- **Given** 20 concurrent refunds of one donation, **then** one 200, nineteen 409
  `already_refunded`, one audit row. *(refunds › "20 concurrent refunds")*
- **Given** a refunded donation → 409 `already_refunded`; `failed`/`pending` → 409
  `not_refundable`; missing or malformed id → 404; empty or 501-code-point reason → 422.
  *(refunds › "refusals")*

### US-5 — Browser-side defences and screens (M6, M5)
- **Given** a POST with `Origin: https://evil.example` or `null`, **then** 403
  `origin_not_allowed` before any handler; no `Origin` (curl) proceeds. API responses carry
  CSP `default-src 'none'; frame-ancestors 'none'`; CORS echoes listed origins only.
  *(security-middleware › "origin", "headers")*
- **Given** the login page, a failure shows one generic message; success sends an admin to
  `/admin`, a donor to `/me`. "My donations" labels refunds. The admin refunds a row with a
  reason and it shows `refunded`; a 409 says "already refunded" and reloads.
  *(login-page, my-donations, admin-page)*

## Traceability

| Requirement / rubric item | Story | Task |
|---|---|---|
| M5 login, sessions · M6 scrypt, random expiring tokens, cookie flags, identical failures | US-1 | T1, T3, T7 |
| M5 role separation in the query, 404 not 403 · M8 authz test · cat. 4 authz (3) | US-2 | T4, T5 |
| M5 search incl. Devanagari, status filter · cat. 4 parameterised `ORDER BY` (1) | US-3 | T5, T9 |
| M5 refund transactional · M8 refund test · S4 audit log | US-4 | T6, T9 |
| M6 headers, CORS naming origins, CSRF · S4 login limit | US-1, US-5 | T2, T3 |
| Cat. 3 Devanagari search, XSS in the admin table | US-3 | T5, T9 |
| CLAUDE.md hard paths: donor→other 404, donor→admin 403, 20 refunds → 1 | US-2, US-4 | T4, T6 |
| Forward notes: limit before hash, dummy hash, scrypt memory, `email::text ILIKE`, CSP, `:5173` | US-1, 3, 5 | T2, T3, T5 |

Not covered, by design: login → refund in a real browser (006); S0 date filter and CSV (007).

## Assumptions and decisions to approve

Inherited: A2, A9, A11, ADR 0004/0005, 004 E11. Local decisions F1–F14: tech spec §8.
**These change an earlier decision and need your ok:**

- **F1** — Login limit per IP, not 000 §9's IP + email: an email key needs the parsed body
  and lets a sprayer rotate emails; the IP key bounds scrypt work.
- **F2** — Refunds take no `Idempotency-Key` (CLAUDE.md asks for one on money-moving writes):
  the `completed → refunded` transition and `refunds.donation_id unique` are the natural key,
  and no provider is called. A retry gets 409, never a second refund.
- **F3** — `page`/`pageSize` move from S0 into 005: an envelope with no way past page 1 hides
  donations from the office. Date filter and CSV stay in 007.
- **F4** — One `ALLOWED_ORIGINS` list replaces 000's `CORS_ORIGIN`, for CORS and the `Origin`
  check; compose derives it from `WEB_PORT`.

## Open questions

- **Blocking:** budget, ~5 h against the planned 1 h 30 (cut order in tasks.md).
- **Blocking:** `LOGIN_RATE_LIMIT` 20 attempts per IP per 15 min; `SESSION_TTL_HOURS` 8,
  absolute (one office shift), not sliding.
