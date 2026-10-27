# Tasks 005 — Login, donor records, admin list and refunds

Flow per task: test first (see it fail) → implementation → lint, typecheck, test →
`code-reviewer` where marked → fix → one spec update → tick here → diff summary, decisions,
commit message → Matheus says go → commit. `Refs: spec-005/Tn` last.

**Budget: about 5 h, not the 1 h 30 in the overview** (needs your ok). Cut order if needed:
T10's smoke (moves to 006) → F3 paging (back to S0) → the timing-ratio test (keep the
byte-identical one). T3, T4 and T6 are never cut.

- [x] **T1 — Shared: auth and donor-record contract** (~25 min) · reviewer: yes (validation)
  - Files: `packages/shared/src/{auth.ts,donor-records.ts,errors.ts,index.ts}`,
    `packages/shared/test/auth.test.ts`, `packages/shared/README.md`
  - Test: tech spec §9 row 1. Red: modules missing.
  - Mutations: drop `.strict()` on the query; `z.coerce.number()` for `page` (`'1e1'` must
    be rejected); `.length` for the reason. Each must fail a test.
  - Done: green; both apps build; 6 new error codes. Commit: `feat(shared): add the auth and admin contracts`
  - Depends on: —

- [x] **T2 — API: origins, CORS, CSP, new config** (~30 min) · reviewer: yes (CSRF)
  - Files: `apps/api/src/{config.ts,app.ts,http/security.ts}`, `docker-compose.yml`,
    `.env.example`, `apps/api/package.json`, `package-lock.json` (`cors`),
    `apps/api/test/{security-middleware,config}.test.ts`
  - Test: §9 rows 3–4 (all but the login limit). Red: no 403, helmet's default CSP.
  - Mutations: reflect any origin in CORS; allow `Origin: null`; `z.coerce.boolean` for
    `COOKIE_SECURE`. Done: green; donation tests unchanged; on compose a POST through nginx
    with `Origin: http://127.0.0.1:3000` passes and `http://localhost:3001` gets 403. Commit: `feat(api): check request origins and tighten headers`
  - Depends on: T1

- [ ] **T3 — API: login, sessions, logout, me** (~50 min) · reviewer: yes (auth)
  - Files: `apps/api/src/{auth/password.ts,repositories/sessions.ts,services/auth.ts,http/auth.ts,http/session.ts,app.ts,start.ts,http/security.ts}`,
    `apps/api/package.json` (`cookie`), `apps/api/test/{password,security-middleware}.test.ts`,
    `apps/api/test/db/auth.test.ts`, `apps/api/test/intake.ts` (test deps)
  - Test: §9 rows 2, 4 (login limit), 5. Red: route missing (404).
  - Mutations: skip the dummy hash for unknown emails (timing test); store the raw token;
    check the limit after `verifyPassword` (the blocked attempt reaches the verifier spy);
    drop `expires_at > now()`; a slot limit of 4.
  - Done: green; on compose `curl -c` login as each seeded account; the token is not in the DB.
  - Commit: `feat(api): log in with hashed, expiring sessions`
  - Depends on: T2

- [ ] **T4 — API: ownership in the query** (~35 min) · reviewer: yes (authz)
  - Files: `apps/api/src/{repositories/donor-records.ts,services/donor-records.ts,http/me.ts,http/admin.ts,http/session.ts,app.ts}`,
    `apps/api/test/db/authz.test.ts`
  - Scope: `requireRole`, `/me/donations`, `GET /donations/:id`, the `/admin` router with the
    guard only (routes in T5, T6).
  - Test: §9 row 6. Red: routes missing.
  - Mutations: drop `donor_id = $viewerId` (foreign row 200); answer 403 for a foreign row
    (body differs from a random id's 404); mount `/admin` without `requireRole` (donor 403 test).
  - Commit: `feat(api): scope donation reads to their owner`
  - Depends on: T3

- [ ] **T5 — API: admin search, filter, sort, pages** (~40 min) · reviewer: yes (SQL)
  - Files: `apps/api/src/{repositories/donor-records.ts,services/donor-records.ts,http/admin.ts}`,
    `apps/api/test/db/admin-donations.test.ts`
  - Test: §9 row 7. Red: route missing.
  - Mutations: `p.email ILIKE` (EXPLAIN test); no `ESCAPE` handling (`%` returns all);
    drop the `d.id` tie-break (page test, with synthetic equal timestamps); `OFFSET page ×
    size` (page 1 skips 10).
  - Commit: `feat(api): search and filter donations for admins`
  - Depends on: T4

- [ ] **T6 — API: transactional refund** (~35 min) · reviewer: yes (money, concurrency)
  - Files: `apps/api/src/{repositories/refunds.ts,services/refunds.ts,http/admin.ts}`,
    `apps/api/test/db/refunds.test.ts`
  - Test: §9 row 8. Red: route missing.
  - Mutations: `SELECT status` then `UPDATE` without the `WHERE status` (20-parallel test);
    audit insert outside the transaction (trigger test); 409 for a missing id.
  - Done: green three runs in a row. Commit: `feat(api): refund donations with an audit row`
  - Depends on: T5 (shares `AdminDonation` mapping)

- [ ] **T7 — Web: session, login page, navigation** (~35 min) · self-review (server enforces)
  - Files: `apps/web/src/{api.ts,composables/use-session.ts,views/login-page.vue,router.ts,App.vue}`,
    `apps/web/test/{api,session,login-page,router}.test.ts`
  - Test: PRD US-5 login criterion; guard redirects. Red: page missing.
  - Mutations: show the server's 401 message per field; skip the guard. Commit: `feat(web): add login and session state`
  - Depends on: T3

- [ ] **T8 — Web: my donations** (~20 min) · self-review
  - Files: `apps/web/src/views/my-donations-page.vue`, `apps/web/test/my-donations.test.ts`
  - Test: refunded label, empty state, 401 → login. Commit: `feat(web): list a donor's own donations`
  - Depends on: T7, T4

- [ ] **T9 — Web: admin table and refund** (~45 min) · self-review
  - Files: `apps/web/src/{views/admin-page.vue,components/admin-donation-table.vue,components/refund-form.vue,composables/use-admin-donations.ts}`,
    `apps/web/test/admin-page.test.ts`
  - Test: PRD US-3 last criterion, US-5 admin criterion. Red: page missing.
  - Mutations: bind the message with `:innerHTML`, which `vue/no-v-html` does not catch (the
    XSS test must); put `q` in the route query (URL test fails).
  - Done: green; on compose at 375 px: search `गुरुङ`, refund a row, public total drops.
  - Commit: `feat(web): add the admin donation table and refunds`
  - Depends on: T7, T5, T6

- [ ] **T10 — Stack smoke, README, progress** (~15 min) · self-review
  - Files: `.github/workflows/ci.yml`, `apps/api/README.md`, `docs/PROGRESS.md`
  - Test: run the smoke lines on compose with a negative control (expect 200 for donor →
    other's id) and see it fail. Done: §9 last row in CI; README lists the routes and accounts.
  - Commit: `ci: check login and ownership in the stack job`
  - Depends on: T9

## Dependencies

T1 → T2 → T3 → T4 → T5 → T6 on the API. Web: T7 after T3; T8 after T7 and T4; T9 after T7, T5
and T6. T10 last. T7 can run alongside T4–T6.

## Notes recorded during execution

**T1.** Dropping `.strict()` on the query, `z.coerce.number()` for `page` and `.length` for the
reason each fail a test. Review: the NFC test for `q` used a string that was already NFC, now
`e` + U+0301; a reason of only U+200B/U+2060 is refused (`blank_reason`); the status list is
`DONATION_STATUSES`. Accepted: `q` stays as `undefined` when blank, so callers test
`q !== undefined`; `page` takes leading zeros (`'007'`), matching §5's regex. For T5/T9: the web
client must not send empty `status`, `sort` or `dir` (422).

**T2.** Reflecting any origin, allowing `Origin: null` and `z.coerce.boolean` each fail a test.
On compose, `Origin: http://127.0.0.1:3000` gets 400 (passed the check) and `:3001` and `null` get
403. Review: origin rows for a prefix, a trailing slash and upper case; CORS pinned to GET/POST and
`Content-Type`/`Idempotency-Key`; `ALLOWED_ORIGINS` in `.env.example` is for `npm run dev` only.
For T3: `loginRateLimit` and `SESSION_TTL_HOURS` are parsed but unused until the login lands.
