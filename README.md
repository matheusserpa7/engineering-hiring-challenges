# HCC Aangan donation page

A donation page for the Himalaya Community Center's Aangan courtyard campaign, built for the
**Full-Stack Engineer** take-home: a public page with live totals and a donation form, a mock
payment provider, donor and admin sign-in, and admin refunds. The brief and rubric are in
[`roles/full-stack-engineer/`](roles/full-stack-engineer/README.md), which is left as received.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 24 | What the brief asks for; `engine-strict` keeps everyone on it |
| API | Express 5, TypeScript strict, Kysely + `pg`, Zod | Boring and defensible. Zod at every boundary, SQL written by hand where privacy and concurrency depend on it |
| Database | Postgres 16 | Row locks, unique constraints and `bigint` money, which is what the idempotency and refund rules need |
| Web | Vue 3 + Vite, served by nginx | The brief calls matching the client's Next.js a small advantage; Vue is faster for me, and the page is small |
| Shared | `packages/shared`: money, Zod schemas, DTO types, error codes | One contract for both apps, so they cannot drift |
| Tests | Vitest, Testcontainers (real Postgres), Playwright | No mocked database; a browser test for the XSS rows |

npm workspaces: `apps/api`, `apps/web`, `packages/shared`. Each has its own README.

## Run it

**Docker path**, the one to use:

```bash
cp .env.example .env
docker compose up --build
```

- Web: <http://localhost:3000>
- API: <http://localhost:4000/api/health>

The API migrates and seeds on start, so there is nothing else to run. A cold build, from a fresh
clone with the Docker build cache cleared and the base images pulled again, took **49 seconds** until
all three services were healthy (home broadband, Windows with Docker Desktop). Open the web URL and you
should land on **Aangan — Courtyard Restoration** showing **$43,058.00 raised of $150,000.00**,
**46 donors**, a progress bar at **28%**, and the 20 most recent gifts. The database holds 75
seeded donations; refunded and failed ones are not in the total, the count or the list.

**Local path**, for development (Node 24 and Docker for the database):

```bash
nvm use                        # or any Node 24
npm ci
cp .env.example .env
docker compose up -d db        # Postgres on localhost:5433
npm run db:migrate
npm run db:seed
npm run dev                    # shared watcher, API on :4000, Vite on :5173
```

Then open <http://localhost:5173>.

## Demo accounts

Fixtures, in plain text on purpose.

| Email | Password | Role |
|---|---|---|
| `admin@himalayacc.example` | `admin12345` | admin: lists every donation, refunds |
| `donor@himalayacc.example` | `donor12345` | donor: sees only their own 3 donations |
| `other@himalayacc.example` | `other12345` | donor: owns 2 donations, used to show that `donor@` gets a 404 for them |

In the donation form, the **Test card** select picks the mock provider's outcome: succeeds,
declined, insufficient funds, times out (the donation stays *pending*), or fails once and then
succeeds.

## Tests

```bash
npm run lint && npm run format:check && npm run typecheck
npm test               # needs Docker running: the API tests start Postgres with Testcontainers
npm run e2e            # needs the compose stack up and the browsers: npx playwright install chromium webkit
```

What runs today: **953 unit and integration tests pass** (shared 275, API 488, web 190), and
the browser suite has **12 tests, 10 passing and 2 skipped** (see Known issues). CI runs the
first group, then builds the stack and runs the smoke checks and the browser suite against it.

What the hard ones prove: the money boundaries ($0.99, $1.00, $25,000.00, $25,000.01) and
malformed input; the seed totals and the Unicode round trip; no personal data in the public JSON
for anonymous rows; 20 parallel identical donations make 1 row and 1 provider call; the same key
with another body is a 422; a donor reading another donor's donation gets a 404; a donor on an
admin route gets a 403; 20 concurrent refunds make exactly 1 succeed; the seeded XSS payloads
render as text in a real browser.

The e2e suite works on the live stack and never resets it. It reads totals as differences, and
its refund test refunds the gift it made, so it can run again. It uses 4 logins and 4 donations
a run, against limits of 20 per 15 minutes and 30 per 10 minutes. Raise them with
`LOGIN_RATE_LIMIT` and `DONATION_RATE_LIMIT` in `.env` if you run it often.

## Decisions and trade-offs

Each links to its record in [`docs/adr/`](docs/adr/).

- **Money is integer cents everywhere** ([ADR 0002](docs/adr/0002-money-integer-cents.md)):
  `bigint` columns, `amountCents` in the API, aggregates cast `::bigint`, formatting only at the
  display edge. `parseFloat` and `toFixed` fail lint.
- **A donation needs an `Idempotency-Key`, and its row exists before the charge**
  ([ADR 0003](docs/adr/0003-donation-idempotency.md)): a unique constraint makes a retry or a
  double click one row and one provider call. A provider timeout leaves the row `pending` and the
  answer 202, because the money may have moved; it is never marked failed.
- **Privacy and ownership live in the SQL** ([ADR 0005](docs/adr/0005-privacy-and-authz-in-sql.md)):
  the public list is its own query that builds the display name with a `CASE`, so an anonymous
  donor's name is never fetched. Ownership is in the `WHERE`, and a row that is not yours is a 404.
- **Opaque sessions in a Strict cookie** ([ADR 0004](docs/adr/0004-sessions.md)): 32 random bytes,
  only their SHA-256 stored, a fixed lifetime, scrypt for passwords, and an origin allow-list for
  state-changing requests. No `SESSION_SECRET` (the example env in `SETUP.md` lists one) because
  nothing is signed.
- **Totals are derived, never stored.** A refund flips the status and writes an audit row in one
  transaction, so every aggregate moves with it.
- **Imported rows are legacy data.** Row 14 has a 283-character message, row 71 a dedication type
  with no name, and closed-campaign gifts are dated after the campaign ended. All 75 are kept;
  rows with `source = 'import'` are exempt from the rules for new donations, instead of weakening
  the constraints for everyone.
- **API-CONTRACT deviations:** `message` is a top-level request field, not inside `dedication`
  (the seed has messages with no dedication); there is no registration endpoint, since the brief
  puts it out of scope.
- **Not built:** the CSV export (S0) and the stretch items. I preferred a smaller scope with every
  hard path tested to more features at 70%.

## Known issues

- **Pending donations are never reconciled.** The mock provider has no lookup, so an admin
  filters by `pending` and decides.
- **No lockout across many addresses on one account.** A lockout would let anyone lock the admin
  out, so login is limited per address instead.
- **Signing in as B over A's cookie** leaves A's session valid until it expires.
- **Name search scans `donations`.** A `UNION` of two indexed queries would fix it at this scale
  nobody needs.
- **A refund that races the outcome write of its own donation** answers 409 `not_refundable`;
  retrying works.
- **An undecodable `:id` on the API port** (`/api/donations/%E0%A4%A` on :4000) is Express's 400,
  not the 404 of a missing row. Through nginx it is the same 400 as JSON.
- **`/me/donations` stops at 100 rows**; the admin list pages by 25.
- **Rate limiters are in memory**, one bucket per Docker Desktop host, and reset on restart.
- **WebKit does not send the `Secure` session cookie over `http://localhost`.** The two e2e tests
  that sign in are skipped there. If a Safari reviewer cannot sign in, set `COOKIE_SECURE=false` in
  `.env` and run `docker compose up -d`.
- **WebKit reports the progress bar's inline width** to the CSP as `style-src-attr`, though it
  applies it. The e2e fixture ignores that one directive and asserts the bar's width instead.
- **macOS on Apple silicon was not run.** The base images are multi-arch and there are no native
  modules, but I did not try it.

## Security

- `npm audit --omit=dev`: 0 vulnerabilities. `gitleaks` over all 93 commits at the time: 3 findings,
  all one fixed test UUID used as an idempotency key.
- Responses: CSP, `nosniff` and a referrer policy from nginx; helmet on the API; no server
  version; both containers run as non-root users.
- Limits: 20 logins per 15 minutes and 30 donation attempts per 10 minutes per address, with
  `429` and `Retry-After`; request bodies over 16 kB are a JSON 413.
- Lint bans `v-html`, `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` in the
  web source; the browser tests check the seeded XSS payloads render as text.
- The evidence for each item is in
  [`checklist.md`](docs/specs/006-hardening-and-submission/checklist.md).

## API reference

Every error is `{ "error": { "code", "message", "details"? } }`. Routes are under `/api`.

| Route | Who | Answers |
|---|---|---|
| `GET /api/health` | anyone | 200 `{status:"ok"}`; 503 when the database does not answer |
| `GET /api/campaigns/:slug` | anyone | campaign with derived `raisedCents`, `donorCount`, `progressPercent`, `phase` |
| `GET /api/campaigns/:slug/donations?limit` | anyone | latest completed public gifts, 1 to 50, default 20; no email, id of a donor or name of an anonymous donor |
| `POST /api/donations` | anyone | needs `Idempotency-Key` (UUID). 201 receipt; 202 pending; 402 `card_declined` or `insufficient_funds`; 409 `request_in_progress`; 422 validation, `amount_out_of_range`, `campaign_closed`, `idempotency_key_mismatch`; 429; 502 `payment_provider_error` |
| `POST /api/auth/login` | anyone | 200 `{user}` and the cookie; 401 `invalid_credentials` (one body for a wrong password, an unknown email and a guest); 429 |
| `POST /api/auth/logout` | signed in | 204 |
| `GET /api/auth/me` | signed in | 200 `{user}`; 401 `unauthenticated` |
| `GET /api/me/donations` | signed in | the viewer's own donations, newest 100 |
| `GET /api/donations/:id` | owner or admin | 200; anyone else, and a missing or malformed id, get the same 404 |
| `GET /api/admin/donations?q&status&sort&dir&page&pageSize` | admin | a page of every donation with the donor email; `sort` and `dir` come from an allow-list; 403 for a donor |
| `POST /api/admin/donations/:id/refund` `{reason}` | admin | 200; 404 unknown; 409 `already_refunded` or `not_refundable` |

State-changing requests must come from an origin in `ALLOWED_ORIGINS`, or they are a 403
`origin_not_allowed`. Full details, status codes and the donation example are in
[`apps/api/README.md`](apps/api/README.md).

**Prove the idempotency yourself.** The reference `concurrency-burst.mjs` sends no
`Idempotency-Key`, so against this API it only gets 400s. Twenty parallel requests sharing one key:

```bash
key=$(node -p 'crypto.randomUUID()')
body='{"campaignSlug":"aangan-courtyard","amountCents":2100,"donor":{"fullName":"Burst Test","email":"burst@example.com"},"privacyMode":"public","paymentToken":"tok_ok"}'
for i in $(seq 20); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/donations \
    -H 'Content-Type: application/json' -H "Idempotency-Key: $key" -d "$body" &
done | sort | uniq -c
```

You should see one `201` and the rest `201` replays or `409`, never a second charge: check
`docker compose logs api | grep -c "donation processed"` goes up by one.

## Working with the fork

Fork, clone your fork, then follow *Run it*. CI (`.github/workflows/ci.yml`) runs on every push.
How the work was planned, with a PRD, tech spec and task list per step, is in
[`docs/specs/`](docs/specs/), and where it stands is in [`docs/PROGRESS.md`](docs/PROGRESS.md).
How AI was used is in [`AI-USAGE.md`](AI-USAGE.md).
