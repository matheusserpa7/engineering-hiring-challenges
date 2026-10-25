# Tech Spec 001 — Foundation

Status: draft, awaiting approval · Implements [`prd.md`](prd.md) · Inherits
[000 techspec](../000-overview/techspec.md)

## 1. Workspace and tooling (T1, T2)

- Root `package.json`: `"private": true`, `"type": "module"`, and
  `"workspaces": ["packages/shared", "apps/api", "apps/web"]`, listed explicitly so
  `--workspaces` runs build in dependency order. `"engines": {"node": ">=24 <25"}`. `.npmrc`
  has `engine-strict=true`.
- Root scripts:
  `dev` (`concurrently` runs the shared `tsc -w`, the api `tsx watch` and `vite`) ·
  `build` (`npm run build --workspaces --if-present`) · `test` (builds shared, then
  `npm test --workspaces --if-present`) · `lint` (`eslint . --max-warnings 0`) ·
  `format` / `format:check` (Prettier) · `typecheck` (`--workspaces`).
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `verbatimModuleSyntax`, `isolatedModules`, target `ES2024`. API and shared use
  `module`/`moduleResolution: NodeNext`. Web uses `bundler`.
- The shared package builds with `tsc` to `dist/` (ESM + `.d.ts`). Its `exports` point at
  `dist`. Both apps consume the built output, the same way in dev, test and Docker. This
  rules out "works in Vite, breaks in Node" differences.
- `eslint.config.js` (flat):
  - `@eslint/js` recommended, typescript-eslint `strictTypeChecked` (project service), and
    `eslint-plugin-vue` `flat/recommended` with the TS parser for `<script lang="ts">`.
  - `eslint-config-prettier` last.
  - Project rules: `no-restricted-globals: parseFloat`; `no-restricted-properties:
    Number.parseFloat`; `no-restricted-syntax` on `CallExpression[callee.property.name=
    'toFixed']` (money); `vue/no-v-html: error` (XSS); `no-console: error`, except in
    `scripts/` and `.claude/hooks/`.
  - Ignores: `roles/**`, `**/dist`, `coverage`, `playwright-report`.
- Prettier runs only on code and config (`ts, vue, js, mjs, json, yml, css`).
  `.prettierignore` excludes `roles/`, the company's docs and `package-lock.json`. Markdown
  is not reformatted, to avoid table churn.
- `.gitattributes`: `* text=auto eol=lf`, plus `*.pdf binary`. `.gitignore` additionally
  ignores `.claude/settings.local.json`.

## 2. Agent conventions (T3–T5)

**`CLAUDE.md`** (root), about 120 lines:
1. The mandatory PRD → Tech Spec → Tasks rule, copied verbatim.
2. Ownership rules: the user commits; Claude proposes a diff summary and a commit message;
   no large code blocks without review.
3. Commands.
4. Layout and layering (`http → services → repositories`).
5. Conventions: naming, error envelope, Zod at every boundary, NFC on write, `timestamptz`
   UTC, `ORG_TIMEZONE` in one place, comments explain *why*, no AI narration, files under
   500 lines.
6. The money rule.
7. The security checklist, condensed from `docs/04`.
8. "No feature without a test", plus the hard-path tests that must exist.
9. Pointers to specs and ADRs.

**Subagents** (`.claude/agents/*.md`): one job each, with the minimum tools.

| Agent | Job | Tools | Output |
|---|---|---|---|
| `spec-writer` | Turns a request into `prd.md` / `techspec.md` / `tasks.md` (or `mini-spec.md`) and checks traceability against REQUIREMENTS and RUBRIC | Read, Grep, Glob, Write, Edit (only under `docs/specs/`, stated in its prompt) | The files, plus a 5–10 line summary with the decisions to defend |
| `test-writer` | Writes tests from the spec's test plan before or alongside the code: boundaries, error branches, authz, concurrency. Never mocks the thing under test | Read, Grep, Glob, Write, Edit, Bash | Test files, plus which acceptance criterion each one proves |
| `code-reviewer` | Reviews a diff against the tech spec, `docs/04`, the rubric and the `docs/07` agent-failure table | Read, Grep, Glob, Bash (read-only git) | Findings ranked blocker/major/minor, with file:line. **Does not edit** |
| `qa-verifier` | Clean environment: `down -v`, prune, `up --build --wait`, then the PRD acceptance criteria via curl/Playwright and `CHECKLIST.md` | Read, Grep, Glob, Bash | A pass/fail table with evidence. **Does not edit** |

**Hook** (`.claude/settings.json`, `PostToolUse` on `Edit|Write`) runs
`node .claude/hooks/check-edited-file.mjs`. The script:
- reads the hook JSON from stdin;
- if the edited path is a `.ts`/`.vue` file under `apps/` or `packages/`, runs `eslint
  <file>` and the owning workspace's `typecheck`;
- on failure, prints the output to stderr and exits 2, which shows it to the agent;
- otherwise exits 0 silently.

It is Node, not shell, so it works the same on Windows and in CI. Tests and formatting are
not part of the hook: they're too slow per edit, and CI and the task flow cover them.

## 3. Shared package (T6)

`packages/shared/src/errors.ts` holds the error envelope type `ApiErrorBody` and the
`ErrorCode` union (`validation_failed | not_found | internal_error | …`, extended by later
specs) plus an `isApiErrorBody` guard. The API's error middleware builds the envelope from
this type. The web client's `fetch` wrapper uses the guard to read it. That makes the
shared package real from its first commit, before money exists (spec 002).

## 4. API skeleton (T7)

```
apps/api/src/
  config.ts      Zod-parsed env (PORT, NODE_ENV, LOG_LEVEL, DATABASE_URL); fails fast, never logs values
  logger.ts      pino; redacts req.headers.cookie and authorization
  app.ts         createApp(deps) — helmet, express.json({limit:'16kb'}), pino-http, routes,
                 notFound, errorHandler. deps = { pingDb } so tests inject failures
  http/health.ts GET /api/health → pingDb() ? 200 {status:'ok'} : 503 {error:{code:'unavailable'}}
  http/errors.ts AppError(status, code, message); errorHandler: AppError → its envelope;
                 malformed JSON → 400 malformed_json; anything else → log + 500 internal_error
  db/pool.ts     pg Pool from DATABASE_URL (Kysely arrives in 002)
  start.ts       listen; SIGTERM/SIGINT → server.close + pool.end
```

Why `start.ts` handles signals: Node as PID 1 in a container has no default `SIGTERM`
handler, so `docker compose down` would wait 10 s and then kill it.

## 5. Web skeleton (T8)

Vite + Vue 3 + TS. `App.vue` renders the product name and an API status line from
`GET /api/health`. It uses a typed `api.ts` fetch wrapper with relative URLs and
`credentials: 'same-origin'`, and reads errors with `isApiErrorBody` from shared.
`vue-tsc --noEmit` is the typecheck. The Vite dev server proxies `/api` to
`localhost:4000`, which mirrors nginx.

## 6. Docker (T9)

- **`apps/api/Dockerfile`** (build context = repo root):
  - `deps`: copy the root and workspace `package.json` files plus the lockfile, then `npm ci`.
  - `build`: copy sources, then `npm run build -w packages/shared -w apps/api`.
  - `prod-deps`: `npm ci --omit=dev -w apps/api`.
  - `runtime`: `node:24-alpine`, `NODE_ENV=production`; copy `node_modules`,
    `packages/shared/{package.json,dist}` and `apps/api/{package.json,dist}` into the same
    relative paths so the workspace symlink resolves.
  - `USER node`, `EXPOSE 4000`, a `HEALTHCHECK` that runs `fetch` against `/api/health`, and
    `CMD ["node","dist/start.js"]`.
- **`apps/web/Dockerfile`**:
  - `deps` and `build`: `npm run build -w packages/shared -w apps/web`.
  - `runtime`: `nginxinc/nginx-unprivileged:1.28-alpine` (non-root, listens on 8080) with
    `nginx.conf` and `dist/`, and `HEALTHCHECK wget -qO- http://127.0.0.1:8080/healthz`.
- **`nginx.conf`**:
  - `location /api/` → `proxy_pass http://api:4000` (no trailing slash, so the path is
    forwarded unchanged).
  - `location /` → `try_files $uri /index.html`.
  - `/healthz` → 200.
  - `server_tokens off`.
  - Security headers: a CSP of `default-src 'self'; object-src 'none'; base-uri 'none';
    frame-ancestors 'none'`, plus `X-Content-Type-Options`, `Referrer-Policy`.

  **API path decision:** the API mounts its routes under `/api` itself (`/api/health`,
  `/api/campaigns/...`), matching the contract's base URL. nginx then proxies `/api/`
  unchanged. Direct calls to `:4000` and proxied calls to `:3000` share one URL scheme, so
  reviewers' `curl` commands work the same on both. Docker's `HEALTHCHECK` uses
  `/api/health`.
- **`docker-compose.yml`**:
  - `db`: `postgres:16-alpine`, named volume `dbdata`, `pg_isready` healthcheck,
    `127.0.0.1:${DB_PORT:-5433}:5432`.
  - `api`: `depends_on: db: service_healthy`, `${API_PORT:-4000}:4000`, `DATABASE_URL`
    composed from the `POSTGRES_*` vars pointing at `db:5432`.
  - `web`: `depends_on: api: service_healthy`, `${WEB_PORT:-3000}:8080`.
  - Required vars use `${VAR:?copy .env.example to .env}`.
- **`.dockerignore`**: `node_modules`, `**/node_modules`, `.git`, `**/dist`, `coverage`,
  `.env`, `playwright-report`, `test-results`, `roles/qa-engineer`, `docs`,
  `Hiring_Handbook.pdf`, `.claude`.
- **`.env.example`**: only the variables used so far (POSTGRES_*, `DATABASE_URL` for the
  host dev path on `localhost:5433`, PORT, NODE_ENV, LOG_LEVEL, the host ports). Each later
  spec adds its own, with a comment.

## 7. CI (T10)

`.github/workflows/ci.yml`, triggered on push and pull_request, with
`permissions: contents: read` and concurrency cancel-in-progress.
- `check`: checkout, setup-node 24 with npm cache, `npm ci`, `format:check`, `lint`,
  `typecheck`, `test`, `build`.
- `stack`: `cp .env.example .env`, `docker compose up --build --wait --wait-timeout 300`,
  curl smoke (`:4000/api/health`, `:3000/api/health`, `:3000/` contains `<div id="app">`),
  `docker compose logs` on failure, and always `down -v`.

## 8. Test plan

| Test | Type | Proves |
|---|---|---|
| `apps/api/test/health.test.ts` | Supertest on `createApp` with an injected `pingDb` | 200 when the DB answers, 503 + envelope when it throws |
| `apps/api/test/errors.test.ts` | Supertest | Unknown route → 404 `not_found` envelope. A throwing route → 500 `internal_error` whose body contains neither the error message nor `at ` stack frames. Malformed JSON → 400 |
| `packages/shared/test/errors.test.ts` | Vitest | `isApiErrorBody` accepts the envelope and rejects near-misses (missing code, string body, null) |
| Lint guard check | Manual, at T2 | A scratch file using `parseFloat` / `toFixed` / `v-html` fails lint. Deleted, not committed |
| Hook check | Manual, at T5 | Editing a file to add a type error makes the hook report it |
| Stack smoke | `docker compose up --build --wait` + curl, locally and in CI | US-1 |
| Non-root | `docker compose exec api id -u`, `docker compose exec web id -u` ≠ 0 | M7 |

## 9. Alternatives considered

| Chosen | Rejected | Why |
|---|---|---|
| npm workspaces | pnpm, Turborepo | Ships with Node, one fewer tool for reviewers. Turborepo caching doesn't pay off at three packages. |
| Consume `shared` from `dist` | Source via custom export conditions | One resolution path everywhere, at the cost of a build step in dev (`tsc -w`). |
| TypeScript ~6.0 | 7.0 | typescript-eslint doesn't support it yet. |
| `tsx watch` for API dev | `node --watch` with type stripping | Node can't strip types through the workspace setup reliably, and `tsx` is dev-only. |
| `concurrently` | `&` in npm scripts | `&` doesn't work in Windows `cmd`, and reviewers may be on any OS. |
| nginx-unprivileged | `nginx:alpine` + `USER` tweaks | Non-root by default, and port 8080 needs no capabilities. |
| JS hook script | Bash hook | Works on Windows and Linux alike. |
| Hook = lint + typecheck of the edited package | Full test suite per edit | Seconds rather than a minute per edit. Tests run per task. |

## 10. Risks

| Risk | Mitigation |
|---|---|
| `npm ci --omit=dev -w apps/api` has workspace quirks | Verify in T9. Fallback: `npm ci --omit=dev` (also installs web's small runtime deps), noted. |
| New majors (ESLint 10, Vite 8, Vitest 5, vue-router 5) have fresh edge cases | Peer ranges checked: all accept Node 24 and each other. Lockfile pinned. If a major misbehaves, drop to the previous one and say so in the commit. |
| CRLF in the working tree on this Windows machine | `.gitattributes` + Prettier `endOfLine: lf`. The entrypoint is JS, not shell. |
| The hook slows down editing | Lint only the edited file, and typecheck only its package. Measured at T5; if it's over ~10 s, drop the typecheck to the per-task flow. |
