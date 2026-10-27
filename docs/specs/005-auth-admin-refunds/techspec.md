# Tech Spec 005 — Login, donor records, admin list and refunds

Status: draft, awaiting approval · Implements [`prd.md`](prd.md) · Inherits 000 §5, §7–§9,
ADRs 0004/0005, 002's schema, `password.ts`, pool and logger, 003's `parseInput`, 004's app
wiring and `trust proxy 1`. **No migration:** 0001 already has `sessions` (`token_hash
unique`, `expires_at`), `refunds` (`donation_id unique`), `donors.role` and both trigram indexes.

## 1. Affected components

```
packages/shared/src/auth.ts            LoginRequestSchema, SessionUserSchema, SessionResponseSchema
packages/shared/src/donor-records.ts   DonationDetailSchema, AdminDonationSchema, page envelope,
                                       AdminDonationQuerySchema, RefundRequestSchema
packages/shared/src/errors.ts          + unauthenticated, forbidden, invalid_credentials,
                                       already_refunded, not_refundable, origin_not_allowed
apps/api/src/config.ts                 + ALLOWED_ORIGINS, SESSION_TTL_HOURS, COOKIE_SECURE, LOGIN_RATE_LIMIT
apps/api/src/http/security.ts          originCheck, corsFor, helmet options, loginLimiter
apps/api/src/auth/password.ts          + at most 2 concurrent derivations (F7)
apps/api/src/repositories/{sessions,donor-records,refunds}.ts
apps/api/src/services/{auth,donor-records,refunds}.ts
apps/api/src/http/{auth,session,me,admin}.ts   routes; requireSession, requireRole
apps/api/src/{app,start}.ts            middleware order (§6), dummy hash at boot (F6)
docker-compose.yml                     api: ALLOWED_ORIGINS from WEB_PORT (F4)
apps/web/src/api.ts                    postJson: idempotencyKey optional
apps/web/src/composables/{use-session,use-admin-donations}.ts
apps/web/src/views/{login-page,my-donations-page,admin-page}.vue
apps/web/src/components/{admin-donation-table,refund-form}.vue, App.vue, router.ts
```

New API dependencies: `cors`, `cookie` (parse only; nothing is signed, ADR 0004).

## 2. API contract

| Route | Guard | Success | Errors |
|---|---|---|---|
| `POST /auth/login` `{email, password}` | Origin, limiter | 200 `{user}` + cookie | 401 `invalid_credentials`, 403, 422, 429 |
| `POST /auth/logout` | session, Origin | 204, cookie cleared | 401, 403 |
| `GET /auth/me` | session | 200 `{user}` | 401 |
| `GET /me/donations` | session | 200 `{data: DonationDetail[]}`, newest 100 | 401 |
| `GET /donations/:id` | session; owner or admin in SQL | 200 `DonationDetail` | 401, 404 |
| `GET /admin/donations?q&status&sort&dir&page&pageSize` | session, admin | 200 envelope of `AdminDonation` | 401, 403, 422 |
| `POST /admin/donations/:id/refund` `{reason}` | session, admin, Origin | 200 `AdminDonation` | 401, 403, 404, 409, 422 |

- `user`: `{ id, email, fullName, role }`. Role is read, never accepted.
- `DonationDetail` (strict): `{ id, receiptNumber, campaign: { slug, title }, donorName,
  amountCents, currency, status, privacyMode, dedication | null, message | null, createdAt,
  refundedAt | null }`. `AdminDonation` adds `donorEmail`, `failureCode | null`.
- Envelope: `{ data, page, pageSize, total, totalPages }`, `page` 1-based, `OFFSET = (page −
  1) × pageSize`, `totalPages = ceil(total / pageSize)` (0 when empty). Past the end → `data: []`.
- 401 `unauthenticated` · 403 `forbidden` (role) · 403 `origin_not_allowed` · 404 `not_found`
  (missing, foreign or malformed id, F12) · 409 `already_refunded` / `not_refundable` · 422
  `validation_failed` with `[{ field, issue }]`, never Zod's message or the input.

## 3. Authentication (`services/auth.ts`, `repositories/sessions.ts`)

**Login**, after the limiter (§6) and `parseInput(LoginRequestSchema)`:
1. `findAccount(email)` → `{ id, password_hash, role, … } | undefined`. Email is the shared
   `EmailSchema` (NFC, lower-case); `donors.email` is citext.
2. `ok = await verifyPassword(password, account?.password_hash ?? dummyHash)`. **Every path
   runs exactly one scrypt**: unknown email, guest with a null hash, wrong password.
3. `!account?.password_hash || !ok` → 401 `invalid_credentials`, one fixed message. Log
   `{ donorId }` if known, never the email or password (forward note: watch the failure rate).
4. Token `randomBytes(32).toString('base64url')`; in one transaction delete this donor's
   expired sessions and `INSERT sessions (token_hash, donor_id, expires_at) VALUES
   (sha256hex(token), $id, now() + make_interval(hours => $ttl))` (database clock).
5. `res.cookie('aangan_session', token, { httpOnly, secure: COOKIE_SECURE, sameSite:
   'strict', path: '/', maxAge })` → 200 `{ user }`.

**Session lookup** (`requireSession`): parse `Cookie` with `cookie.parse`; a value not
matching `^[A-Za-z0-9_-]{43}$` is no session. Then one indexed query:
```sql
SELECT d.id, d.email, d.full_name, d.role FROM sessions s JOIN donors d ON d.id = s.donor_id
WHERE s.token_hash = $1 AND s.expires_at > now()
```
Miss → 401, clearing the cookie if one was sent. Hit → `res.locals.viewer = { id, role, … }`.
Role comes from this row on every request, so a demotion takes effect at once.
**Logout:** `DELETE FROM sessions WHERE token_hash = $1`, clear the cookie, 204.

**SHA-256 is enough** for a 256-bit random token: there is nothing to brute-force, and a stolen
table holds no usable token. **Dummy hash (F6):** `start.ts` hashes 32 random bytes before
listening; a host short of memory now fails at boot instead of rejecting every login.
**Concurrency cap (F7):** `password.ts` runs at most 2 derivations at once (FIFO queue). Each
takes 128 MiB, and libuv's 4 threads are shared with DNS lookups the pool needs to reach `db`.

## 4. Authorisation in the query (ADR 0005)

`requireRole('admin')` runs after `requireSession`, so no session is 401 and a donor is 403
before any parsing. Ownership lives in the repositories:

```sql
-- GET /donations/:id        (isAdmin is a bound boolean from the session row)
WHERE d.id = $1 AND (d.donor_id = $viewerId OR $isAdmin)
-- GET /me/donations         ("mine" even for an admin)
WHERE d.donor_id = $viewerId ORDER BY d.created_at DESC, d.id DESC LIMIT 100
-- GET /admin/donations      (F9: the guard drops, the query still scopes)
WHERE (d.donor_id = $viewerId OR $isAdmin) AND …filters
```

A foreign row and a missing one both return no row, so the route answers the same 404 body.
The id is checked with `z.uuid()` first; a malformed id is that same 404 without a query.

## 5. Admin list and refund

**Query schema** (strict, every value a single string; a repeated key is an array → 422):
`q` through the shared `normaliseName` (stored names went through it at intake), empty →
absent, 1–100 code points, controls → 422 · `status` ∈ `pending|completed|failed|refunded`
(F10) · `sort` ∈ `createdAt|amountCents` (default `createdAt`) · `dir` ∈ `asc|desc` (default
`desc`) · `page` `^\d{1,6}$` ≥ 1 (default 1) · `pageSize` 1–100 (default 25).

```sql
SELECT d.id, d.receipt_number, c.slug, c.title, d.donor_name, p.email, d.amount_cents, …
FROM donations d JOIN donors p ON p.id = d.donor_id JOIN campaigns c ON c.id = d.campaign_id
WHERE (d.donor_id = $viewer OR $isAdmin) [AND d.status = $status]
  [AND (d.donor_name ILIKE $pattern ESCAPE '\'
        OR d.donor_id IN (SELECT id FROM donors WHERE email::text ILIKE $pattern ESCAPE '\'))]
ORDER BY <SORT_COLUMNS[sort]> <dir>, d.id <dir> LIMIT $size OFFSET $offset
```

- `$pattern = '%' + q with \ % _ backslash-escaped + '%'`, bound. `ILIKE` on Devanagari is a
  plain code-point match (no case to fold), and the input is NFC like the stored name.
- **`email::text`**, not `email`: on `citext`, `ILIKE` picks citext's operator, which the
  `(email::text) gin_trgm_ops` index cannot serve. The email match is a subquery on `donors`, because
  an `OR` across two joined tables is a join filter that no index serves. A test proves the email
  arm uses `donors_email_trgm_idx`. **The name arm does not**: `OR` with the subquery keeps a
  sequential scan on `donations` (T5 review), which is fine at this size. A `UNION` of two id sets
  would let both arms use their index; do that if the table grows.
- `SORT_COLUMNS = { createdAt: 'd.created_at', amountCents: 'd.amount_cents' }` as Kysely
  references; `dir` is the enum value. Nothing from the request is spliced. `d.id` breaks ties,
  so `OFFSET` pages never repeat or skip.
- The page and `count(*)` run in one `REPEATABLE READ READ ONLY` transaction: `total` and
  `data` describe the same snapshot even while donations arrive.

**Refund** (`services/refunds.ts`), reason NFC, trimmed, 1–500 code points, controls but line
breaks → 422:

```sql
BEGIN;  -- READ COMMITTED
UPDATE donations SET status = 'refunded', refunded_at = now(), updated_at = now()
 WHERE id = $1 AND status = 'completed' RETURNING amount_cents;
INSERT INTO refunds (donation_id, actor_id, reason, amount_cents) VALUES ($1, $actor, $reason, $amount);
COMMIT;
```

- No row from the `UPDATE` → `SELECT status … WHERE id = $1`: none → 404; `refunded` → 409
  `already_refunded`; `pending`/`failed` → 409 `not_refundable`. Then rollback (nothing written).
- **Concurrency:** the conditional `UPDATE` takes the row lock. Nineteen concurrent refunds
  wait on it; when the winner commits, Postgres re-checks each waiter's `WHERE` against the new
  row version, `status = 'completed'` no longer holds, and they update nothing. There is no
  read-then-write. `refunds.donation_id unique` is the database's backstop; it is unreachable
  through this code, so its violation stays an honest 500 rather than untested mapping.
- **Aggregates:** totals, donor count and the public list are derived from `status` at read
  time (000 §3, 003 §3), so they change at the commit, atomically with the audit row. Nothing
  else to update, so nothing can drift.
- **With intake:** outcome writes match `status = 'pending'`, refunds `status = 'completed'`;
  the two can never both apply to one row version. A refunded donation replays as 201
  `refunded` (004 E3).
- The response re-reads the row as `AdminDonation` after commit.

## 6. Security middleware (`http/security.ts`, mounted in this order in `app.ts`)

1. pino-http (paths only, cookie and `set-cookie` redacted: existing) → 2. helmet with CSP
`default-src 'none'; frame-ancestors 'none'` (JSON needs nothing) → 3. `cors({ origin:
[...ALLOWED_ORIGINS], credentials: true })`, never `*` or a reflected origin → 4. **Origin
check** on every method but GET/HEAD/OPTIONS: an `Origin` present and not in the list, `null`
included, → 403 `origin_not_allowed`; absent → continue (F5) → 5. donation limiter (004) and
**login limiter**: `POST /api/auth/login`, per `req.ip`, 15 min, `LOGIN_RATE_LIMIT`,
every attempt counts, envelope 429 with `Retry-After` → 6. `express.json` → 7. routes.

The login limiter sits before the body parser and the handler, so a blocked attempt never
reaches scrypt (forward note). The Origin check is needed because `localhost:3000` and `:4000`
are the same site, so `SameSite=Strict` alone does not stop a page on another local port.

## 7. Cross-cutting, per endpoint

| Concern | Answer |
|---|---|
| Concurrency | Login: independent inserts, unique `token_hash` (2^256 space). Logout: one `DELETE`. Reads: single statements; the admin page and count share a snapshot. Refund: §5. |
| Idempotency | GETs safe. Login is not (each call is a new session; extras expire). Logout repeated → 401. Refund: the state transition is the key (F2); a repeat is 409 and writes nothing. |
| Authorisation | §4. Role from the database per request; ownership in the `WHERE`; 404 for foreign rows; 403 only for role. Login and Origin: §3, §6. |
| Validation | Strict Zod at every boundary (body, query, `:id`, cookie format). Password 1–256 code points, never normalised beyond what `password.ts` does (NFC). |
| Errors | `AppError` envelope; failed logins share one body; Postgres errors logged as `{ err }` (row data dropped by the serializer); no `?q=` in logs (004 T5). |

## 8. Decisions and alternatives

| # | Chosen | Rejected | Why |
|---|---|---|---|
| F1 | Login limit per IP, every attempt counts (T3 review) | IP + email (000 §9); failures only | Needs the parsed body; rotating emails walks past it; refunding successes lets a public demo login reset the counter, so the IP would not bound scrypt work |
| F2 | No `Idempotency-Key` on refund | Required key | `completed → refunded` is single-use, `refunds.donation_id` unique; no provider call |
| F3 | `page`/`pageSize` in 005 | Wait for S0 | An envelope with no page 2 hides rows from the office |
| F4 | `ALLOWED_ORIGINS` list | One `CORS_ORIGIN` | Dev (`:5173`), compose (`:3000`) and `127.0.0.1` differ; one list feeds CORS and Origin |
| F5 | Missing `Origin` allowed, `null` refused | Require `Origin` | Browsers always send it on POST; curl and CI don't, and carry no victim's cookie |
| F6 | Dummy hash made at boot | Constant in code; lazy | Doubles as a memory self-check; no first-request timing gap |
| F7 | 2 concurrent scrypt | 1 GiB container note only | Bounds memory at 256 MiB and leaves libuv threads for DNS |
| F8 | Absolute TTL, 8 h | Sliding expiry | A sliding TTL writes on every request; one shift is enough |
| F9 | Admin list keeps the viewer `WHERE` | Route guard alone | Dropping the guard in a refactor would still not leak |
| F10 | `pending` in the status filter | The three in M5 | Timeouts must be findable for manual reconciliation |
| F11 | 409 `already_refunded` vs `not_refundable` | One 409 | The admin needs to know which; both are conflicts with state |
| F12 | Malformed id → 404 | 422 | Same answer as 003 C6; teaches nothing about id format |
| F13 | Inline refund form in the row | Modal dialog | Focus trap and Escape are X3; jsdom lacks `showModal` |
| F14 | `COOKIE_SECURE` as an enum of `"true"`, `"false"` | `z.coerce.boolean` | Coerce turns `"false"` into `true` |
| — | `cookie.parse` | `cookie-parser` | Nothing is signed; one function needed |
| — | `OFFSET` pages | Keyset | Simple and exact at this size; keyset when deep pages get slow |
| — | Cookie `aangan_session` | `__Host-` prefix | Breaks the `COOKIE_SECURE=false` fallback; no subdomains here |
| — | Search text kept out of the SPA URL | `?q=` in the route | A name or email would reach nginx logs and `Referer` |

## 9. Test plan

| Test | Type | Proves |
|---|---|---|
| shared `auth.test.ts` | Unit | Login, query and refund schemas: strict; enums; `page` `'0'`, `'1.5'`, `['1','2']`; `pageSize` 101; `q` NFD → NFC, blank → absent; reason 500 vs 501 emoji; response DTOs reject an extra key |
| `password.test.ts` (+ case) | Unit | The slot limiter exported from `password.ts` runs 5 tasks never more than 2 at once, in arrival order, and frees a slot when a task rejects |
| `config.test.ts` (+ cases) | Unit | `COOKIE_SECURE=false` → `false`; a bad origin or one with a path fails boot; defaults |
| `security-middleware.test.ts` | Unit (never-connecting db) | Origin evil / `null` → 403 on POST, absent → passes, GET unaffected; CSP header exact; CORS echoes a listed origin only; login limit+1 → 429 + `Retry-After` with the verifier spy never called; successes count too |
| `db/auth.test.ts` | Integration (seeded) | US-1: cookie attributes; stored hash = SHA-256(token); three failures byte-identical; timing ratio (median of 3, unknown vs wrong); strict body; no password or token in captured logs; expired row, logged-out token, tampered cookie → 401 |
| `db/authz.test.ts` | Integration | US-2: donor → other's id 404 equal to a random id's; `/me` = receipts 19–21; donor → admin list and refund 403, no row changed; no session → 401 on every route; admin reads any id; demoted admin → 403 next request |
| `db/admin-donations.test.ts` | Integration | US-3: Devanagari with a composition-excluded nukta letter (NFC differs from the typed form), an accent in NFD, email part, `%`/`_` literal; status 66/7/2 (+ a synthetic pending); sort and 422s; pageSize 10 → 75 unique ids; page 9 empty; viewer scope with a donor viewer; with `enable_seqscan = off`, `EXPLAIN` names `donors_email_trgm_idx` (the email arm only) |
| `db/refunds.test.ts` | Integration | US-4: receipt 3 → total 1,805,800, donors 45, gone from public list, audit row; trigger-forced audit failure → 500, still `completed`; 20 parallel → 1×200, 19×409, 1 row; refusals 409/404/422 |
| web `session`, `login-page`, `my-donations`, `admin-page` | Component (fetch stubbed at the network) | US-5 screens; guard sends no-session users to `/login`; XSS rows as text; refund 200 and 409 paths; search sends `q` without changing the URL |
| CI stack job (T10) | Smoke, curl via nginx | Login sets the cookie; donor → other's id 404; donor → admin 403; admin search `गुरुङ` finds receipt 2 |

Each task names the mutations that must fail its tests. Not automated here: login → refund
→ total in a real browser, and WebKit with `Secure` on `http://localhost` (006).

## 10. Risks

| Risk | Mitigation |
|---|---|
| Safari drops `Secure` cookies on `http://localhost` | WebKit e2e in 006; `COOKIE_SECURE=false` fallback, documented |
| Reviewer opens the site on a port or host not in `ALLOWED_ORIGINS` → every login 403 | Compose derives it from `WEB_PORT` with `localhost` and `127.0.0.1`; README names the variable |
| Timing test flakes on CI | Wide 0.5×–2× band on medians; the mutation (no dummy hash) is ~100× off |
| In-memory login limiter, one bucket per shared IP | 20 attempts per 15 min, successes included; documented like 004's |
| Brute force across many IPs on one account | Out of scope (no lockout: it would let anyone lock the admin out); Known issues |
| Sessions table grows with logins | Expired rows of the donor are deleted at each login |
| `pg_trgm` splits Devanagari words at vowel signs, depending on the db locale | Index results are rechecked by `ILIKE`; the integration test asserts the row, not the plan alone |
| Budget ~5 h vs 1 h 30 planned | Cut order in tasks.md |
