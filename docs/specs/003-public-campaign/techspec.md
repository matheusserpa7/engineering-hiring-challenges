# Tech Spec 003 — Public campaign page and recent donations

Status: approved · Implements [`prd.md`](prd.md) · Inherits tech spec 000
§3 (money), §5 (API contract), §7 (privacy in the query), §9 (CSP), ADR 0002 and ADR 0005,
and spec 002's pool, schema and seed.

## 1. Approach and affected components

Two read-only endpoints and one page. The API follows `http → services → repositories`;
the public list is its own repository file so a reviewer can see the whole privacy surface
in one place.

```
packages/shared/src/campaigns.ts       CampaignSlugSchema, RecentDonationsQuerySchema,
                                       PublicCampaignSchema, PublicDonationSchema,
                                       PublicDonationListSchema, inferred types
packages/shared/src/errors.ts          + 'validation_failed'
apps/api/src/repositories/campaigns.ts         findCampaignWithTotals, findCampaignId
apps/api/src/repositories/public-donations.ts  listPublicDonations (the privacy projection)
apps/api/src/services/campaigns.ts     getPublicCampaign, listRecentDonations, campaignPhase
apps/api/src/http/campaigns.ts         the two routes: parse, call the service, respond
apps/api/src/http/validate.ts          parseQuery(schema, value) → value or 422
apps/api/src/app.ts, start.ts          AppDeps gains db and now; mount the router
apps/web/src/api.ts                    getJson(path, schema, { signal })
apps/web/src/format.ts                 relativeTime, formatCampaignDate, donorCountLabel
apps/web/src/components/{progress-bar,campaign-totals,donation-list}.vue
apps/web/src/composables/use-campaign.ts       loads both resources, retry, stale guard
apps/web/src/views/{campaign-page,not-found-page}.vue
apps/web/src/router.ts, main.ts, App.vue       vue-router
apps/web/vite.config.ts                jsdom test env; build.assetsInlineLimit 0
.github/workflows/ci.yml               stack smoke on the public API
```

New dependencies: `vue-router` (web), and dev-only `@vue/test-utils` and `jsdom` (web).
No new API dependency. No migration: the index
`donations (campaign_id, status, created_at desc)` from 0001 serves both queries.

## 2. API contract

Both routes are public, ignore cookies, and answer JSON with the shared error envelope.

### 2.1 `GET /api/campaigns/:slug`

`200`:

```json
{
  "id": "…", "slug": "aangan-courtyard", "title": "Aangan — Courtyard Restoration",
  "story": "…", "currency": "USD",
  "goalCents": 15000000, "raisedCents": 4305800, "donorCount": 46, "progressPercent": 28,
  "presetCents": [2100, 5100, 10100, 50100, 100100], "minCents": 100, "maxCents": 2500000,
  "isActive": true, "phase": "open",
  "startsAt": "2026-08-01T00:00:00.000Z", "endsAt": "2026-12-31T23:59:59.000Z"
}
```

- `raisedCents`, `donorCount`: completed donations only (C3), derived per request.
- `progressPercent`: the shared `progressPercent` (integer, floored, uncapped, 0 for an empty
  campaign). Computed once on the server so `curl` and the page agree.
- `isActive` is the stored switch, kept because the suggested contract has it. `phase`
  (`upcoming | open | closed`, C4) is what the page and spec 004 act on, so no client
  repeats the date comparison.
- `presetCents`, `minCents`, `maxCents` have no reader until spec 004; they are in the
  000 contract for this endpoint, so the response is defined once.

Errors: `404 not_found` (unknown or malformed slug, C6) · `400 bad_request` (undecodable
parameter) · `500 internal_error`.

### 2.2 `GET /api/campaigns/:slug/donations?limit=`

`200`: `{ "data": PublicDonation[] }`, newest first.

```json
{ "id": "…", "displayName": "The Gurung family", "amountCents": 5100,
  "dedication": { "type": "in_honor_of", "name": "Hajurama" }, "message": null,
  "createdAt": "2026-08-02T12:20:00.000Z" }
```

- `limit`: optional, default 20, integer 1–50 (A6).
- Errors: `404 not_found` (unknown or malformed slug) · `422 validation_failed` (bad
  `limit`, a repeated `limit`, any unknown query key) · `400` · `500`.
- 422 body, following the suggested contract:
  `{ "error": { "code": "validation_failed", "message": "The query is invalid.",
  "details": [{ "field": "limit", "issue": "too_big" }] } }`. `issue` is the Zod issue
  code; Zod's message is not sent, so a future custom message can't echo input.

### 2.3 Cross-cutting, per endpoint

| Concern | `GET /campaigns/:slug` | `GET /campaigns/:slug/donations` |
|---|---|---|
| Concurrency | One statement, so totals and donor count come from one snapshot and can't disagree. No write, so no lock. | Two reads (slug → id, then the list); campaigns are never deleted, so nothing can change between them. The page's two requests can straddle a new donation; accepted, the next read converges. |
| Idempotency | Safe GET; not applicable. | Same. |
| Authorisation | Public by design. No session is read. | Public. The SQL projection *is* the control: it never selects `email`, `donor_id` or a raw name for a non-public row (ADR 0005). |
| Validation | Slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars, before any query; failure → 404. | Slug as left. Query: `.strict()` object, `limit` matched as `^\d{1,3}$` then 1–50. No `z.coerce`: it turns `""` into 0 and `"1e1"` into 10. |
| Errors | `AppError(404)`; DB failure → generic 500, logged with the request id; the `err` serializer drops row data. | Same, plus 422. |
| Caching | `Cache-Control: no-cache` and Express's default weak ETag: a browser revalidates every time (a new donor must see their gift on the next read) and gets a 304 when nothing changed. No server cache; the query is an index scan. | Same. |
| Logging | pino-http logs method, path, status and request id. The path holds a slug and a limit, no PII. No body logging. | Same. |
| Rate limit | Not in scope (§8, D3). | Same. |

## 3. Queries

### 3.1 Campaign with totals (`repositories/campaigns.ts`)

```sql
SELECT c.id, c.slug, c.title, c.story, c.currency, c.goal_cents, c.min_cents, c.max_cents,
       c.preset_cents, c.is_active, c.starts_at, c.ends_at,
       coalesce(sum(d.amount_cents), 0)::bigint AS raised_cents,
       count(DISTINCT d.donor_id)               AS donor_count
FROM campaigns c
LEFT JOIN donations d ON d.campaign_id = c.id AND d.status = 'completed'
WHERE c.slug = $1
GROUP BY c.id
```

- **The status filter sits in the `JOIN`, not the `WHERE`.** In the `WHERE` it turns the
  outer join into an inner one, and an empty campaign returns no row, which reads as a 404.
  The empty-campaign test exists for this.
- `SUM(bigint)` is `numeric`, which the pool leaves as a string, so the `::bigint` cast is
  required (spec 002 forward note). `count()` is already `bigint`, so it arrives as a safe
  number.
- `donorCount` counts distinct `donor_id`s (A2): Arjun's two gifts (rows 11–12) are one
  donor, so Aangan has 49 completed gifts and 46 donors. A refund lowers it only if it was
  that donor's last completed gift here.

### 3.2 Public list (`repositories/public-donations.ts`)

```sql
SELECT d.id,
       <display_name>                                                         AS display_name,
       d.amount_cents,
       CASE WHEN <shows_dedication> THEN d.dedication_type END                AS dedication_type,
       CASE WHEN <shows_dedication> THEN d.dedication_name END                AS dedication_name,
       CASE WHEN d.privacy_mode IN ('public', 'family') THEN d.message END    AS message,
       d.created_at
FROM donations d
WHERE d.campaign_id = $1 AND d.status = 'completed'
ORDER BY d.created_at DESC, d.id DESC
LIMIT $2
```

- `<shows_dedication>` = `d.privacy_mode IN ('public','family') AND d.dedication_type IS
  NOT NULL AND d.dedication_name IS NOT NULL` (A3, C2).
- Modes are matched by allow-list (`IN ('public','family')`), so an unknown future mode
  fails closed to "Anonymous" with nothing else shown.
- The select list is explicit; no `selectAll` in this file. TypeScript maps the flat row to
  the DTO (`dedication` object, `createdAt.toISOString()`); every privacy decision has
  already been made in SQL.
- Order: newest first, `id desc` breaks ties on equal timestamps so the order is
  deterministic (000 §7). Both are fixed; nothing from the request reaches `ORDER BY`.
  `limit` is a bound parameter.

### 3.3 Display name (C1)

```sql
CASE d.privacy_mode
  WHEN 'public' THEN d.donor_name
  WHEN 'family' THEN coalesce('The ' || <surname> || ' family', 'Anonymous')
  ELSE 'Anonymous'
END

<surname> =
  CASE WHEN strpos(d.donor_name, ',') > 0
    THEN substring(split_part(d.donor_name, ',', 1) FROM '([^[:space:]]+)[[:space:]]*$')
    ELSE substring(d.donor_name FROM '[^[:space:]][[:space:]]+([^[:space:]]+)[[:space:]]*$')
  END
```

A failed match is `NULL`, `'The ' || NULL` is `NULL`, and `coalesce` turns it into
"Anonymous". The fragment is exported from `public-donations.ts` as a Kysely `sql` builder
taking the two column expressions, so the test can evaluate it on literal inputs without
inserting rows.

| `donor_name` (family) | `displayName` | Why |
|---|---|---|
| `Maya Gurung` | The Gurung family | The brief's example |
| `Shrestha, Bijay "BJ"` | The Shrestha family | "Surname, Given": last word would be `"BJ"` |
| `Martin Luther King, Jr.` | The King family | Comma rule, last word before the comma |
| `अनिशा गुरुङ` | The गुरुङ family | Devanagari words split on spaces like Latin |
| `  Maya   Gurung  ` / `Maya\tGurung` | The Gurung family | Untrimmed seed input, tabs |
| `Other Donor` (seed row 23) | The Donor family | The rule applied literally |
| `Maya` | Anonymous | One word could be a given name (C1) |
| `, Maya` / ` ` | Anonymous | No surname to derive |

Rejected: deriving the surname in TypeScript. It needs the full name in the API process,
one serialiser change from a leak (ADR 0005).

## 4. Shared contract (`packages/shared/src/campaigns.ts`)

- `CampaignSlugSchema`: the regex and length in §2.3.
- `RecentDonationsQuerySchema`: `z.object({ limit: z.string().regex(/^\d{1,3}$/)
  .transform(Number).pipe(z.number().int().min(1).max(50)).optional() }).strict()`, with
  `DEFAULT_RECENT_DONATIONS = 20` and `MAX_RECENT_DONATIONS = 50` exported. Express 5's
  query parser gives an array for a repeated key, which fails the string check.
- `PublicDonationListSchema` (`.strict()`): `{ data: PublicDonation[] }`, the body of the list.
- `PublicDonationSchema` (`.strict()`): `id` uuid, `displayName` string, `amountCents`
  `AmountCentsSchema`, `dedication` `{ type: enum, name: string } | null`, `message`
  `string | null`, `createdAt` ISO datetime.
- `PublicCampaignSchema` (`.strict()`): the §2.1 fields; cents fields are safe integers;
  dates are ISO or `null`; `phase` is an enum.
- Types are `z.infer` of the schemas, so the API's mapper and the web's components share
  one definition. `.strict()` on the response schemas makes the web reject a payload that
  gains a field, and lets the API test assert "no extra keys" with the same schema.

## 5. API wiring

- `AppDeps` becomes `{ logger, pingDb, db, now = () => new Date() }`. `createApp` is the
  composition root: it passes `db` and `now` to the service and mounts the router. Tests
  inject a fixed clock; unit tests that never query (errors, health) pass a `db` over a pool
  that never connects (`pg.Pool` connects lazily).
- `campaignPhase(campaign, now)` is a pure function in `services/campaigns.ts`: the only
  business rule in this spec, unit-tested at the boundaries, and imported by spec 004's
  intake. Comparing instants is zone-free; no calendar maths happens on the server.
- `http/campaigns.ts`: `CampaignSlugSchema.safeParse(req.params.slug)` → 404 on failure;
  `parseQuery(RecentDonationsQuerySchema, req.query)` → 422; then the service; then
  `res.set('Cache-Control', 'no-cache').json(…)`.
- `http/validate.ts`: `parseQuery` maps Zod issues to `[{ field: path.join('.'), issue:
  code }]`. Two callers now, and the body validation in specs 004 and 005.
- An undecodable `%E0%A4%A` is rejected by Express's router (status 400) before the
  handler; the spec 001 error handler already maps it to `bad_request`. This spec adds the
  test that was waiting for a route with a parameter.

## 6. Web

### 6.1 Routes and data flow

- vue-router, history mode (nginx already falls back to `index.html`). `/` renders
  `campaign-page` with `slug: 'aangan-courtyard'`; `/campaigns/:slug` passes the param as a
  prop; anything else renders `not-found-page`. The slug is `encodeURIComponent`-ed into
  the API path.
- `use-campaign(slug)` fetches the campaign and `limit=20` donations in parallel, and
  exposes `state: loading | ready | not-found | error` and `retry()`. One combined state:
  the two calls are one page, and a half-rendered page would need two sets of states for no
  visitor benefit.
- Stale responses: a slug change aborts the previous `AbortController`, and a request
  counter drops any response that isn't the latest. The abort saves bandwidth; the counter
  is the guarantee.
- `getJson(path, schema, { signal })` parses with the shared Zod schema. A 2xx that fails
  the schema is `unexpected_response`: a contract drift shows the error state rather than
  rendering `undefined`.

### 6.2 Components and states

| Piece | Renders |
|---|---|
| `campaign-page` | `<h1>` title, story, totals, closed / upcoming notice, list. Loading (`role="status"`), error (`role="alert"`, a real `<button>` Retry), not found (link to `/`). Sets `document.title`. |
| `campaign-totals` | `formatCents(raised)` "raised of" `formatCents(goal)`, `donorCountLabel` (1 donor / 46 donors), the progress bar, and "Ends Dec 31, 2026" when open. |
| `progress-bar` | `role="progressbar"`, `aria-valuemin 0`, `aria-valuemax 100`, `aria-valuenow min(p, 100)`, `aria-valuetext "28% of goal: $43,058.00 of $150,000.00"`; visible text `28%`; fill width `min(p, 100)%` via a `:style` object. |
| `donation-list` | `<ul>` of items: display name, amount, "In honor of / In memory of {name}", message, `<time datetime=… title=…>` relative time. Empty: "No donations yet. Be the first to give." |

- Phase notices: `closed` → "This campaign is closed and no longer accepts donations.";
  `upcoming` → "Opens {date}". No date comparison in the client (C4). No donate button in
  this spec, open or closed; spec 004 adds it for `open` only and asserts its absence
  otherwise.
- Formatting only at the edge: `formatCents` from shared; `progressPercent` as received;
  `Intl.NumberFormat` for the donor count; `Intl.DateTimeFormat` with `timeZone: 'UTC'`
  for campaign dates (C5); `Intl.RelativeTimeFormat('en', { numeric: 'auto' })` for
  donations, with seconds < 60 (or a future time from clock skew) as "just now", and
  months as 30 days, floored so a gift never looks older than it is.
- Every string goes through `{{ }}`; `v-html` fails lint. The XSS test asserts on the DOM.

### 6.3 Layout, CSP, assets, accessibility

- 375 px: single column, `max-width: 40rem`, rem units, no fixed widths. Names and
  messages get `overflow-wrap: anywhere` (row 14, and any unbroken string); amounts
  `white-space: nowrap`. System font stack, which carries Devanagari on phones; no web font.
- CSP stays `default-src 'self'` (nginx, spec 001). Vue's compiled templates need no
  `unsafe-eval`. SFC styles are extracted to a CSS file. The bar width is set through a
  `:style` object, which Vue applies via the CSSOM (`el.style[...]`); CSP governs `style`
  attributes in markup, not CSSOM writes, so no `unsafe-inline` is needed.
- `build.assetsInlineLimit: 0`: this spec ships no image or font, but Vite would inline the
  first one under 4 kB as a `data:` URL, which works in dev and is blocked only behind
  nginx. Closing the trap now costs one line; loosening the CSP with `img-src data:` was
  rejected.
- Accessibility basics, not X3: headings in order, sections labelled by their headings,
  live regions for loading and errors, a keyboard-reachable Retry, text contrast checked
  by eye against AA.

## 7. Test plan

| Test | Type | Proves |
|---|---|---|
| `packages/shared/test/campaigns.test.ts` | Unit | Slug accepts `aangan-courtyard`, rejects `Aangan`, `a_b`, `../x`, `''`, 65 chars. Query: absent → no limit; `'1'`, `'50'` ok; `'0'`, `'51'`, `'-1'`, `'1.5'`, `'abc'`, `''`, `' 5'`, `['1','2']`, an unknown key rejected. `PublicDonationSchema` rejects an extra `donorName` / `email` key, accepts null dedication and message. `PublicCampaignSchema` accepts a null `endsAt`. `isApiErrorBody` accepts `validation_failed`. |
| `apps/api/test/campaign-phase.test.ts` | Unit | Inactive → closed; `now` 1 ms before `startsAt` → upcoming; exactly `startsAt` and exactly `endsAt` → open; 1 ms after `endsAt` → closed; null dates → open. |
| `apps/api/test/errors.test.ts` (one case) | Unit | `/api/campaigns/%E0%A4%A` → 400 `bad_request`, envelope only, no error-level log line. |
| `apps/api/test/db/campaign-api.test.ts` | Integration (Testcontainers, seeded via `runSeed`, fixed clock) | Seeded totals for all three campaigns (§PRD US-1), as numbers. Phases: Aangan and Annadaan open, roof closed. Annadaan `endsAt` null. An empty synthetic campaign (one refunded, one failed gift) → 200, 0 / 0 / 0. A synthetic over-goal campaign → 115. Refund flip of row 3 (Priya, sole gift) → 1,805,800 and 45; restored after. 404 for `nope`, `Aangan_Courtyard`, 200 chars. The raw body contains no `@`. `Cache-Control: no-cache`; a repeat with `If-None-Match` → 304. |
| `apps/api/test/db/public-donations.test.ts` | Integration | **Privacy payload:** raw text has no seeded email, no donor id, no full name of an anonymous or family donor (unless also public in the same list), not row 13's message. Every item passes `PublicDonationSchema` (strict: exact keys). Anonymous items: `Anonymous`, null dedication and message. Row 6 → The Gurung family. **Display-name table** (§3.3) on literals. **Exclusion:** ids of rows 7, 8, 33, 36, 60, 61 absent; counts 49 / 11 / 6. **Order:** first three are rows 75, 73, 71; two synthetic rows with one timestamp come back in `id desc`. **Limit:** none → 20, 1 → 1, 50 → 49; the PRD US-5 bad values → 422 with `details[0].field = 'limit'`. Unknown slug → 404. **Text:** row 2 byte-identical; row 14 is 283 code points; row 71 → `dedication: null`. Refund flip removes the item. |
| `apps/web/test/api.test.ts` (extended) | Unit | A valid body parses; a 2xx failing the schema → `unexpected_response`; the `signal` is passed to `fetch`; a 422 envelope keeps its code. |
| `apps/web/test/format.test.ts` | Unit | `relativeTime`: 59 s → just now; 1 min; 59 min; 1 h; 23 h; yesterday; 29 days; 1 month; 11 months; 1 year; future → just now. `formatCampaignDate('2026-08-01T00:00:00Z')` → Aug 1, 2026 under `TZ=America/Chicago` and `Asia/Kathmandu`. `donorCountLabel` 0, 1, 46, 1,234. |
| `apps/web/test/progress-bar.test.ts` | Component (jsdom) | 0 → `0%`, valuenow 0, never `NaN`; 28 → 28; 115 → text `115%`, valuenow 100, fill 100%; `aria-valuetext` names both amounts. |
| `apps/web/test/campaign-totals.test.ts` | Component | Aangan numbers → `$43,058.00`, `$150,000.00`, `46 donors`, `28%`; zero campaign → `$0.00`, `0 donors`, `0%`; null `endsAt` → no end line. |
| `apps/web/test/donation-list.test.ts` | Component | Both XSS payloads appear as literal text; no `script` or `img` in the DOM. Devanagari name, dedication and message render exactly; an emoji message renders whole. Row 14's 283-character message is present whole. Null dedication and message render nothing (no stray "In honor of"). `<time datetime>` carries the ISO value. Empty array → the empty-state sentence. |
| `apps/web/test/campaign-page.test.ts` | Component, `fetch` stubbed at the network boundary with contract-shaped JSON | Loading before resolve; ready; empty campaign → 0% and empty state; 500 → error, Retry → ready; HTML 200 → error; network rejection → error; 404 → not found, no Retry; `phase: closed` → closed notice; slug changed mid-flight, first response resolving last → second campaign shown; `document.title` is the campaign title. Assertions are on the DOM, never on the stub. |
| CI `stack` job (T7) | Smoke, compose stack through nginx `:3000` | `raisedCents` 4305800 and `donorCount` 46; the `limit=50` list contains no `@` and not `Ramesh Thapa` (row 5, anonymous). |

Not automated here: 375 px layout (no layout engine in jsdom: manual in T6, Playwright in
006); XSS and CSP in a real browser (006).

## 8. Decisions and alternatives

| Chosen | Rejected | Why |
|---|---|---|
| Privacy `CASE` in SQL, surname too | Surname in a TS function after the fetch | The full name would be in the API process; ADR 0005 |
| Single-word family name → "Anonymous" (C1) | "The {word} family" | One word may be the given name family mode hides; hiding is the safer error |
| Status filter in the `LEFT JOIN` | Filter in `WHERE` | Empty campaigns would vanish (404) |
| `progressPercent` from the server | Each client computes it | One number for `curl` and the page; same shared helper either way |
| `phase` enum from the server (C4) | `isActive` alone, client checks dates | Spec 004 and the page apply one rule; no client clock |
| Malformed slug → 404 (C6) | 422 | No campaign is at that URL; 422 would only teach the slug grammar |
| `no-cache` + ETag | `max-age=N` | A donor must see their gift on the next read; revalidation is cheap |
| Two endpoints, one combined page state | Embed donations in the campaign response | Matches the contract; the list keeps its own `limit` |
| jsdom for component tests | happy-dom | The reference implementation; speed is irrelevant at this test count |
| `assetsInlineLimit: 0` | `img-src data:` in the CSP | Keeps the CSP strict; the cost is a few extra requests |
| **D1:** `trust proxy` moves to spec 004 | Set it here | Nothing reads `req.ip` until the rate limiter, so a test here could only assert a setting. With `:4000` published, `1` still trusts a forged `X-Forwarded-For` sent straight to the API; 004 must decide with its limiter test |
| **D2:** CI smoke via `curl` now | Wait for 006 | Tech spec 000 §13 lists it; it catches a broken nginx → API path the unit tests can't |
| **D3:** no rate limit on public GETs | A limiter now | Bounded index reads; limits arrive with the endpoints that cost money (004) or CPU (005) |

## 9. Risks

| Risk | Mitigation |
|---|---|
| `[[:space:]]` for non-ASCII spaces depends on the database's libc locale (musl/glibc exclude U+00A0) | A name joined by a no-break space reads as one word and falls back to "Anonymous": safe, not a leak. Spec 004 normalises whitespace in names at intake |
| Last-word rule is wrong for surname-first names without a comma (`Gurung Maya` → The Maya family) | Known approximation (A5, ADR 0005); listed in Known issues. No surname field in the seed |
| `count(DISTINCT)` and `SUM` grow with the table | Index on `(campaign_id, status, …)`; fine to ~10⁶ rows. Revisit with counters (000 §14) |
| The page's two requests straddle a new donation | Accepted: the next read converges; S6 is out of scope |
| A contract drift between API and web | Both use the shared schemas; the web rejects an unknown key and shows the error state |
| 375 px is verified by hand only until 006 | Recorded in T6's notes; the 006 e2e asserts `scrollWidth ≤ clientWidth` |
| Synthetic test rows leak into seed assertions | They live in their own `test-*` campaigns; seed totals are asserted per slug |
| Budget: ~2 h 30 against the planned 1 h | See tasks.md; cut order listed there |
