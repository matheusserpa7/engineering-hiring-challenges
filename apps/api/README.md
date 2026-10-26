# @aangan/api

Express 5 on Node 24, talking to Postgres through `pg`. Today it is a skeleton: a health
check, the shared error envelope and a graceful shutdown. Business endpoints arrive in
specs 002–005.

```bash
npm run build:shared           # once, from the root: the API imports @aangan/shared from dist/
npm run dev -w apps/api        # tsx watch; reads ../../.env if it exists
npm test -w apps/api           # vitest + supertest, no database needed yet
npm run build -w apps/api      # tsc → dist/
npm start -w apps/api          # node dist/start.js
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
| `src/start.ts` | Wires it together, listens, and on `SIGTERM`/`SIGINT` closes the server and the pool once, forcing an exit after 8 s. |

Routes are mounted under `/api` by the API itself, so `curl localhost:4000/api/health` and,
once nginx arrives in spec 001 T9, `curl localhost:3000/api/health` use the same path.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | none (required) | `postgres://` or `postgresql://` |
| `PORT` | `4000` | |
| `LOG_LEVEL` | `info` | pino levels, or `silent` |

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
