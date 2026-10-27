# Tasks 006 — Hardening and submission

Flow per task: test first (see it fail) → change → lint, typecheck, test → review → fix → one
spec update → tick here → diff summary, decisions, commit message → Matheus says go → commit.
`Refs: spec-006/Tn` last. No task changes API code; a sweep finding becomes a new task first.

**Budget: about 6 h 50, not the overview's 1 h 15** (needs your ok). Lean path, about 5 h:
T1, T2, T4 + T5 on Chromium only, T7–T11, T13.
**Cut order**, first cut first: T12's interview list → WebKit in T4–T6 (a Known issue instead) →
T2's 413 → T3 (by hand in T11) → T6 (e2e stays local) → T5's `refund` spec.
**Never cut:** T1, T2's 400, T7, T8, T9, T10, T11, T13 and the video.

- [x] **T1 — Lint: ban HTML injection** (~20 min) · self-review
  - Files: `eslint.config.js`, `apps/web/test/lint-rules.test.ts`. Test: tech spec §2, red today.
  - Mutations: drop each new entry; drop the repeated money entries (the `toFixed` row goes red).
  - Done: repo lint clean. Commit: `build(lint): ban innerHTML in templates and code` · Depends: —
- [x] **T2 — nginx: JSON 400 and 413** (~30 min) · self-review (infra, < 30 lines)
  - Files: `apps/web/nginx.conf`, `.github/workflows/ci.yml` (step *nginx errors*).
  - Test: the step on local compose, red on today's image, green after, `cmp` with `:4000`.
  - Commit: `fix(web): answer nginx 400 and 413 as JSON` · Depends: —
- [ ] **T3 — Stack checks QA could not run** (~35 min) · reviewer: yes (sessions, limits)
  - Files: `.github/workflows/ci.yml` (*sessions*, *payment outcomes*, *rate limits*),
    `docker-compose.yml`, `.env.example` (G7).
  - Test: §4, each step locally with its §11 negative control. Commit: `ci: check sessions, payments and rate limits`
  - Depends: T2
- [x] **T4 — Playwright and the public page** (~45 min) · self-review
  - Files: `package.json`, `package-lock.json`, `e2e/{playwright.config.ts,tsconfig.json,fixtures.ts,public.spec.ts,xss.spec.ts}`,
    component labels only if a role is missing.
  - Test: §5 `public`, `xss › public list`. Red: `:innerHTML` in `donation-list.vue` (lint
    bypassed for the check), a 400 px fixed width; both reverted.
  - Done: green on both browsers; lint and typecheck cover `e2e/`. Commit: `test(e2e): add Playwright and public page checks`
  - Depends: T1
- [x] **T5 — E2E giving, refund, session, admin XSS** (~50 min) · self-review (server enforces)
  - Files: `e2e/{donate,refund,session}.spec.ts`, `e2e/xss.spec.ts` (admin case).
  - Test: §5. Red: the refund form's submit removed; the admin donor name bound with `:innerHTML` (lint bypassed; the table shows no message).
  - Done: both browsers green twice in a row on one stack; WebKit cookie outcome noted (G10).
  - Commit: `test(e2e): cover giving, refunds and sessions` · Depends: T4
- [x] **T6 — E2E in CI** (~25 min) · self-review
  - Files: `.github/workflows/ci.yml` (e2e before *rate limits*, report artifact, timeout 20).
  - Done: a pushed run green on both browsers. Commit: `ci: run the Playwright suite against the stack` · Depends: T3, T5
- [x] **T7 — Security sweep** (~35 min) · self-review; findings become tasks
  - Files: `checklist.md` (Security rows); `package-lock.json` only if `npm audit fix` changes it.
  - Test: §6 commands, outputs kept. Commit: `docs: record the security sweep` · Depends: T2
- [x] **T8 — READMEs** (~60 min) · self-review
  - Files: `README.md`, `apps/{api,web}/README.md`, `packages/shared/README.md`, `e2e/README.md`.
  - Test: every command in them run once; the API table checked against `app.ts` and the routers.
  - Done: §7 outline. Commit: `docs: write the submission README` · Depends: T6, T7
- [x] **T9 — AI-USAGE.md** (~20 min) · the user writes or confirms "what I changed"
  - Files: `AI-USAGE.md`, linked from README. Commit: `docs: describe how AI was used` · Depends: T8
- [ ] **T10 — Clean-clone rehearsal** (~30 min, mostly waiting)
  - Files: `README.md` (cold-build line), `checklist.md` (It runs). Test: §8, timed, word for word.
  - Commit: `docs: note the cold build time` · Depends: T9, pushed
- [ ] **T11 — QA run and the full CHECKLIST** (~30 min) · `qa-verifier`
  - Files: `checklist.md`, `docs/PROGRESS.md`, README Known issues if new ones appear.
  - Done: every item pass or n/a with evidence; each failure fixed (new task) or listed.
  - Commit: `docs: complete the submission checklist` · Depends: T10
- [ ] **T12 — Video outline and interview list** (~20 min)
  - Files: `video-outline.md`, `interview-questions.md` here (or private: open question).
  - Done: docs/06 timing as bullets, not a script; questions point to file and line, no
    scripted answers. Commit: `docs: outline the video walkthrough` · Depends: T11
- [ ] **T13 — Video link and close** (~10 min, after the user records)
  - Files: `README.md`, `docs/PROGRESS.md`, `docs/specs/000-overview/tasks.md` (actuals).
  - Done: the link opens in a private window. Commit: `docs: link the video walkthrough` · Depends: T12

**Then the user:** repo public (or `@sandesPathak` invited), `FirstName_LastName.zip` with
`.git` and without `node_modules`, the email from SUBMISSION.md.

## Dependencies

T1 → T4 → T5 → T6; T2 → T3 → T6; T2 → T7. T6 + T7 → T8 → T9 → T10 → T11 → T12 → T13.

## Notes recorded during execution

**T1.** Red before the change (9 of 13 failed). Dropping the repeated money entries turns the
`toFixed` row red. Self-review only; lint, format, typecheck and web tests (190) pass. The script
ban covers `apps/web/src/**` only, so component tests can still read `innerHTML`.

**T2.** Red on today's image (HTML 400), green after; the 413 is `cmp`-equal with `:4000`, and
the API's own 404 and the SPA still pass through. Spec change in fact, not decision: a *named*
location fails with "empty URI in redirect" when URI parsing fails, so `error_page` points at
internal paths `/_errors/400` and `/_errors/413` (tech spec §3 showed `@bad_request`). Self-review.

**T3.** Each step green locally; red without the `UPDATE` (Sessions) and with both limits at 100
(Rate limits). Reviewer: no blockers; five minors, all comment accuracy or drift, fixed (the rate
step proves the limits fire within the defaults, not their exact values). Accepted: the Sessions
`UPDATE` expires all of `donor@`'s sessions, so T6's e2e step must log in fresh; compose and
`config.ts` both hold the defaults 30 and 20.

**T4.** Red: `v-html` on the message fails `xss` and a 400 px `min-width` fails `public` (both
reverted, lint bypassed); green on Chromium and WebKit. The CSP assertion found two things:
Zod's JIT probe is reported on every load (fixed: `apps/web/src/zod-config.ts`, imported first,
`z.config({ jitless: true })`; the spec's "no code change" line is amended in tech spec §5) and
WebKit reports the progress bar's inline width as `style-src-attr` though it applies it (filtered
in the fixture, width asserted instead; README Known issue). Self-review.

**T5.** Red: the donor name rendered with `v-html` in the admin table fails `refund` and the admin
`xss` case; the refund form without its submit handler fails `refund`; both reverted. Chromium
10 green twice in a row on one stack (limits raised through compose for the debugging runs).
**G10 applied:** WebKit stores the Secure cookie on `http://localhost` and never sends it back
(`/api/auth/me` is 401 after a good login), so `refund` and the admin `xss` case are
`test.fixme` on WebKit; README names `COOKIE_SECURE=false`. The admin table has no message
column, so the planned admin message case became the donor-name case (PRD US-3, tech spec §5
amended). Self-review.

**T6.** Locally, with the default limits on a fresh API: Sessions, Payment outcomes, the e2e suite
(10 passed, 2 skipped on WebKit per G10) and Rate limits pass in CI order. `stack` timeout 20 min;
`upload-artifact` pinned to the v7.0.2 commit. **Pushed CI run green** ([run 40549949249](https://github.com/matheusserpa7/engineering-hiring-challenges/actions/runs/40549949249), on `f73d958`): every stack step, including *End-to-end tests* (Chromium and WebKit) and *Rate limits*. Self-review.

**T7.** Sweep clean, so no new task: audit 0, gitleaks 3 hits (one fixed test UUID), headers and
uid as expected, docs/07 greps empty or justified; evidence in `checklist.md`. Self-review.

**T8.** Run once: `npm test` (275 + 488 + 190), the 20-parallel burst (3 × 201, 17 × 409, one new
`donation processed` line), `db:migrate` and `db:seed` on the compose database; the API table was
checked against the routers' `get`/`post` calls. Self-review. **Open:** the README's *Time spent*
line waits for the author's own hours; the cold-build line comes with T10 and the video link with T13.

**T9.** Drafted from the task notes of specs 002–006, so each "what changed" line points to a
spec task that records it. **For the author to confirm before submitting:** that Claude Code is the
only tool used (a `.git/cursor` index was seen earlier), and which changes were his own rather than
the reviewer's; the file says so only where the record does.

## Optional (only with time left)

nginx JSON for 502/504 · gitleaks in CI · `Cache-Control: no-cache` on `index.html` ·
`Permissions-Policy` · S0 (007), X1 (008).
