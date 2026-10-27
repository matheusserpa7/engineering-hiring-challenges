# Tech Spec 006 — Hardening and submission

Status: draft, awaiting approval · Implements [`prd.md`](prd.md) · Inherits 000 §9, §11–§13, ADR
0004, 003 US-5 (`bad_request`), 004's limiters, 005 §6 (middleware order), F5, F12, F14. **No
migration, no API contract change.** Runtime changes: `nginx.conf`, compose env, lint config.

## 1. Affected components

```
eslint.config.js                      HTML-injection bans (§2)
apps/web/test/lint-rules.test.ts      proves them (node environment)
apps/web/nginx.conf                   JSON 400 / 413 (§3)
docker-compose.yml, .env.example      forward the two rate limits (G7)
.github/workflows/ci.yml              stack steps (§4), e2e (§5)
package.json, package-lock.json       @playwright/test (root devDependency, G4); e2e, typecheck scripts
e2e/                                  playwright.config.ts, tsconfig.json, fixtures.ts, *.spec.ts, README.md
README.md, AI-USAGE.md                replace the challenge README (G1); new
apps/{api,web}/README.md, packages/shared/README.md   remove stale lines
docs/specs/006-hardening-and-submission/checklist.md  CHECKLIST evidence (G11)
```

## 2. Lint: no HTML injection (forward note from 005)

| Snippet | Rule | Result |
|---|---|---|
| `<p :innerHTML="m" />`, `<p v-bind:innerHTML.prop="m" />`, `<p :outerHTML="m" />` | `vue/no-restricted-v-bind` | error |
| `<p v-bind="{ innerHTML: m }" />` | `vue/no-restricted-syntax`, `Property[key.name=/^(inner\|outer)HTML$/]` | error |
| `el.innerHTML = m`, `el.outerHTML = m`, `el.insertAdjacentHTML(…)`, `document.write(m)` in `apps/web/src/**` | `no-restricted-properties` | error |
| `{{ m }}`, `:title="m"`, `el.textContent = m`; `x.toFixed(2)` | — ; money rule | pass ; error |

- The script ban is scoped to `apps/web/src/**`: component tests may read `innerHTML` to assert
  escaping. That block **repeats the money entries**, because a later `no-restricted-properties`
  replaces the earlier options for the files it matches; the last row proves it.
- The test lints strings through ESLint's Node API (`lintText` with a `filePath` under
  `apps/web/src/`) and asserts each rule id. Mutation: drop each entry; its rows must go red.

## 3. nginx: errors it generates are the envelope

```nginx
# server level: an undecodable escape fails URI parsing before any location is chosen (G2)
error_page 400 /_errors/400;
location = /_errors/400 {   # internal; a named location has no URI to redirect from
    default_type application/json;
    add_header X-Content-Type-Options "nosniff" always;
    return 400 '{"error":{"code":"bad_request","message":"The request could not be processed."}}';
}
location /api/ {
    client_max_body_size 64k;            # the API's own limit is 16 kB; no reason to buffer 1 MB
    error_page 413 /_errors/413;   # same pattern, the API's payload_too_large body
    …existing proxy lines…
}
```

- `proxy_intercept_errors` stays off, so the API's own 4xx/5xx pass through untouched;
  `error_page` only rewrites what nginx itself generates.
- The bodies copy `apps/api/src/http/errors.ts` byte for byte. CI compares them with the API's
  answer on `:4000` (`cmp`), so a changed message fails the build instead of drifting.
- 502/504 while the API is down stay nginx HTML: the web client already maps non-JSON to
  `unexpected_response` (optional list). An undecodable `:id` on `:4000` stays Express's 400
  (005 T4, accepted; Known issue).

## 4. Stack checks in CI (T3), and the rate budget

Steps added to the `stack` job, after *Login and ownership*, all through `:3000` unless noted:

- **nginx errors** (T2): the 400 and 413 of PRD US-4, each `cmp` with the API's answer on
  `:4000` (the 413 there via a route with no limiter, so the budget is untouched).
- **sessions**: log `donor@` in; forged 43-character cookie → 401; `/auth/me` → 200; then
  `UPDATE sessions SET expires_at = now() - interval '1 second'` for that donor through
  `docker compose exec db psql`; `/auth/me` → 401 `unauthenticated` (G9).
- **payment outcomes**: `tok_decline` → 402 `card_declined`; `tok_timeout` → 202 `pending`,
  `curl --max-time 8`.
- **e2e** (T6): Node from `.nvmrc`, `npm ci`, `npx playwright install --with-deps chromium
  webkit`, `npm run e2e`; `playwright-report/` uploaded on failure (action pinned by SHA).
- **rate limits**, last: wrong-password logins until 429 (cap 21), then key-less donation POSTs
  until 429 (cap 31; each is a 400 before any charge). Assert 429, `rate_limited`, `Retry-After`.

| Bucket (one per Docker Desktop host) | Limit | Used before the probe |
|---|---|---|
| Logins, 15 min | 20 | ownership 2 · sessions 1 · e2e 4 (2 per browser) = **7** |
| Donations, 10 min | 30 | intake 2 · payment outcomes 2 · e2e 4 = **8** |

A local `npm run e2e` uses 4 logins and 4 donations, so about five runs per 15 minutes; G7
lets a developer raise the limits. The `stack` job's timeout goes from 15 to 20 minutes.

## 5. End-to-end tests (T4, T5)

- `@playwright/test` is a root devDependency and `e2e/` a plain folder (G4). Root scripts:
  `"e2e": "npm run build:shared && playwright test -c e2e"`; `typecheck` adds `tsc -p e2e`.
  Lint already covers `e2e/**/*.ts` once `e2e/tsconfig.json` exists.
- Config: `baseURL` = `E2E_BASE_URL` or `http://localhost:3000` (an `ALLOWED_ORIGINS` entry);
  projects `chromium` and `webkit`; **`workers: 1`, `retries: 0`**; trace on failure.
- The suite runs against the compose stack and never resets it (G5). Tests assert **deltas**
  read from `/api/campaigns/aangan-courtyard`, never seed absolutes, and the refund spec refunds
  the gift it made itself, so a re-run passes and the seed totals return.
- `fixtures.ts`: a page fixture that fails on any `dialog`, and an init script that records
  `securitypolicyviolation` events; every spec asserts that list is empty at the end.
- The CSP assertion found a real, harmless violation on every load: Zod's JIT probe is a caught
  `new Function`, which nginx's CSP reports. Fixed in T4 by `z.config({ jitless: true })` in
  `apps/web/src/main.ts` (no contract change); the fixture stays strict.
- WebKit reports `style-src-attr` for the progress bar's CSSOM-set width but applies it (computed
  width checked). The fixture ignores that one directive; `public` asserts the bar's width, so a
  real block still fails. Known issue for the README. Every other directive stays fatal.
- Selectors are roles and labels. A missing accessible name gets a label in the component, in
  the same task; no `data-testid`.

| Spec | Steps | Asserts |
|---|---|---|
| `public` | 375 × 667; open `/`; open the form | total text = `formatCents(raisedCents)`; `scrollWidth ≤ 375` both times |
| `xss` › public list | `page.route` the list call: the real response plus receipts 9 and 10's message strings, copied from `donations.csv` | strings visible as text; `img[src="x"]` count 0 |
| `xss` › admin table | UI login as admin; search `Magar`, then `Tamang` | same strings as text; no `img[src="x"]` |
| `donate` | `$21` preset, name `E2E <browser> <ms>`, `tok_ok`, public | receipt `^HCC-\d{4}-\d{6,}$`; after reload the name is listed; API total +2,100 |
| `refund` | donate as above; UI login as admin; search the name; refund with a reason | row `refunded`; API total back to its pre-gift value; name gone |
| `session` | add cookie `aangan_session` = 43 random base64url chars; open `/me` | URL is `/login` |

Receipts 9 and 10 are the 42nd and 43rd newest completed Aangan gifts, so the public page (latest
20, A6) never shows them; that is why the public case injects them (G6). **WebKit:** if the
`Secure` cookie is dropped on `http://localhost`, the login specs fail on WebKit only; G10 applies.

## 6. Security sweep (T7)

| Check | Command | Passes when |
|---|---|---|
| Dependencies | `npm audit --omit=dev` | count recorded; `npm audit fix` (never `--force`) taken; each advisory left has a reason |
| History | CHECKLIST's `git log -p` grep; `gitleaks git` (Docker image, pinned) on all history | no real credential; each grep hit named (demo passwords, placeholders, tests) |
| Headers | `curl -sI` on `/`, `/login`, one `/assets/*.js`, `/api/health`, the nginx 400 | SPA: nginx CSP, `nosniff`, `Referrer-Policy`, no `Server` version · API: helmet CSP `default-src 'none'`, no `X-Powered-By` · errors: JSON, `nosniff` |
| Containers | `docker compose exec api id -u`, same for `web` | neither is 0 |
| docs/07 table | greps: `parseFloat\|toFixed`, float columns; `console\.`; `e(rr)?\.message` in `http/`; `getMonth\|new Date\(\)` in `services/`; `toLowerCase`; `as any\|: any`; `// Step\|robust\|seamless\|comprehensive\|leverag`; `TODO\|FIXME`; files over 500 lines | zero hits, or each hit justified in `checklist.md` |

A real secret in history **stops the task**: rewriting history is the user's decision. Any
code fix becomes its own task in `tasks.md` before it is made (CLAUDE.md step 5).

## 7. Documentation (T8, T9)

- **Root README** (docs/03 order, G1): what it is; stack and why (000 §1, shortened); run, both
  paths, both URLs, "what you should see" ($43,058.00, 46 donors, 28%, 75 donations), cold
  time; demo accounts; tests (commands, counts, Docker needed, e2e needs the stack and browsers,
  what passes); **Decisions** (6–8 bullets linking ADRs: integer cents, required key + pending
  row, privacy and ownership in SQL, opaque sessions, derived totals, legacy-import exemption,
  API-CONTRACT deviations, what was not built and why); **Known issues** (PRD list);
  **Security** (audit count, scan result, limits); **API reference** (one table, moved from
  `apps/api/README.md`, which links to it); how to prove idempotency with 20 parallel `curl`s
  sharing one key (the reference harness sends no key, so it gets 400s); fork route; time
  spent; video and `AI-USAGE.md` links.
- **Package READMEs:** drop "skeleton" and "arrives in spec 00x" lines; add `ALLOWED_ORIGINS`,
  `SESSION_TTL_HOURS`, `COOKIE_SECURE`, `LOGIN_RATE_LIMIT` to the API env table; web: pages,
  routes, nginx headers, the HTML-injection lint. `e2e/README.md`: browsers, budget, reset.
- **`AI-USAGE.md`** (docs/07 template): tools (Claude Code: main session Sonnet; subagents
  spec-writer Opus, test-writer, code-reviewer, qa-verifier Sonnet; anything else the user
  names); share of the work; how it was steered (`CLAUDE.md`, specs, hook, reviewer); at least
  four changes the **user** made, which the draft proposes from the task notes and the user
  confirms; what agents were kept away from.

## 8. Clean-clone rehearsal (T10) and QA (T11)

From Git Bash, with the working stack down: `docker compose down -v`, `docker builder prune
-af`, remove the three base images, `git clone <fork URL>` into a new folder, then the README's
block word for word, timed to "all healthy". Open both URLs in a private window. Then `npm ci`,
`npm run lint`, `npm test` in the clone, and `docker compose down -v`. Record both times (warm
images, cold images). This machine has `core.autocrlf=true`, so the clone also tests
`.gitattributes`. `qa-verifier` then runs every PRD 002–006 criterion and all of CHECKLIST,
plus what QA could not do before: login timing (3 unknown vs 3 wrong, medians), and 20
parallel same-key POSTs through nginx → one row, one `donation processed` log line, one
receipt. Results land in `checklist.md`.

## 9. Cross-cutting, per endpoint touched

| Concern | Answer |
|---|---|
| Concurrency | No endpoint logic changes. nginx returns fixed bytes. E2E is serial (`workers: 1`) because every spec reads and moves the same campaign total. |
| Idempotency | Each e2e gift uses the form's own per-attempt key; a re-run makes new gifts with new names. nginx errors are deterministic. |
| Authorisation | Unchanged. A 400/413 from nginx never reaches the API, so no guard is skipped: nothing past it runs. E2E signs in with the demo accounts only. |
| Validation | Unchanged; nginx caps `/api` bodies at 64 kB ahead of the API's 16 kB. |
| Errors | nginx's 400 and 413 become the shared envelope (§3). 502/504 stay HTML (optional). |

## 10. Decisions and alternatives

| # | Chosen | Rejected | Why |
|---|---|---|---|
| G1 | Our README replaces the challenge's at the root | A second README file | Reviewers open the root first; SUBMISSION.md says "replace or add"; the challenge stays upstream and in `roles/`, `docs/` |
| G2 | JSON for every nginx 400, all paths | `/api` only; HTML 400 as a Known issue | URI parsing fails before location matching; a broken SPA URL loses nothing by getting JSON |
| G3 | nginx 64 kB cap with a JSON 413 | Default 1 MB with HTML 413 | Matches the API's intent, keeps one error shape |
| G4 | `@playwright/test` at the root, `e2e/` not a workspace | Workspace; own lockfile | A workspace must be copied into both Dockerfiles for `npm ci`; a lockfile means a second install and lint gaps |
| G5 | Serial e2e on the live stack, deltas, self-made refund target | Reset the DB per test; absolute totals | A reset needs `docker exec` from tests; absolutes break after any earlier run |
| G6 | Public-page XSS via `page.route` with the seed's strings | Raise the public limit for tests | Rows 9–10 are older than the latest 20; the admin case uses the real rows |
| G7 | Compose forwards both rate limits, same defaults | Raise the defaults | QA bursts and repeated e2e need headroom; the reviewer's control is unchanged |
| G8 | CI stays on `.env.example` defaults, probes last | Raise limits in CI | CI is the reviewer's path; the budget table fits |
| G9 | Expire a session in CI by `UPDATE` through `psql` | A minutes-TTL setting; waiting | No config added for a test; exercises the real `expires_at > now()` lookup |
| G10 | WebKit login `fixme` + README fallback, if needed | Default `COOKIE_SECURE=false` | Chrome and Firefox accept `Secure` on localhost; weakening the default for one engine is backwards |
| G11 | `checklist.md` evidence in this folder | Tick `roles/…/CHECKLIST.md` | `roles/` is the challenge's material and stays unedited |
| G12 | gitleaks once, by hand | gitleaks in CI | One more moving part at the end; optional list |

## 11. Test plan

| Test | Type | Proves |
|---|---|---|
| `apps/web/test/lint-rules.test.ts` | Unit (ESLint API) | §2 table, including `toFixed` still banned in web source |
| CI *nginx errors* | Smoke, curl | US-4; red on today's image, byte-equal to the API |
| CI *sessions*, *payment outcomes*, *rate limits* | Smoke, curl + psql | US-5; each run once with a negative control (no `UPDATE` → still 200; limit raised → no 429) |
| `e2e/public`, `xss` | E2E, Chromium + WebKit | US-2, US-3 layout and CSP; red with `:innerHTML` in `donation-list.vue` or a 400 px fixed width |
| `e2e/donate`, `refund`, `session` | E2E, Chromium + WebKit | US-3; red with the refund form's submit removed; green twice in a row on one stack |
| `checklist.md` | Manual record | US-1, US-6, US-7 with commands and outputs |

## 12. Risks

| Risk | Mitigation |
|---|---|
| nginx ignores `error_page` for a request-line 400 | The CI step shows it at once; fallback is the Known issue (G2) |
| WebKit drops `Secure` cookies on `http://localhost` | G10; README names the variable |
| E2E flakes on the shared total or a rate bucket | Serial, deltas, budget table, no retries: a flake is a bug |
| Playwright adds 2–3 min to CI | Two browsers only; job timeout 20 min |
| A secret or a high advisory turns up | Stop and ask (secret); fix, pin or justify (advisory) |
| README drifts from the code | T10 follows it word for word; T11 checks the API table against `app.ts` |
| macOS arm64 is never run | Multi-arch base images, no native modules; Known issue |
| Time | Cut order in `tasks.md`; the README states the real hours |
