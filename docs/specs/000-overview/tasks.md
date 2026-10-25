# Tasks 000 — Feature specs and order of work

Each row below becomes its own spec folder (`docs/specs/NNN-slug/`), with its own PRD, tech
spec and tasks, approved before any code. Each task inside a spec is one atomic commit.
Time is the budget, not a promise. Actuals are recorded here when a spec closes.

## T0 — Commit this overview
- Files: `docs/specs/000-overview/*`, `docs/adr/000*.md`
- Done when: approved and committed as `docs: add the project overview spec and ADRs`
- [ ] done

## Feature specs (must-have path)

| Spec | Scope | Rubric items | Depends on | Budget | Status |
|---|---|---|---|---|---|
| **001-foundation** | npm workspaces, strict TS, ESLint + Prettier (first code commit), `.gitattributes`, `.nvmrc`, root scripts. `CLAUDE.md`, `.claude/agents/` (spec-writer, test-writer, code-reviewer, qa-verifier), post-edit lint/typecheck hook. Compose skeleton (db + api `/health` + web placeholder) with healthchecks, multi-stage non-root Dockerfiles, `.dockerignore`, `.env.example`. CI `check` + `stack` jobs. | M1, M7, cat. 1, cat. 5 (history) | — | 1 h 15 | [ ] |
| **002-data-and-money** | `packages/shared` money + Zod schemas + DTO types with unit tests. First migration (schema, constraints, indexes, receipt sequence). The `int8`/`SUM` type parsing. CSV importer + idempotent seed + accounts. Automatic migrate → seed → listen on container start. | M1 (shared), M2, M8 (money), M6 (money), cat. 3 (awkward input) | 001 | 1 h 15 | [ ] |
| **003-public-campaign** | `GET /campaigns/:slug`, `GET /campaigns/:slug/donations` with the privacy projection in SQL. The Vue campaign page: totals, progress, recent list, empty/loading/error, 375px. Privacy payload test, empty-campaign test. | M3, cat. 4 (privacy, XSS) | 002 | 1 h | [ ] |
| **004-donation-intake** | `POST /donations`: strict schema, campaign rules, required `Idempotency-Key`, pending-row claim, provider adapter with timeout and a single flaky retry. Donation rate limit. The Vue form (presets, custom, dedication, privacy explanation) and the confirmation / declined / pending screens. Boundary, decline, timeout and 20-parallel idempotency tests. | M4, S3, S4 (part), cat. 4 (validation), DATA-MODEL rule 7 | 002 (003 for the page) | 1 h 30 | [ ] |
| **005-auth-admin-refunds** | scrypt login, hashed DB sessions, cookie flags, Origin check, login rate limit, `/auth/*`, `/me/donations`, `GET /donations/:id`, admin list with Devanagari search, status filter and allow-listed sort. Transactional refund with an audit row. Vue login, admin table, refund dialog, "my donations". Authz, refund-aggregate and concurrent-refund tests. | M5, M6, M8 (authz, refund), S4 (part), cat. 4 (authz) | 002 (003 for the totals assertion) | 1 h 30 | [ ] |
| **006-hardening-and-submission** | Security sweep against `docs/04` (headers, CSP, errors, `npm audit`, secret scan). Playwright e2e (donate, XSS, refund; Chromium + WebKit). Clean-clone rehearsal with timing. Root README (Decisions, Known issues, API reference, accounts), per-package READMEs, `AI-USAGE.md`. qa-verifier run plus the full `CHECKLIST.md`. Video script, interview questions. | M6, M7, M8 (e2e), M9, cat. 1, cat. 5, cat. 6 | 003–005 | 1 h 15 | [ ] |

Must-have total: about 7 h 45, at the top of the 5–8 h window. If we slip, the cut order
is: WebKit e2e → the S4 donation limit → the flaky retry. The intake idempotency is never
cut.

**Stop gate:** after 005, stop and report the status (rubric vs. done) before 006. After
006, stop again before any optional spec.

## Optional specs (only after the must-haves are verified)

| Spec | Scope | Rubric | Why in this order |
|---|---|---|---|
| 007-admin-list-complete (S0) | Pagination correct at the boundaries, date-range filter, streamed RFC 4180 CSV with a BOM | +2 | "If you only do one should-have, do this one". Small, and builds on 005. |
| 008-dedication-grid (X1) | 20×20 units, holds computed at read time, atomic conditional-update hold, 20-concurrent test | +5 | Worth the most, but also the largest. Only if at least 2 h remain. |

Explicitly not planned: S1 (mostly covered by `/me/donations`), S2, S5, S6, X2, X3, X4.
The reasons go in the README.

## Commit conventions for all specs

Matheus makes every commit. At the end of each task or phase, Claude proposes the message
with a short diff summary and never commits itself. Conventional Commits, one style
throughout, subject ≤ 60 characters, imperative. The spec
reference goes in the body as `Refs: spec-004/T3`, so it doesn't eat the subject. Every
commit leaves lint, typecheck and tests green. A reverted decision gets its own honest
commit, never a squash.
