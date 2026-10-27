# Tasks 004 — Donation intake

Flow per task: test first (see it fail) → implementation → lint, typecheck, test →
`code-reviewer` where CLAUDE.md requires it → fix → one spec update → tick here → diff
summary, decisions, commit message → Matheus says go → commit. `Refs: spec-004/Tn` last.

**Budget: about 3 h 30, not the 1 h 30 in the overview** (needs your ok). Why: a payment
adapter with a deadline, two integration files against Postgres, and a form with six result
screens. Cut order if needed: T5 (rate limit, S4) → the flaky retry in T2/T3 → E7's stale
replay in T4 → T9's POST smoke (moves to 006). T4 is never cut.

- [ ] **T1 — Shared: the donation contract** (~20 min) · reviewer: yes (validation, money)
  - Files: `packages/shared/src/{donations.ts,errors.ts,index.ts}`,
    `packages/shared/test/donations.test.ts`, `packages/shared/README.md`
  - Test first: tech spec §10 row 1. Red: module missing.
  - Mutations: count message length in UTF-16 units; drop `.strict()` on `donor`; strip ZWJ
    in `normaliseName`. Each must fail a test.
  - Done: green; both apps build against the exports; 9 new error codes known.
  - Commit: `feat(shared): add the donation request contract`
  - Depends on: —

- [ ] **T2 — API: mock provider port and charge policy** (~20 min) · reviewer: yes (money)
  - Files: `apps/api/src/payments/{mock-provider.ts,charge.ts}`,
    `apps/api/test/{mock-provider,charge}.test.ts`
  - Test first: §10 rows 2–3. Red: modules missing.
  - Mutations: retry with a new key; a deadline per attempt; retry on a decline.
  - Done: green; the port read side by side with the reference file, differences listed in
    the note (per-instance state only).
  - Commit: `feat(api): charge the mock provider with a deadline`
  - Depends on: —

- [ ] **T3 — API: `POST /api/donations` outcomes** (~45 min) · reviewer: yes
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

- [ ] **T4 — API: idempotent answers under concurrency** (~30 min) · reviewer: yes
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

- [ ] **T5 — API: donation rate limit, proxy trust, access log** (~15 min) · reviewer: yes
  - Files: `apps/api/src/{app.ts,http/donations.ts}`, `apps/api/test/{rate-limit,logging}.test.ts`,
    `apps/api/package.json`, `package-lock.json` (`express-rate-limit`)
  - Test first: §10 rows 5–6. Red: no 429; the query string is logged.
  - Mutations: `trust proxy` `true` (the forged-entry test must fail); limiter after
    `express.json` (a malformed-body burst must fail).
  - Done: green; `PROGRESS.md` forward notes for `trust proxy` and `?q=` closed in T9.
  - Commit: `feat(api): rate-limit donations per client address`
  - Depends on: T3

- [ ] **T6 — Web: post with a key, outcome state** (~20 min) · reviewer: no, self-review
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
