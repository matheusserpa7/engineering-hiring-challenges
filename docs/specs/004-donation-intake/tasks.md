# Tasks 004 — Donation intake

Flow per task: test first (see it fail) → implementation → lint, typecheck, test →
`code-reviewer` where CLAUDE.md requires it → fix → one spec update → tick here → diff
summary, decisions, commit message → Matheus says go → commit. `Refs: spec-004/Tn` last.

**Budget: about 3 h 30, not the 1 h 30 in the overview** (needs your ok). Why: a payment
adapter with a deadline, two integration files against Postgres, and a form with six result
screens. Cut order if needed: T5 (rate limit, S4) → the flaky retry in T2/T3 → E7's stale
replay in T4 → T9's POST smoke (moves to 006). T4 is never cut.

- [x] **T1 — Shared: the donation contract** (~20 min) · reviewer: yes (validation, money)
  - Files: `packages/shared/src/{donations.ts,errors.ts,index.ts}`,
    `packages/shared/test/donations.test.ts`, `packages/shared/README.md`
  - Test first: tech spec §10 row 1. Red: module missing.
  - Mutations: count message length in UTF-16 units; drop `.strict()` on `donor`; strip ZWJ
    in `normaliseName`. Each must fail a test.
  - Done: green; both apps build against the exports; 9 new error codes known.
  - Commit: `feat(shared): add the donation request contract`
  - Depends on: —

- [x] **T2 — API: mock provider port and charge policy** (~20 min) · reviewer: yes (money)
  - Files: `apps/api/src/payments/{mock-provider.ts,charge.ts}`,
    `apps/api/test/{mock-provider,charge}.test.ts`
  - Test first: §10 rows 2–3. Red: modules missing.
  - Mutations: retry with a new key; a deadline per attempt; retry on a decline.
  - Done: green; the port read side by side with the reference file, differences listed in
    the note (per-instance state only).
  - Commit: `feat(api): charge the mock provider with a deadline`
  - Depends on: —

- [x] **T3 — API: `POST /api/donations` outcomes** (~45 min) · reviewer: yes
  - Files: `apps/api/src/{repositories/donations.ts,services/donations.ts,http/donations.ts,http/validate.ts,app.ts,start.ts,config.ts}`,
    `apps/api/test/{donation-helpers,config}.test.ts`, `apps/api/test/db/donations.test.ts`,
    `.env.example` (documented defaults, commented out)
  - Scope: §3 steps 1–8 without §3.1: a key conflict answers 409 for now (safe: no second
    charge). New env: `ORG_TIMEZONE`, `PAYMENT_TIMEOUT_MS`, `PAYMENT_MOCK_LATENCY_MS`,
    `DONATION_RATE_LIMIT` (read in T5).
  - Test first: `donation-helpers.test.ts`, `db/donations.test.ts`. Red: route missing (404).
  - Mutations: trust `amountCents` without the campaign max (Annadaan 500001 must fail);
    `lpad` receipts (the 1,234,567 case); mark a timeout `failed`; log the body (the PII
    log test).
  - Done: green; on the compose stack `curl` with `tok_ok` gives `HCC-2026-000076` and
    `raisedCents` moves; `tok_timeout` answers 202 within the timeout.
  - Commit: `feat(api): accept donations through the mock provider`
  - Depends on: T1, T2

- [x] **T4 — API: idempotent answers under concurrency** (~30 min) · reviewer: yes
  - Files: `apps/api/src/{services/donations.ts,repositories/donations.ts,http/donations.ts}`,
    `apps/api/test/db/donations-idempotency.test.ts`
  - Scope: §3 step 3 and §3.1, `Idempotent-Replayed`, `Retry-After: 1` on 409.
  - Test first: §10 idempotency row. Red: replays answer 409, mismatch is not 422.
  - Mutations: drop `ON CONFLICT` (the losers' 500s must fail the test); compare raw bytes
    instead of the hash; check rules before the key; treat every no-outcome `pending` as 409.
  - Done: green three runs in a row; `reference/concurrency-burst.mjs`-style burst with a key
    against compose (a one-off script in the scratchpad, not committed) → 1 row.
  - Commit: `feat(api): replay donation outcomes by idempotency key`
  - Depends on: T3

- [x] **T5 — API: donation rate limit, proxy trust, access log** (~15 min) · reviewer: yes
  - Files: `apps/api/src/{app.ts,config.ts,start.ts,services/donations.ts}`, `apps/api/test/{rate-limit,logging,config}.test.ts`,
    `apps/api/package.json`, `package-lock.json` (`express-rate-limit`)
  - Test first: §10 rows 5–6. Red: no 429; the query string is logged.
  - Mutations: `trust proxy` `true` (the forged-entry test must fail); limiter after
    `express.json` (a malformed-body burst must fail).
  - Done: green; `PROGRESS.md` forward notes for `trust proxy` and `?q=` closed in T9.
  - Commit: `feat(api): rate-limit donations per client address`
  - Depends on: T3

- [x] **T6 — Web: post with a key, outcome state** (~20 min) · reviewer: no, self-review
  - Files: `apps/web/src/{api.ts,idempotency-key.ts,composables/use-donation.ts}`,
    `apps/web/test/{api,use-donation}.test.ts`
  - Test first: §10 web unit row. Red: `postJson` missing.
  - Mutations: a new key on every submit; the same key after a 402.
  - Commit: `feat(web): submit donations with an idempotency key`
  - Depends on: T1

- [ ] **T7 — Web: the donation form** (~30 min) · reviewer: no, self-review
  - Files: `apps/web/src/components/donation-form.vue`, `apps/web/test/donation-form.test.ts`,
    `apps/web/test/fixtures.ts`
  - Test first: PRD US-1 criteria 2–4. Red: component missing.
  - Mutations: `.length` for the counter; send the dollar string; drop the privacy sentence.
  - Done: green; lint clean (`vue/no-v-html` untouched); labels, fieldsets and legends present.
  - Commit: `feat(web): add the donation form`
  - Depends on: T6

- [ ] **T8 — Web: results on the campaign page** (~25 min) · reviewer: no, self-review
  - Files: `apps/web/src/{components/donation-result.vue,views/campaign-page.vue,composables/use-campaign.ts}`,
    `apps/web/test/{donation-result,campaign-page}.test.ts`
  - Test first: PRD US-1 criterion 1, US-3 screens, US-6. Red: no Donate link, no result.
  - Done: green; on the compose stack at 375 px: give `tok_ok` → total and list move;
    `tok_decline`, `tok_timeout`, `tok_flaky` each show their screen; no CSP violation.
  - Commit: `feat(web): show donation outcomes and refresh the totals`
  - Depends on: T7, T4

- [ ] **T9 — Stack smoke, README, progress** (~10 min) · self-review
  - Files: `.github/workflows/ci.yml`, `apps/api/README.md`, `docs/PROGRESS.md`
  - Test first: run the new smoke lines locally with a negative control (expect the old
    total 4305800 after the gift) and see it fail.
  - Done: CI POSTs `tok_ok` with a key, asserts 201, a replay with the header, and
    `raisedCents` + 10100; README shows `curl` with `Idempotency-Key`; PROGRESS updated.
  - Commit: `ci: check donation intake in the stack job`
  - Depends on: T8

## Dependencies

T1 and T2 first, in either order. T3 needs both; T4 and T5 follow T3. Web: T6 needs only T1,
T7 follows T6, T8 needs T7 and T4 (the 409 screen). T9 last.

## Notes recorded during execution
- T1, done. Test-first: red because the module was missing (shared 132 → 209).
  - Three mutations each failed the intended test: UTF-16 length, `donor` not strict, ZWJ stripped.
  - Review: no blockers. Fixed: `codePointLength` exported (T7's counter), U+2060 joins the
    separators (a name of only a word joiner was valid), the error-code test now goes through
    `isApiErrorBody`, `DONATION_STATUSES` renamed `RECEIPT_STATUSES`, a 61-character token case.
  - For T3: `requestHash` must treat an omitted `message`/`dedication` and `null` as equal, or one
    donor gets `idempotency_key_mismatch` for resending the same body. Names have no database
    length CHECK (only `message` does), so the 100 and 254 limits are API-only.
- T2, done. Test-first: red because both modules were missing (API 247 → 266).
  - Mutations each failed the intended test: retry with a new key, retry on a decline, no
    `expired` guard (a retry after the 202), a deadline of twice the timeout. The test that
    the shared deadline covers the retry is the one that catches the last.
  - No `code-reviewer`: the user asked for a self-review of T2 and T3 together. Self-reviewed
    against the reference file. Differences from it: per-instance state (no `__reset`), the
    unknown-token message no longer echoes the token, the unreachable `default` branch is gone.
  - Added beyond the spec: after the deadline the abandoned attempt will not start a retry.
- T3, done. Test-first: red because the service and the `intake` dependency were missing
  (API 266 → 324). Four mutations each failed the intended test: no campaign max (Annadaan
  500001), a truncated receipt number, a timeout marked `failed`, the request body logged.
  - No `code-reviewer`: the user asked for a self-review of T2 and T3 together. Self-reviewed
    against the `docs/07` table. Checked on compose: `tok_ok` gave `HCC-2026-000076` and the
    total moved by 10100; `tok_timeout` answered 202 in 5.3 s.
  - Differences from the task text: `createApp` takes one required `intake` group
    (`payments`, `paymentTimeoutMs`, `orgTimezone`), so seven existing tests pass a shared
    `test/intake.ts`; `DONATION_RATE_LIMIT` is added in T5 where it is read, not here.
  - Done in T4: `recordOutcome` returning no row is answered from the stored row.
    An unwritable outcome answers 202 from the claimed row, proven with a trigger that fails UPDATE.
- T4, done. Test-first: 11 of 13 new tests red (replays answered 409). Mutations that failed the
  intended test: no `ON CONFLICT` (the race), no freshness check (stale pending), and the reviewer's
  reorder cases are now pinned (mismatch beats an in-flight 409; an outcome written by someone else
  is not overwritten).
  - Review: no blockers. Fixed: two missing tests, a flaky race assertion (a late loser may be a
    replayed 201), the first-402 header check, an `::int` comment. Single-mechanism header refactor
    declined: the error path needs `AppError.headers` anyway.
  - Accepted: a loser of a key race with a new email leaves a donor row with no donation (the
    upsert commits before the claim loses); the claim-loser branch is covered by the 20-parallel
    test, not a deterministic one. The compose burst from the Done line was not run; the Testcontainers 20-parallel test stands in.
- T5, done. Test-first: the rate-limit and logging tests were red (no 429, no `donationRateLimit`,
  query string and `Referer` logged). Both listed mutations failed the intended tests: `trust proxy`
  `true` (two bucket tests) and the limiter after `express.json` (the malformed-body burst).
  - Review: no blockers. Fixed: the query string also reached the log through the `Referer` header
    (now stripped, with a test); the redundant manual `Retry-After` was removed (the library sets it);
    a lone `X-Forwarded-For` entry is pinned.
  - Accepted: a direct call to `:4000` can forge the client address (published on 127.0.0.1 only).
  - For 006: behind Docker Desktop, nginx may see one gateway address for every host client, so all
    local e2e traffic shares one bucket of 30 per 10 min and compose does not forward
    `DONATION_RATE_LIMIT`. Forward it in compose or keep e2e donations under the limit.
- T6, done. Test-first: red because `postJson` and `use-donation` were missing (web 69 → 77 tests).
  - Both listed mutations failed the intended test: a new key on every submit, and the key kept
    after a 402. Self-review only, as tasked.
  - The key is reused only for outcomes where the server may have recorded the attempt (network
    error, 409, 429, unexpected response); every other answer, a 422 included, ends the attempt.
  - For T7/T8: `DonationOutcome` has a `rejected` kind carrying `details` for field mapping.
