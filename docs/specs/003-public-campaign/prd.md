# PRD 003 — Public campaign page and recent donations

Status: approved · Parent: [000 overview](../000-overview/prd.md) ·
Depends on: [002 data and money](../002-data-and-money/prd.md)

## Problem and context

The seed is in the database, but nothing outside it can read the data yet. M3 is the page a
visitor lands on from a fundraising email, on a phone: title, story, goal, total raised,
donor count, progress, and the latest gifts. Two rubric checks are made here with `curl`
and a browser: an anonymous donor's name must be **absent from the API payload**, and the
two seeded XSS payloads must render as text. A wrong total ($43,109 because a refund
counts) or a leaked name is the defect the seed exists to catch.

## Goals

1. `GET /api/campaigns/:slug` returns the campaign with `raisedCents`, `donorCount` and
   `progressPercent` derived from completed donations at read time, never stored.
2. `GET /api/campaigns/:slug/donations?limit=` returns the latest completed donations
   through one dedicated query that applies the privacy mode in SQL (ADR 0005). The full
   name of an anonymous or family donor never leaves the database.
3. A Vue page shows both, with loading, empty, error (with retry), not-found and closed
   states, readable at 375 px, with formatting only at the display edge.
4. The response contract (Zod schemas and DTO types) lives in `packages/shared`, and the
   web app validates every response against it. This is the first time both apps import
   the same schemas (M1).

## Non-goals

- The donation form, the donate button and the confirmation screens: spec 004. This spec
  renders no donate button and no placeholder for one (see US-4).
- Login, "my donations", the admin table: spec 005.
- Rate limiting the public GETs: not planned. They are index reads capped at 50 rows. The
  donation and login limits are specs 004 and 005.
- `trust proxy`: moved to spec 004 (decision D1 in the tech spec). Nothing reads `req.ip`
  until the rate limiter.
- Pagination of the public list ("recent" is the latest N, A6), live updates (S6), the
  Nepali toggle (S5), a full accessibility pass with axe (X3).
- The Playwright e2e (XSS in a real browser, no horizontal scroll at 375 px, no CSP
  violation): spec 006. This spec proves the same properties with component tests and a
  manual check, and says which is which.

## User stories and acceptance criteria

Test files: shared `packages/shared/test/campaigns.test.ts`; API unit
`apps/api/test/{campaign-phase,errors}.test.ts`; API integration
`apps/api/test/db/{campaign-api,public-donations}.test.ts`; web
`apps/web/test/{api,format,progress-bar,campaign-totals,donation-list,campaign-page}.test.ts`.

### US-1 — A visitor sees the right numbers (M3, cat. 4 money)
- **Given** the seed, **when** `GET /api/campaigns/aangan-courtyard`, **then**
  `raisedCents` is the number `4305800`, `donorCount` is `46`, `progressPercent` is `28`
  and `goalCents` is `15000000`. Annadaan: 286,900 / 11 / 7. Roof repair: 318,700 / 6 /
  15. *(campaign-api › "derives the seeded totals per campaign")*
- **Given** a completed donation, **when** its status is set to `refunded`, **then** the
  next read has a lower `raisedCents`, a `donorCount` one lower if it was that donor's only
  gift, and the item gone from the list. *(campaign-api › "a refund moves total and donor
  count"; public-donations › "a refunded row leaves the list")*
- **Given** a campaign whose only donations are refunded or failed, **when** it is read,
  **then** 200 with `raisedCents 0`, `donorCount 0`, `progressPercent 0`, not a 404.
  *(campaign-api › "an empty campaign reads 0, not 404")*
- **Given** a campaign at 115 % of its goal, **then** `progressPercent` is `115`; the bar
  is drawn full and the text reads 115 %. *(campaign-api › "progress is not capped";
  progress-bar › "caps the bar, not the number")*
- **Given** the page for Aangan, **then** it shows exactly `$43,058.00` raised of
  `$150,000.00`, `46 donors` and `28%`. *(campaign-totals › "formats the seeded Aangan
  totals")*

### US-2 — Privacy is enforced in the payload (M3, cat. 4 privacy, M8 bonus)
- **Given** the Aangan list (`limit=50`, all 49 completed rows), **when** the raw response
  text is searched, **then** it contains no donor email, no donor id, and no full name of
  an anonymous or family donor (except where the same name is also a public donor in the
  list). *(public-donations › "the raw JSON carries no PII for anonymous and family
  rows")*
- **Given** any item, **then** its keys are exactly `id, displayName, amountCents,
  dedication, message, createdAt`: identifying fields are absent, not null. *(public-donations
  › "items match the strict PublicDonation schema")*
- **Given** an anonymous row, **then** `displayName` is `"Anonymous"` and `dedication` and
  `message` are `null` (A3). Row 13's emoji message is not in the body. *(public-donations
  › "anonymous rows carry no dedication or message")*
- **Given** a family row by `Maya Gurung`, **then** `displayName` is `"The Gurung family"`.
  **Given** the names in tech spec §3.3, **then** each gives the listed display name, and a
  name with no clear surname gives `"Anonymous"`. *(public-donations › "family display
  names", table-driven)*
- **Given** refunded rows 7, 33, 36, 60, 61 and failed row 8, **then** none is in the list;
  the list holds 49 Aangan, 11 Annadaan and 6 roof-repair items. *(public-donations ›
  "only completed rows are listed")*

### US-3 — The list renders hostile and non-Latin text safely (M3, M6, cat. 3, cat. 4 XSS)
- **Given** the messages `<script>alert(1)</script>` and
  `<img src=x onerror="alert(document.cookie)">`, **when** the list renders, **then** the
  text appears literally and the DOM contains no `script` or `img` element.
  *(donation-list › "renders XSS payloads as text")*
- **Given** row 2, **then** `अनिशा गुरुङ`, `In memory of बुबा` and `सधैं सम्झनामा।` come back
  byte-identical from the API and render as such; an emoji message renders whole.
  *(public-donations › "Devanagari round-trips"; donation-list › "renders Devanagari and
  emoji")*
- **Given** row 14 (283 characters, A1), **then** the message is returned and rendered
  whole, never truncated. *(public-donations › "row 14 is whole"; donation-list › "long
  messages are not truncated")*
- **Given** a donation, **then** it shows a relative time ("2 months ago") with the exact
  time in a `<time datetime>` element. *(format › "relativeTime boundaries"; donation-list ›
  "shows relative time")*

### US-4 — The page handles every state (M3)
- **Given** a pending request, **then** a loading message is shown in a `role="status"`
  region. *(campaign-page › "loading")*
- **Given** a campaign with no listed donations, **then** totals read $0.00, 0 donors and
  0% (never `NaN%`), and the list shows an empty-state sentence. *(campaign-page › "empty
  campaign")*
- **Given** the API answers 500, returns HTML, or the network fails, **then** an error
  message with a Retry button is shown; Retry reloads and renders the campaign.
  *(campaign-page › "error then retry")*
- **Given** an unknown slug, **then** a "campaign not found" message with a link to the
  main campaign, and no Retry. *(campaign-page › "not found")*
- **Given** a closed campaign (`phase: "closed"`), **then** a notice says it no longer
  accepts donations. Spec 004 adds the donate button only for `phase: "open"`.
  *(campaign-page › "closed campaign")*
- **Given** the visitor switches campaign while a request is in flight, **then** the page
  never shows the first campaign's late response. *(campaign-page › "ignores a stale
  response")*

### US-5 — Bad requests get the error envelope (M6, cat. 4 validation)
- **Given** an unknown or malformed slug (`nope`, `Aangan_Courtyard`, 200 characters),
  **then** 404 `not_found` on both endpoints. *(campaign-api › "404 for unknown and
  malformed slugs"; public-donations › "404 for an unknown slug")*
- **Given** `limit` of `0`, `51`, `-1`, `1.5`, `abc`, empty, repeated, or an unknown query
  key, **then** 422 `validation_failed` with `details: [{ field, issue }]` and no stack or
  SQL. `1` and `50` are accepted; no `limit` gives 20. *(public-donations › "limit
  boundaries")*
- **Given** `GET /api/campaigns/%E0%A4%A` (an undecodable parameter), **then** 400
  `bad_request`, not 500, and nothing logged at error level. *(errors › "undecodable URL
  parameter")*

### US-6 — Usable on a phone (M3)
- **Given** a 375 px viewport, **then** the page has no horizontal scroll, including row
  14 and long unbroken strings. *Manual check in T6 (recorded in tasks.md); automated in
  spec 006's e2e.*
- **Given** a screen reader, **then** the progress bar exposes `role="progressbar"`,
  `aria-valuenow` (capped at 100) and an `aria-valuetext` with the amounts, so progress is
  never conveyed by colour alone. *(progress-bar › "accessible values")*

## Traceability

| Requirement / rubric item | User story | Task |
|---|---|---|
| M3 title, story, goal, total raised, donor count, progress with % | US-1 | T2, T5, T6 |
| M3 list: display name, amount, dedication line, relative time | US-2, US-3 | T3, T4, T5 |
| M3 privacy modes enforced server-side (anonymous absent, family surname) | US-2 | T3 |
| M3 refunded donations not shown, not counted | US-1, US-2 | T2, T3 |
| M3 empty, loading, error states; no `NaN%` | US-4 | T5, T6 |
| M3 works at 375 px | US-6 | T6 (manual), 006 (e2e) |
| M1 shared package imported by both apps (schemas, DTO types, `formatCents`) | Goal 4 | T1, T4 |
| M6 / cat. 4 privacy in the payload (3 pts) | US-2 | T3 |
| M6 / cat. 4 output escaped (2 pts) | US-3 | T5 (component); e2e in 006 |
| M6 / cat. 4 money as integer cents (3 pts): `::bigint`, format at the edge | US-1 | T2, T5 |
| M6 / cat. 4 input validated with a schema (2 pts) | US-5 | T1, T2, T3 |
| M6 / cat. 4 parameterised queries (1 pt): fixed `ORDER BY`, bound values | US-2 | T3 |
| M6 errors leak nothing | US-5 | T2, T3 |
| M8 bonus: anonymous payload test | US-2 | T3 |
| M8 refund test (read half: total, count and list move together) | US-1 | T2, T3 (endpoint in 005) |
| Cat. 3 awkward input: XSS as text, 0% not `NaN%`, Devanagari | US-3, US-4 | T3, T5, T6 |
| DATA-MODEL rule 5 (privacy applied where fetched) | US-2 | T3 |
| CI smoke from tech spec 000 §13 (`raisedCents`, no email in the list) | US-1, US-2 | T7 |

Not covered here, by design: the XSS payloads in the admin table and CSV (005, 007), the
e2e and the 375 px automated check (006), the refund endpoint itself (005). Every C-series
decision below needs a line in the README *Decisions* section (006).

## Assumptions

Inherited from PRD 000: A1 (row 14 shown whole), A2 (`donorCount` = distinct donors with a
completed gift), A3 (anonymous rows withhold dedication and message), A6 (recent = latest
N, default 20, max 50), A8 (closed campaigns reject donations), A10, A12. **A5 is refined
by C1**, which needs your approval. Local to this spec (C, so it doesn't collide with spec
002's B1–B4):

- **C1 — Family surname (refines A5).** If the name has a comma, the surname is the last
  word before the first comma (`Shrestha, Bijay "BJ"` → Shrestha). Otherwise it is the
  last word, but only if there are at least two words. A single word can't be told apart
  from a given name, so it shows `"Anonymous"`: family mode exists to hide the given name,
  so we err towards hiding. Never more than one word leaves the database.
- **C2 — Dedication line** only when both type and name are present. Row 71 (type, no
  name) gets `dedication: null`; "In honor of" with no name is meaningless.
- **C3 — Only `completed` counts.** `pending` (spec 004 timeouts), `failed` and `refunded`
  are excluded from the total, the donor count and the list.
- **C4 — Phase.** `phase` is `closed` if `is_active` is false or `now > ends_at`;
  `upcoming` if `now < starts_at`; otherwise `open`. Both ends inclusive; null dates are
  open-ended. Spec 004 accepts donations only when `open`, through the same function.
- **C5 — Dates.** Campaign start and end are shown as UTC calendar days: they are authored
  as UTC day boundaries, and Chicago would show Aangan's 1 August start as 31 July. Donation
  times are relative, computed in the browser, with the exact local time in a tooltip.
- **C6 — A malformed slug is a 404**, the same as an unknown one: from outside, no campaign
  lives at that URL. Zod still rejects it before any query.
- **C7 — `/` shows `aangan-courtyard`;** other campaigns live at `/campaigns/:slug`,
  mirroring the API path.
- **C8 — Seed data mismatch.** The seed README and the roof-repair story call it "already
  past its goal", but its completed gifts total 318,700 cents of 2,000,000 (15%). We show
  the data. The over-goal path is tested with a synthetic campaign (Q6).
- **C9 — Emoji.** The only seeded emoji (row 13) is on an anonymous row, so A3 hides it.
  Emoji rendering is proven by a component test, not by the seed.

## Open questions

- **Q6 (for the clarification email, not blocking):** roof-repair is described as past its
  goal, but the data says 15%. Is the goal or the data wrong?
- **For your approval (blocking):** C1's single-word rule changes A5 (and ADR 0005's
  consequence line). T3 updates both with a pointer here.
