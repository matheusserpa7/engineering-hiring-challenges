# Tasks 003 — Public campaign page and recent donations

Flow per task: test first (see it fail) → implementation → lint, typecheck, test →
`code-reviewer` on the diff → fix → tick here → diff summary, decisions and commit message
→ Matheus says go → commit. `Refs: spec-003/Tn` is the last line of the body. Strict order.

**Budget: about 2 h 30, not the 1 h in the overview.** Why: the web app is a skeleton (no
router, no component-test setup, no components), and the privacy and surname rules need
table-driven tests against Postgres. This moves the must-have total from ~7 h 45 to ~9 h 15.
If time must be cut here, in this order: the ETag/304 assertion → the stale-response test
(the guard stays) → T7's CI smoke (moves to 006). Privacy, totals and XSS tests are never
cut.

- [x] **T1 — Shared: the public campaign contract** (~15 min)
  - Files: `packages/shared/src/{campaigns.ts,errors.ts,index.ts}`,
    `packages/shared/test/campaigns.test.ts`, `packages/shared/README.md`
  - Test first: `campaigns.test.ts` (tech spec §7, row 1). Red: module missing.
  - Done: green; `validation_failed` is a known code; both apps build against the new
    exports.
  - Commit: `feat(shared): add the public campaign contract`
  - Depends on: —

- [x] **T2 — API: `GET /api/campaigns/:slug` with derived totals** (~30 min)
  - Files: `apps/api/src/{repositories/campaigns.ts,services/campaigns.ts,http/campaigns.ts,app.ts,start.ts}`,
    `apps/api/test/{campaign-phase.test.ts,errors.test.ts,health.test.ts}` (the last two
    pass a never-connecting `db` to `createApp`), `apps/api/test/db/campaign-api.test.ts`
  - Test first: `campaign-phase.test.ts` and `campaign-api.test.ts`, plus the undecodable
    parameter case in `errors.test.ts`. Red: route missing (404 everywhere).
  - Mutation to run once: move `status = 'completed'` from the `JOIN` to the `WHERE`; the
    empty-campaign test must fail.
  - Done: green; `curl :4000/api/campaigns/aangan-courtyard` on the compose stack shows
    `"raisedCents":4305800` and `"donorCount":46`.
  - Commit: `feat(api): serve a campaign with its derived totals`
  - Depends on: T1

- [x] **T3 — API: the public donation list, privacy in the query** (~35 min)
  - Files: `apps/api/src/{repositories/public-donations.ts,services/campaigns.ts,http/campaigns.ts,http/validate.ts}`,
    `apps/api/test/db/public-donations.test.ts`; `docs/adr/0005-privacy-and-authz-in-sql.md`
    and `docs/specs/000-overview/prd.md` (A5): one line each pointing to C1
  - Test first: `public-donations.test.ts` (tech spec §7). Red: route missing.
  - Mutations to run once, each must fail a test: select `donor_name` for anonymous rows;
    drop the anonymous `message` null; remove the `id desc` tie-break; the single-word
    family rule returning the word.
  - Done: green; `curl '…/donations?limit=50'` on the compose stack shows `Anonymous`, `The
    Gurung family`, and no `@`.
  - Commit: `feat(api): list recent donations with privacy in the query`
  - Depends on: T2

- [x] **T4 — Web: typed API client and formatting helpers** (~15 min)
  - Files: `apps/web/src/{api.ts,format.ts}`, `apps/web/test/{api.test.ts,format.test.ts}`,
    `apps/web/src/App.vue` (the health ping passes a schema, nothing else changes),
    `apps/web/package.json` and `package-lock.json` (`zod`, for the schema type)
  - Test first: the new `api.test.ts` cases and `format.test.ts`. Red: `format.ts` missing,
    `getJson` takes no schema.
  - Done: green; no `toFixed`, no division of cents, no `getMonth()` (lint plus review).
  - Commit: `feat(web): validate API responses and format dates`
  - Depends on: T1

- [x] **T5 — Web: totals, progress bar and donation list** (~25 min)
  - Files: `apps/web/src/components/{progress-bar,campaign-totals,donation-list}.vue`,
    `apps/web/test/{progress-bar,campaign-totals,donation-list}.test.ts`, `apps/web/test/fixtures.ts`
    (contract-shaped builders, shared with T6),
    `apps/web/vite.config.ts` (jsdom test environment), `apps/web/package.json` and
    `package-lock.json` (`@vue/test-utils`, `jsdom`, dev only; check `package.json` after
    the install, see Environment notes)
  - Test first: the three component tests. Red: components missing.
  - Mutation to run once: render the message with `v-html` behind a lint-disable in a
    scratch copy; the XSS test must fail. Revert; never commit the disable.
  - Done: green; lint passes with `vue/no-v-html` untouched.
  - Commit: `feat(web): render campaign totals and recent donations`
  - Depends on: T4

- [x] **T6 — Web: the campaign page, its states and routes** (~25 min)
  - Files: `apps/web/src/{composables/use-campaign.ts,views/campaign-page.vue,views/not-found-page.vue,router.ts,main.ts,App.vue}`,
    `apps/web/test/{campaign-page,router}.test.ts`, `apps/web/vite.config.ts`
    (`build.assetsInlineLimit: 0`), `apps/web/package.json` and `package-lock.json`
    (`vue-router`)
  - Test first: `campaign-page.test.ts`. Red: view missing.
  - Done:
    - Green.
    - `npm run dev` against the seeded db: `/` shows $43,058.00, 28%, 46 donors; row 9 and
      10 show their payloads as text; `/campaigns/roof-repair-2025` shows the closed
      notice; `/campaigns/nope` shows not found.
    - Manual 375 px check (devtools, 375 × 667): no horizontal scroll, row 14 wraps.
      Recorded below.
    - `vite build` output contains no `data:` URL.
  - Commit: `feat(web): show the campaign page with its states`
  - Depends on: T5, T3 (for the manual check against real data)

- [ ] **T7 — Stack smoke and progress** (~10 min)
  - Files: `.github/workflows/ci.yml`, `docs/PROGRESS.md`
  - Test first: run the new smoke lines locally against the compose stack with negative
    controls (expect 4305801; expect an email present) and see both fail.
  - Done:
    - `docker compose up --build --wait`, then the smoke passes through `:3000`.
    - Opening `:3000` in a browser shows the page with no CSP violation in the console.
    - `PROGRESS.md`: position, the `trust proxy` note moved to 004 (D1), the `data:` URL
      note closed, the undecodable-parameter note closed.
    - CI green after the push, when the user asks for one.
  - Commit: `ci: check the public campaign API in the stack job`
  - Depends on: T6

## Dependencies

T1 first: both apps import the contract. T2 before T3 (same router and service). T4 needs
only T1, so it can follow T3 or precede it; the order above keeps API work together. T5
after T4, T6 after T5. T7 last.

## Notes recorded during execution

- T1, done. Test-first: red because the module was missing (shared 60 → 132 tests).
  - Breaking the strict donation schema, the slug length cap, the limit minimum and the list
    schema's strictness each failed exactly the intended tests.
  - Review: no blockers. One major, fixed: §1 listed `PublicDonationListSchema` but the code
    and §4 did not have it; added with tests, §4 now lists it. Also fixed: the `Z`-only date
    rule is documented, the dedication name matches the spec (no `.min(1)`), and the query
    edge cases (`null`, a number, `undefined`) and a `__proto__` key are pinned.
  - Accepted: `z.uuid()` rejects non-RFC ids, fine because every id comes from
    `gen_random_uuid()`.
- T2, done. Test-first: red because the service and the route were missing (API 160 → 186).
  - Nine breaks each failed the intended tests: status filter moved to the WHERE (only the
    empty-campaign test), counting gifts instead of donors, no `::bigint`, either phase
    boundary made exclusive, no `Cache-Control`, no slug validation, a constant ETag.
  - Review: no blockers. One major, fixed: nothing made the slug check observable, so
    `campaign-route.test.ts` (a db that never connects) now proves a malformed slug is a 404
    that never reaches the pool. Also fixed: the ETag must change when the total changes,
    inserts moved inside the `try`, synthetic slugs are `test-*`, a connection timeout on
    the never-connecting pool.
  - Also changed: `logging.test.ts` passes a `db` to `createApp`, like `errors` and `health`.
- T3, done. Test-first: red because the repository module was missing (API 186 → 247).
  - Six breaks each failed the intended tests: an anonymous name shown, an anonymous message
    shown, no `id desc` tie-break, the one-word family rule, an anonymous dedication shown, no
    status filter.
  - Review: no blockers; the seed data leaks nothing. One major, fixed: a no-break space or
    zero-width space inside a surname made the regex return the whole name (`Dr Maya<nbsp>Gurung`
    → "The Maya Gurung family"); they are separators now, with tests for each. Also fixed: a blank
    public name shows Anonymous, the half-filled public dedication is pinned, comments corrected.
  - Accepted, documented in §3.3: with no surname column `Maya, Gurung` and `Dr. Maya` show
    "Maya" (A5), pinned as known limits. Spec 004 must normalise whitespace in names at intake.
  - The `Aama` dedication appears in the payload legitimately (row 1 is public); the check that
    matters is by id: row 13's item has a null dedication.
- T4, done. Test-first: red because `format.ts` was missing and `getJson` took no schema (web 5 → 31).
  - Four breaks each failed the intended tests: no `timeZone: 'UTC'` (all three zones), no
    11-month cap (364 days read "12 months ago"), a future time not "just now", the `signal`
    not passed to `fetch`.
  - No `code-reviewer`: a client-side helper, no money or auth path; self-reviewed against
    docs/07 (no float math, no `getMonth()`, no `toFixed`, no `any`).
  - For T5/T6: `getJson` rethrows fetch's `AbortError` untouched, so `use-campaign` must treat
    it as "superseded", not as an error state.
- T5, done. Test-first: red because the three components were missing (web 31 → 47).
  - Four breaks each failed the intended test: `v-html` on the message (the XSS test; lint
    also rejects it with `vue/no-v-html` and `vue/no-child-content`), the message always
    rendered, the bar not capped at 100, the end line shown when closed.
  - No `code-reviewer`: presentational components with no input, auth or money logic of their
    own; self-reviewed (every string through `{{ }}`, amounts only via `formatCents`).
  - For T6: 375 px wrapping (`overflow-wrap: anywhere`, amounts `nowrap`) is set but unverified
    until the manual check; jsdom has no layout.
- T6, done. Test-first: red because the view was missing (web 47 → 64).
  - Six breaks each failed the intended test: no stale-response guard, a 404 read as an error,
    no `encodeURIComponent`, no closed notice, no catch-all route (the `signal` break was
    invalid syntax, so it proves nothing: the abort is saved bandwidth, the counter is the guarantee).
  - No `code-reviewer`: client-only, no money, auth or personal data; self-reviewed.
  - Checked on the compose stack through nginx `:3000` in Edge (DevTools emulation, 375 × 667):
    $43,058.00, 28%, 46 donors; roof repair shows the closed notice; `/campaigns/nope` and
    `/whatever` show not found; no horizontal overflow; no CSP violation; no `data:` URL in the build.
  - Spec correction, no decision changed: rows 9 and 10 (the XSS payloads) sit at positions 42
    and 43 of 49, so the page's 20 newest never show them, nor row 14. Their rendering stays
    proven by the component tests; in a real browser it moves to the e2e in 006.
