# Progress

Where the work stands, and what comes next. Updated at the end of every working session.
The plan itself lives in [`specs/000-overview/tasks.md`](specs/000-overview/tasks.md). This
file is only the current position.

Last updated: 2026-10-25 · Time spent so far: ~1 h (reading, overview spec, foundation spec, T1)

## Phases

| Phase | What | Status |
|---|---|---|
| 0 — Understanding | Read the brief, rubric, checklist and docs 00–11; verify the seed data; list ambiguities | Done |
| 1 — Overview | [PRD](specs/000-overview/prd.md), [Tech Spec](specs/000-overview/techspec.md), [Tasks](specs/000-overview/tasks.md), [ADRs 0001–0005](adr/) | Done · `02b074f` |
| 2 — Foundation | [Spec 001](specs/001-foundation/): workspaces, tooling, CLAUDE.md, subagents, hook, Docker skeleton, CI | **In progress: T1 of 10 done** |
| 3 — Features | Specs 002–005 (must-haves), then the status report | Not started |
| 4 — Submission | Spec 006: hardening, e2e, READMEs, AI-USAGE.md, clean-clone rehearsal, video | Not started |

## Specs

| Spec | Status | Tasks |
|---|---|---|
| 000-overview | Approved, committed | — |
| 001-foundation | Approved, executing | 1 / 10 |
| 002-data-and-money | Not written | — |
| 003-public-campaign | Not written | — |
| 004-donation-intake | Not written | — |
| 005-auth-admin-refunds | Not written | — |
| 006-hardening-and-submission | Not written | — |
| 007 (S0) / 008 (X1) | Optional, only after 006 | — |

## Commits so far

```
282db08  chore: set up npm workspaces pinned to Node 24          spec-001/T1
c9c3de7  docs: add spec 001 for the project foundation           spec-001
02b074f  docs: add the project overview spec and ADRs            spec-000/T0
```

## Next steps, in order

1. **spec-001/T2**: `tsconfig.base.json`, `eslint.config.js` (strictTypeChecked, money and
   `v-html` bans), Prettier, root scripts. TypeScript pinned to `~6.0.3` (see spec 001 B2).
2. **T3**: `CLAUDE.md` with the spec-first rule, commands, conventions, money rule, security
   checklist, and "no feature without a test".
3. **T4**: subagents `spec-writer`, `test-writer`, `code-reviewer`, `qa-verifier`.
4. **T5**: post-edit lint/typecheck hook.
5. **T6–T8**: shared error envelope → API skeleton (`/api/health`) → Vue skeleton.
6. **T9**: Docker compose stack, verified from a pruned cache; note the cold-build time.
7. **T10**: CI workflow. Push, and confirm both jobs are green.
8. Write spec 002 (data and money) → approval → execute.

The flow for every task is in [`specs/001-foundation/tasks.md`](specs/001-foundation/tasks.md):
test → implement → checks → review → tick → one commit per task.

## Open questions for the company

The five questions in [PRD 000 → Open questions](specs/000-overview/prd.md#open-questions-to-email)
(seed row 14 length, row 71 dedication, closed-campaign donations, `donorCount`, anonymous
dedications).

- Email status: **not yet sent.** Update this line when it is sent and when answers arrive.
- Until then, assumptions A1–A12 in the PRD apply.

## Environment notes (this machine)

- Node **24.22.1** is installed at `C:\Program Files\nodejs` and comes first on PATH. Node
  22 is still installed; terminals opened before the install still resolve to it, so
  reopen them.
- **Docker Desktop must be running** before `npm test` (Testcontainers, from spec 002) and
  before any `docker compose` command.
- `core.autocrlf=true` on this machine. `.gitattributes` forces LF, so keep it.

## How to resume

```bash
git pull                # if working from another machine
node -v                 # v24.x
docker info             # daemon running
npm ci
```

Then continue at the first unticked task in `docs/specs/001-foundation/tasks.md`.
