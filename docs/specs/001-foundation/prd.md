# PRD 001 — Foundation: workspaces, tooling, agent conventions, Docker skeleton, CI

Status: draft, awaiting approval · Parent: [000 overview](../000-overview/prd.md)

## Problem and context

Two scoring categories are decided before any feature exists. **It runs** (20 points)
depends on a compose stack that has run cold many times, not once at the end. **Tooling
first** (M1, `docs/08`) means the linter and formatter must exist before feature code,
because retrofitting them is how standards get skipped. We also work with an AI agent
under a strict "explain every line" rule, so the agent's working rules have to be written
down and enforced (`CLAUDE.md`, subagents, a hook), not remembered.

## Goals

1. An npm-workspace monorepo with strict TypeScript, ESLint and Prettier, configured before
   any feature code, with zero warnings.
2. `cp .env.example .env && docker compose up --build` brings up db, api and web, all
   healthy, from a clean clone. Every later spec only adds to a stack that already works.
3. CI proves goals 1 and 2 on every push.
4. The agent workflow is codified: the spec-first rule, the conventions, four
   single-purpose subagents, and a lint/typecheck hook after every edit.

## Non-goals

- Database schema, migrations, seed (spec 002). In this spec the API only *pings* the
  database.
- Any business endpoint, any real UI, sessions, CORS, rate limiting (specs 003–005).
- E2E tests (spec 006).
- `db:migrate` / `db:seed` root scripts. They arrive with their implementation in 002
  rather than as placeholders.

## User stories and acceptance criteria

**US-1 — Reviewer runs the skeleton**
- **Given** a fresh clone with the build cache pruned, **when**
  `cp .env.example .env && docker compose up --build --wait` runs, **then** it exits 0 with
  `db`, `api` and `web` reported healthy.
- **Given** the stack is up, **then** `curl localhost:4000/api/health` returns `200
  {"status":"ok"}`, `curl localhost:3000/api/health` returns the same through the nginx
  proxy, and `localhost:3000` serves the SPA shell.
- **Given** `.env` was not created, **then** compose fails immediately with a message that
  says to copy `.env.example`, not with an obscure error.
- **Given** the running containers, **then** none of the app processes runs as root.

**US-2 — Developer gets fast feedback**
- **Given** the repo, **then** `npm ci`, `npm run lint`, `npm run format:check`,
  `npm run typecheck`, `npm test` and `npm run build` all succeed with zero warnings.
- **Given** Node < 24, **then** `npm ci` refuses to install (`engine-strict`).
- **Given** a file that uses `parseFloat`, `.toFixed()` or `v-html`, **then** lint fails.
- **Given** a request to an unknown route or a handler that throws, **then** the API answers
  with the shared error envelope (`not_found` / `internal_error`). There is no stack trace,
  message or path in the body, and the detail is logged server-side.
- **Given** the database is unreachable, **then** `/api/health` answers 503, so Docker marks the
  API unhealthy.

**US-3 — CI guards the main branch**
- **Given** a push or pull request, **then** a `check` job (format, lint, typecheck, test,
  build) and a `stack` job (`compose up --build --wait` + curl smoke test) both run, and
  either one failing fails the build.

**US-4 — The agent follows the rules**
- **Given** a new session, **then** `CLAUDE.md` carries the mandatory PRD → Tech Spec →
  Tasks rule verbatim, the commands, the conventions, the money rule, the security
  checklist, "no feature without a test", and "the user commits".
- **Given** Claude edits a `.ts`/`.vue` file, **then** a hook lints that file and typechecks
  its package, and reports any failure back to the agent.
- **Given** `.claude/agents/`, **then** the spec-writer, test-writer, code-reviewer and
  qa-verifier exist. Each has one responsibility and the minimum tools: the reviewer and
  verifier cannot edit files.

## Traceability

| Item | Where |
|---|---|
| M1 monorepo, lint in the first code commit, root scripts | US-2 · T1, T2 |
| M1 shared package imported by both apps | US-2 · T6 (error envelope used by api and web) |
| M7 multi-stage, healthcheck, non-root, `.dockerignore` | US-1 · T9 |
| Rubric cat. 1 "It runs" | US-1, US-3 · T9, T10 |
| M6 / `docs/04` §7 errors that don't leak internals | US-2 · T7 |
| Rubric cat. 5 commits; `docs/07` AI policy | US-4 · T3–T5 |

## Assumptions

- B1: Workspaces are listed explicitly (`packages/shared`, `apps/api`, `apps/web`) so npm
  runs them in dependency order.
- B2: `typescript ~6.0.3`, not 7.0. typescript-eslint 8.72 supports `<6.1.0`.
- B3: Host ports 3000, 4000 and 5433 are the defaults, overridable from `.env`.

## Open questions

None blocking.
