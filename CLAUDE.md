# CLAUDE.md

Working rules for AI agents in this repository: a donation page for the HCC Aangan
campaign (full-stack take-home). Plan: [`docs/specs/000-overview/`](docs/specs/000-overview/).
Current position: [`docs/PROGRESS.md`](docs/PROGRESS.md). Read both before doing anything.

All repository artifacts (code, docs, specs, commits, comments) are in English.

## MANDATORY RULE — PRD → TECH SPEC → TASKS BEFORE ANY CODE CHANGE

For every request that changes code, configuration, infrastructure or tests, follow this flow. No code file may be created or edited before my approval.

1. PRD — docs/specs/NNN-slug/prd.md
   - Problem and context (what and why)
   - Goals and non-goals (what is explicitly out of scope)
   - User stories and testable acceptance criteria (Given/When/Then)
   - Traceability: which items of REQUIREMENTS.md and RUBRIC.md this addresses
   - Open questions and assumptions made
2. TECH SPEC — docs/specs/NNN-slug/techspec.md
   - Technical approach and affected components
   - Data model, migrations and API contracts (request/response/errors)
   - Concurrency, idempotency, authorization, validation and error handling
   - Test plan: which tests, of what type, and what each one proves
   - Alternatives considered and why they were rejected
   - Risks and how to mitigate them
3. TASKS — docs/specs/NNN-slug/tasks.md
   - Numbered checklist of small tasks; each task becomes one atomic commit
   - For each task: affected files, definition of done and corresponding test
   - Order and dependencies between tasks
4. STOP and give me a short summary (5–10 lines) of the PRD and Tech Spec, including the decisions I need to be able to defend. Only proceed after my "ok".
5. During execution: mark each task as done in tasks.md. If anything changes along the way, update the spec BEFORE changing the code and tell me.

Proportionality: for trivial changes (typo, one-line config tweak, renaming), use a short version — a single docs/specs/NNN-slug/mini-spec.md with goal, change and test — but still ask for my ok. Keep documents concise: specs exist to make decisions and show reasoning, not to add volume.

## Ownership

- The user must be able to explain every line live. Never write a large block of code
  without stopping for review. Small steps, one task at a time.
- Per task: test → implementation → run checks → `code-reviewer` on the diff → fix → tick
  the task in `tasks.md` → show a short diff summary, the decisions to defend and the
  proposed commit message.
- **Commit only on the user's explicit go-ahead.** Commit as the configured git user. Never
  add a `Co-Authored-By` trailer or any "Generated with" line. AI use is disclosed in
  `AI-USAGE.md`, not in commits.
- Commits: Conventional Commits, subject ≤ 60 characters, a body that says *why* when it
  earns one, and `Refs: spec-NNN/Tn` as the last line. One task per commit. Never push
  unless asked.
- Stage by explicit path, never `git add .` or `git add -A`. Never commit a file you didn't
  create in this task, such as another tool's config: report it to the user instead. Never
  delete such a file unless the user asks.
- Machine-specific gotchas (npm through `cmd.exe`, PowerShell piping, CRLF working copies)
  are listed in `docs/PROGRESS.md` under *Environment notes*. Read them before installing
  anything.

## Commands

Run from the repo root. Node 24 (`engine-strict`). Docker Desktop must be running for
tests (Testcontainers) and for compose.

| Command | What it does | Available from |
|---|---|---|
| `npm ci` | Install from the lockfile | spec 001 |
| `npm run lint` | ESLint, zero warnings allowed | spec 001 |
| `npm run format` / `format:check` | Prettier (Markdown is not reformatted) | spec 001 |
| `npm run typecheck` | `tsc` / `vue-tsc` in every workspace | spec 001 T6 |
| `npm test` | Builds shared, then Vitest in every workspace | spec 001 T6 |
| `npm run build` | Builds every workspace in dependency order | spec 001 T6 |
| `npm run dev` | shared `tsc -w` + API `tsx watch` + Vite | spec 001 T8 |
| `npm run db:migrate` / `db:seed` | Kysely migrations / idempotent seed | spec 002 |
| `cp .env.example .env && docker compose up --build` | The whole stack on :3000 / :4000 | spec 001 T9 |

A command marked with a later spec does not exist yet. Don't add a placeholder for it.

## Layout and layering

`apps/api` (Express 5), `apps/web` (Vue 3 + Vite), `packages/shared` (money, Zod schemas,
DTO types, error codes; both apps consume its built `dist/`). The seed is read in place from
`roles/full-stack-engineer/seed/`, which is never edited.

API layering goes one way only: `http` (routes, Zod parsing, error mapping) → `services`
(business rules, transactions) → `repositories` (SQL only). Handlers hold no business
rules. Repositories hold no HTTP.

## Conventions

- TypeScript `strict`. No `any`, no non-null `!` to silence the compiler. Fix the type.
- Validate at every boundary with Zod: `.strict()` objects (unknown keys → 422), NFC
  normalisation of text, length counted in code points.
- One error shape everywhere: `{ "error": { "code", "message", "details"? } }`, with codes
  from `packages/shared`. Never a stack, SQL fragment, path or `e.message` in a response.
  Log the detail server-side with the request id.
- Time: `timestamptz`, stored in UTC, formatted in the browser. `ORG_TIMEZONE` is read in
  `config.ts` only. No bare `new Date().getMonth()` for business logic.
- Config: env is parsed by Zod in `config.ts`, fails fast, and never logs a value.
- Naming: camelCase in TS and JSON, snake_case in SQL, kebab-case file names, money fields
  end in `Cents`.
- Comments explain *why*, never *what*. No `// Step 1`, no JSDoc that restates the name, no
  try/catch around code that cannot throw, no helper file for a single call site.
- Files stay under ~500 lines. Prefer a boring, obvious solution you can defend in one
  sentence.

## Money rule

Integer minor units (cents) everywhere, as ADR 0002 sets out:
- `bigint` columns, `number` in TS checked with `Number.isSafeInteger`, `amountCents` in the API.
- `SUM(bigint)` returns `numeric`, so cast aggregates `::bigint`.
- Parse user input with the shared `parseDollarsToCents`, and format only at the display
  edge with `Intl.NumberFormat`.
- Store the currency next to the amount.
- Never trust a client-supplied price, total, status or role.
- `parseFloat`, `Number.parseFloat` and `.toFixed()` fail lint. Don't disable the rule:
  fix the code.

## Security checklist (condensed from `docs/04`)

1. No secrets in the repo or its history. Only `.env.example`, with placeholders.
2. Every endpoint checks who you are *and* whether you may touch this record. Ownership goes
   **in the SQL `WHERE`**, and a row that is not yours is a **404**, not a 403.
3. Every input is validated by a schema: presence, type, range, length, format, enum.
4. Parameterised queries only. Sort columns and directions come from a fixed map.
5. Assume every stored string is hostile: Vue escaping, no `v-html` (lint bans it), a CSP.
6. Errors leak nothing. Failed logins are identical in body and timing.
7. scrypt for passwords. Session tokens are 32 random bytes, stored hashed, with an expiry.
   Cookies are `HttpOnly; Secure; SameSite=Strict`.
8. Rate limits on login and donation intake. CORS names its origin. helmet.
9. Concurrency: no check-then-act across two statements. Use a unique constraint, an
   atomic conditional `UPDATE` or a row lock, chosen deliberately and explained in a comment.
10. Idempotency on writes that move money (a required `Idempotency-Key`). Refunds show up
    in every aggregate, because totals are derived and never stored.
11. Log identifiers, not bodies. Redact `cookie` and `authorization`.

## No feature without a test

A task is not done until a test proves its acceptance criterion and you have seen that
test fail without the change. Tests assert behaviour, never the mock. Integration tests run
against a real Postgres (Testcontainers), not mocks of the database. These hard-path tests
must exist by the end (tech spec 000 §12):
- money boundaries ($0.99 / $1.00 / $25,000.00 / $25,000.01) and malformed input
- the seed totals and Unicode round-trip
- no PII in the public JSON for anonymous rows
- 20 parallel identical donations → 1 row and 1 provider call
- the same key with a different body → 422
- a donor reading another donor's donation → 404, a donor on an admin route → 403
- 20 concurrent refunds → exactly 1 succeeds
- seeded XSS payloads render as text (e2e)

## Before every commit

Read the whole diff against the agent-failure table in `docs/07`: money, concurrency,
authorisation, errors, timezones, Unicode, tests, Docker, comments, consistency. Then run
`npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test`, or whichever of
these exist yet.

## Agents

`.claude/agents/` holds four subagents (from spec 001 T4): `spec-writer`, `test-writer`,
`code-reviewer` (findings only, never edits) and `qa-verifier` (clean compose run plus
`CHECKLIST.md`, never edits). From T5, a post-edit hook lints the edited file and
typechecks its package.

## References

Specs: `docs/specs/NNN-slug/`. Decisions: `docs/adr/0001–0005`. The brief:
`roles/full-stack-engineer/{README,REQUIREMENTS,RUBRIC,CHECKLIST}.md`. Security baseline:
`docs/04`. AI policy: `docs/07`.
