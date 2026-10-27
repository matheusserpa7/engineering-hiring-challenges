# PRD 006 — Hardening and submission

Status: draft, awaiting approval · Parent: [000](../000-overview/prd.md) · Depends on: 003, 004,
005 · The rubric status below is the report the overview's stop gate asks for after 005.

## Problem and context

Every must-have works and CI is green on `4d372cd`, yet a reviewer would still take points we
can see: the fork's root README is still the challenge's, there is no `AI-USAGE.md` and no video,
nobody has timed a cold clean clone, no browser has watched the XSS rows, lint misses
`:innerHTML`, and nginx answers an undecodable `/api` path with an HTML 400, which breaks spec
003's error contract. This spec closes those gaps and adds no feature.

## Rubric status at entry (stop-gate report)

| Item | State on `4d372cd` | Gap closed here |
|---|---|---|
| Cat. 1 It runs (20) | CI `stack` job green from `.env.example` | Fresh-clone rehearsal, pruned cache; cold time in README |
| M1–M5, M7 | Done, tested, CI green | — |
| M6 / cat. 4 | Seven checks tested at the API | `npm audit` number, history scan, XSS in a browser, `:innerHTML` lint, nginx 400 |
| M8 / cat. 3 tests | Money, authz, refund, privacy, 20-parallel | One Playwright path (M8's top bonus) |
| M9 / cat. 5 | Package READMEs exist, stale | Root README, `AI-USAGE.md`, refreshed READMEs |
| Cat. 6 video (10) | None | Outline; the user records |
| Bonus | S3 (+2) done; S0 has pagination only | Nothing (S0 → 007) |

## Goals and non-goals

Goals: (1) a stranger runs it from a fresh clone with the README alone, cold time stated; (2)
Chromium and WebKit prove give → total up, refund → total back, XSS rows as text, 375 px; (3)
every error nginx itself generates on `/api` is the JSON envelope; (4) the submission documents
are complete and the security sweep has a number and a reason for every item.

Non-goals: S0 date filter and CSV, X1 (007, 008, only with time left); fixing the Known issues
below; any API contract change; X4. Recording the video, the zip and the email are the user's.

## User stories and acceptance criteria

Tests: e2e `e2e/{public,donate,refund,xss,session}.spec.ts`; web `test/lint-rules.test.ts`; CI
`stack` steps *nginx errors*, *sessions*, *payment outcomes*, *rate limits*; [`checklist.md`](checklist.md).

### US-1 — The reviewer runs it (cat. 1, M7)
- **Given** a fresh clone of the pushed fork, `docker compose down -v`, `docker builder prune
  -af` and no `node_modules`, **when** the README's commands run word for word, **then** all
  three services are healthy, `:3000` shows $43,058.00 raised by 46 donors, and the timed cold
  build is in the README. *(checklist › It runs)*

### US-2 — Hostile text stays text (M6, cat. 3, cat. 4)
- **Given** receipts 9 and 10's message strings in the public list response, **when** the page
  renders, **then** both show as literal text, no `img[src="x"]` exists and no dialog opens, in
  Chromium and WebKit. *(xss › "public list")*
- **Given** an admin searching `Magar`, then `Tamang`, **then** both rows render and no dialog
  opens; **and given** a gift whose donor name is `<img src=x onerror=alert(1)>`, **then** the
  admin table and the public list show it as text. *(xss › "admin table", refund)* The admin
  table has no message column, so the donor name is the hostile field it can show.
- **Given** `:innerHTML`, `v-bind:innerHTML.prop`, `:outerHTML` or `v-bind="{ innerHTML }"` in a
  template, or web source setting `innerHTML`/`outerHTML` or calling `insertAdjacentHTML`/
  `document.write`, **then** lint errors; `{{ m }}`, `:title`, `textContent` pass and `toFixed`
  still errors. *(lint-rules)*

### US-3 — The core flows in a real browser (M3, M4, M5, M8)
- **Given** the campaign page, **when** a visitor gives $21 with `tok_ok` under a unique name,
  **then** the confirmation shows an `HCC-` receipt, and after a reload the name is listed and
  the API total is exactly 2,100 cents higher. *(donate)*
- **Given** such a gift, **when** the admin signs in through the login page, finds it and refunds
  it with a reason, **then** the row shows refunded, the public total is back to its pre-gift
  value, and the name is gone from the list. *(refund)*
- **Given** 375 × 667, **then** the public page and the open form have no horizontal scroll, and
  no page in the run reports a CSP violation. *(public)*
- **Given** a session cookie replaced by 43 random base64url characters, **when** `/me` opens,
  **then** the browser lands on `/login`. *(session)*

### US-4 — Errors through nginx are JSON (M6 §7, spec 003 US-5)
- **Given** `GET :3000/api/campaigns/%E0%A4%A`, **then** 400, `application/json`, and a body
  byte-identical to the API's own `bad_request` on `:4000`; **given** a 100 kB body to `POST
  :3000/api/donations`, **then** 413, byte-identical to the API's `payload_too_large`. *(nginx errors)*

### US-5 — Sessions, limits and payments against the stack (M4, M6, S4)
- **Given** a donor session whose row is set to expire a second ago, **then** `/api/auth/me` is
  401 `unauthenticated` (200 just before); a forged cookie is 401. *(sessions)*
- **Given** `tok_decline` → 402 `card_declined`; `tok_timeout` → 202 `pending` within
  `PAYMENT_TIMEOUT_MS` + 3 s. *(payment outcomes)*
- **Given** repeated logins, **then** 429 `rate_limited` with `Retry-After` within 21 attempts;
  donations within 31. Runs last. *(rate limits)*

### US-6 — Security sweep (M6, cat. 4, cat. 5)
- **Given** `npm audit --omit=dev`, **then** the README states the count and a reason for each
  advisory left; the CHECKLIST grep and gitleaks over all history find no real credential and
  each grep hit is a named fixture; tech spec §6's header and docs/07 rows hold, or each fix is
  its own task. *(checklist › Security)*

### US-7 — Documentation and delivery (M9, cat. 5, cat. 6)
- **Given** the root README, **then** it has docs/03's sections in order, demo accounts, the
  expected numbers, which tests pass, Decisions, Known issues, API reference, the fork route,
  time spent and the video link. `AI-USAGE.md` names every AI tool, the share of work, at least
  four changes the user made to agent output, and what agents were kept from. The `qa-verifier`
  run leaves every CHECKLIST item pass or n/a with evidence. *(checklist › Documentation)*

**Known issues the README lists:** pending donations never reconciled (the mock has no lookup;
admins filter `pending`) · no lockout across many addresses on one account (a lockout lets
anyone lock the admin out) · signing in as B over A's cookie leaves A's row valid until expiry ·
name search scans `donations` sequentially (a `UNION` fixes it) · a refund racing intake's
outcome write is a 409 `not_refundable`, retry works · an undecodable `:id` is Express's 400,
not F12's 404 · `/me/donations` stops at 100 · in-memory limiters, one bucket per Docker Desktop
host · macOS arm64 not rehearsed · plus what T5, T7 and T11 find (WebKit cookies, nginx 400).

## Traceability

| Requirement / rubric item | Story | Task |
|---|---|---|
| Cat. 1, M7: clean clone, cold time, non-root | US-1 | T10, T11 |
| M6 escaped output · cat. 4 XSS (2) · cat. 3 XSS rows | US-2 | T1, T4, T5 |
| M8 e2e "land, donate, see it" · cat. 3 tests | US-3 | T4, T5, T6 |
| M6 errors leak nothing; spec 003 US-5 through nginx | US-4 | T2 |
| M4 decline/timeout · M6 sessions · S4 limits, end to end | US-5 | T3 |
| M6 secrets, audit, headers · cat. 4 secrets (1) · cat. 5 comments | US-6 | T7 |
| M9, cat. 5 README, Decisions, Known issues, AI-USAGE | US-7 | T8, T9, T11 |
| Cat. 6 video · CHECKLIST Delivery | US-7 | T12, T13 |
| Forward notes: `:innerHTML`, nginx 400, 375 px, shared bucket | US-2–5 | T1–T5 |

Not covered: S0 (CHECKLIST's CSV rows are n/a); the clarification email.

## Decisions to approve

G1–G12 are in tech spec §10. **These change an earlier decision:** **G2** nginx answers every
400 it generates with the JSON envelope, SPA paths included (the URI fails before any `location`
is chosen). **G7** compose forwards `DONATION_RATE_LIMIT` and `LOGIN_RATE_LIMIT`, same defaults
(004 said it does not). **G10** if WebKit drops the `Secure` cookie on `http://localhost`, its
login specs are `fixme` and the README gives `COOKIE_SECURE=false`; the default stays `true`.
**Budget** about 6 h 50 against the overview's 1 h 15 (cut order in `tasks.md`).

## Open questions (blocking)

- **Time:** hours spent so far, and how much of the 48-hour clock is left? This sets the cut
  line, and the README states the hours.
- **AI tools:** anything besides Claude Code (a `.git/cursor` index exists; any chat assistant)?
- **Video outline and interview questions:** commit them here, or keep them private?
- **Clarification email:** send it now, or drop it and rely on the README's Decisions?
