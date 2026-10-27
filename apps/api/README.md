# @aangan/api

Express 5 on Node 24, talking to Postgres through Kysely and `pg`. On start it migrates the
schema and seeds the campaign data, then serves a health check, the shared error envelope and
a graceful shutdown. Business endpoints arrive in specs 003–005.

```bash
npm run build:shared           # once, from the root: the API imports @aangan/shared from dist/
npm run dev -w apps/api        # tsx watch; reads ../../.env if it exists
npm test -w apps/api           # vitest + supertest; the db tests need Docker (Testcontainers)
npx vitest run --project unit  # from apps/api: only the tests that need no Docker
npm run build -w apps/api      # tsc → dist/
npm start -w apps/api          # node dist/start.js
npm run db:migrate             # from the root: apply the schema to DATABASE_URL
npm run db:seed                # from the root: migrate, then seed (safe to run again)
```

The root scripts (`npm test`, `npm run typecheck`, `npm run lint`) build shared themselves.

## Layout

| File | Responsibility |
|---|---|
| `src/config.ts` | Parses the environment with Zod at boot. A bad value stops the process and names the variable, never its value. |
| `src/logger.ts` | pino, with cookies, `authorization` and `set-cookie` redacted. |
| `src/app.ts` | `createApp({ logger, pingDb })`: middleware, routes, 404, error handler. Tests inject a failing `pingDb`. |
| `src/http/errors.ts` | `AppError` for expected failures; the handler that maps everything to the shared envelope. |
| `src/http/health.ts` | `GET /api/health`: 200 when the database answers, 503 when it doesn't. |
| `src/db/pool.ts` | The `pg` pool: 2 s connect timeout, 5 s query timeout, and an `error` listener so a dropped idle connection can't crash the process. |
| `src/db/database.ts` | The Kysely instance and the hand-written table types. |
| `src/db/migrate.ts`, `src/db/migrations/` | Up-only migrations from a static list. `0001_initial` is the whole schema. |
| `src/db/seed/read-seed.ts` | Pure: seed file contents in, validated records out. Errors name a receipt number or a position, never a cell's content. |
| `src/db/seed/seed.ts` | `runSeed`: accounts, campaigns, donors, donations and the receipt sequence in one transaction, `ON CONFLICT DO NOTHING` on a natural key, never an update. |
| `src/scripts/migrate.ts`, `src/scripts/seed.ts` | The `db:migrate` and `db:seed` entry points: the same functions `start.ts` calls, then exit. |
| `src/auth/password.ts` | scrypt hashing; the parameters travel with the hash. |
| `src/start.ts` | Migrates, seeds, then listens, and on `SIGTERM`/`SIGINT` closes the server and the pool once, forcing an exit after 8 s. A failed step is logged by name and exits 1. |

Routes are mounted under `/api` by the API itself, so `curl localhost:4000/api/health` and,
once nginx arrives in spec 001 T9, `curl localhost:3000/api/health` use the same path.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | none (required) | `postgres://` or `postgresql://` |
| `PORT` | `4000` | |
| `LOG_LEVEL` | `info` | pino levels, or `silent` |
| `SEED_DIR` | `roles/full-stack-engineer/seed` from the repo root | Where `campaigns.json` and `donations.csv` are read from. A relative value is taken from the repo root, whatever directory you start in. The files are read in place and never edited. |
| `ORG_TIMEZONE` | `America/Chicago` | The organisation's zone: it decides the year in a receipt number. |
| `PAYMENT_TIMEOUT_MS` | `5000` | One deadline for the provider call and its retry; past it the donation stays `pending`. |
| `PAYMENT_MOCK_LATENCY_MS` | `250` | Delay the mock provider adds to each charge. |
| `DONATION_RATE_LIMIT` | `30` | Donation requests per client address per 10 minutes. |

`NODE_ENV` is read by Express itself (the Docker image sets `production` from spec 001 T9);
the API's own code doesn't use it yet.

## Errors

Every error is `{ "error": { "code", "message", "details"? } }` (`@aangan/shared`).

| Case | Status | Code |
|---|---|---|
| Unknown route | 404 | `not_found` |
| Body is not valid JSON | 400 | `malformed_json` |
| Body over 16 kB | 413 | `payload_too_large` |
| Other client errors (bad charset or encoding, undecodable URL parameter) | their 4xx | `bad_request` |
| Database unreachable (health) | 503 | `unavailable` |
| Anything unexpected | 500 | `internal_error`; the detail is logged, never sent |

## Donating

`POST /api/donations` needs an `Idempotency-Key` header (any UUID) and a strict JSON body. The
amount is `amountCents`, an integer; the server checks it against the campaign's limits.
`paymentToken` picks the mock provider's outcome: `tok_ok`, `tok_decline`, `tok_insufficient`,
`tok_timeout` (answers 202, pending) or `tok_flaky` (fails once, then succeeds).

```bash
curl -i -X POST localhost:3000/api/donations \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(node -p 'crypto.randomUUID()')" \
  -d '{"campaignSlug":"aangan-courtyard","amountCents":10100,
       "donor":{"fullName":"Anisha Gurung","email":"anisha@example.com"},
       "privacyMode":"public","paymentToken":"tok_ok"}'
```

Sending the same key and body again answers the same status and receipt with
`Idempotent-Replayed: true` and no second charge; the same key with another body is a 422. A
missing or non-UUID key is a 400, so the reference `concurrency-burst.mjs`, which sends no
headers, gets 400s until it adds one.

| Outcome | Status | Code |
|---|---|---|
| Charged | 201 | receipt, `status: "completed"` |
| Timeout, outcome unknown | 202 | receipt, `status: "pending"` |
| Declined | 402 | `card_declined`, `insufficient_funds` |
| Provider failed twice | 502 | `payment_provider_error` |
| Same key still in flight | 409 | `request_in_progress`, `Retry-After: 1` |
| Bad body, or outside the campaign's limits | 422 | `validation_failed`, `amount_out_of_range`, `campaign_closed`, `idempotency_key_mismatch` |
| Over `DONATION_RATE_LIMIT` per 10 minutes | 429 | `rate_limited`, `Retry-After` |

## Demo accounts

The seed creates these logins, and they are in plain text on purpose: the reviewers sign in
with them. They are fixtures, not secrets.

| Email | Password | Role |
|---|---|---|
| `admin@himalayacc.example` | `admin12345` | admin |
| `donor@himalayacc.example` | `donor12345` | donor, owns 3 seeded donations |
| `other@himalayacc.example` | `other12345` | donor, owns 2 seeded donations |
