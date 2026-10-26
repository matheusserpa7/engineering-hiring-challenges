# Progress

Where the work stands, and what comes next. Updated whenever a task or a session ends.
The plan itself lives in [`specs/000-overview/tasks.md`](specs/000-overview/tasks.md). This
file is only the current position.

Last updated: 2026-10-26

## Resume here

**Spec 002, task T2: Kysely, the int8 parser and the first migration.**

1. Read [`CLAUDE.md`](../CLAUDE.md), then this file.
2. Read spec 002 ([PRD](specs/002-data-and-money/prd.md),
   [tech spec](specs/002-data-and-money/techspec.md),
   [tasks](specs/002-data-and-money/tasks.md)). It is approved, and T1 is done in `5244ca5`.
3. Start T2 by confirming Testcontainers works with Docker Desktop on this Windows
   machine (tech spec §11, first risk), before writing the migration tests on top of it.
4. Follow the per-task flow in `CLAUDE.md`. Commit only when the user says so.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 — Understanding | Read the brief, rubric, checklist and docs 00–11; verify the seed data; list ambiguities | Done |
| 1 — Overview | [PRD](specs/000-overview/prd.md), [Tech Spec](specs/000-overview/techspec.md), [Tasks](specs/000-overview/tasks.md), [ADRs 0001–0005](adr/) | Done · `02b074f` |
| 2 — Foundation | [Spec 001](specs/001-foundation/): workspaces, tooling, CLAUDE.md, subagents, hook, Docker stack, CI | Done · CI green: [run 40324681629](https://github.com/matheusserpa7/engineering-hiring-challenges/actions/runs/40324681629) |
| 3 — Features | Specs 002–005 (must-haves), then the status report | **In progress: spec 002, 1 of 6 tasks** |
| 4 — Submission | Spec 006: hardening, e2e, READMEs, AI-USAGE.md, clean-clone rehearsal, video | Not started |

## Specs

| Spec | Status | Tasks |
|---|---|---|
| 000-overview | Approved, committed | — |
| 001-foundation | Done, pushed, CI green | 10 / 10 |
| 002-data-and-money | Approved (`e6dba0e`), executing | **1 / 6** (T1 `5244ca5`) |
| 003-public-campaign | Not written | — |
| 004-donation-intake | Not written | — |
| 005-auth-admin-refunds | Not written | — |
| 006-hardening-and-submission | Not written | — |
| 007 (S0) / 008 (X1) | Optional, only after 006 | — |

## Git state

- Branch `main`, tracking `origin/main` on the user's fork.
- **These commits are local and not yet pushed:**

  ```
  5244ca5  feat(shared): add exact dollar parsing and cent formatting   spec-002/T1
  e6dba0e  docs: add spec 002 for data and money                       spec-002
  f861d69  docs: close spec 001 and update the progress log            spec-001/T10
  ```

  Push only when the user asks. The plan is to push after spec 002 T6, so CI checks the
  seeded stack.

## What exists now

- `npm ci && npm test` runs 78 tests (shared 60, API 13, web 5). `lint`, `typecheck` and
  `test` build the shared package first.
- `cp .env.example .env && docker compose up --build --wait` brings up db, api and web,
  all healthy, in about 30 s from a cold build cache. The API is on `:4000`, the site on
  `:3000`. There's no schema or data yet; that's spec 002.
- `npm run dev` runs shared's watcher, the API (`tsx watch`) and Vite on `:5173`. It needs
  the compose `db`, or any Postgres, at the `DATABASE_URL` in `.env`.
- `packages/shared` holds the error envelope and the money helpers.
- Agent setup: `CLAUDE.md`, four subagents in `.claude/agents/`, and a post-edit
  lint/typecheck hook (about 2 s per edit).
  - Claude Code loads all of these automatically. The agent files are read only when a
    session starts.
  - Any other tool gets neither the subagents nor the hook. It must run lint and
    typecheck after each edit, and do the review step itself.

## Forward notes still open

From [spec 001's task notes](specs/001-foundation/tasks.md):

- 002: test the undecodable URL parameter case once a route has a parameter; check shared's
  runtime dependency (`zod`) is in the API image (planned in T6).
- 003: `trust proxy` set to `1`, not `true`.
- 003, first asset: Vite inlines small assets as `data:` URLs, which the CSP blocks.
- 004: keep the `?q=` search out of the access log.
- 005: helmet CSP `default-src 'none'`; the `Origin` allow-list includes `:5173` in dev.

## Open items that aren't code

- **Clarification email** to the company: the five questions in
  [PRD 000 → Open questions](specs/000-overview/prd.md#open-questions-to-email). **Not
  yet sent.** Until answers arrive, assumptions A1–A12 in the PRD apply.
- **Time spent:** not tracked here yet. The README and `AI-USAGE.md` need the user's own
  figure.
- **`AI-USAGE.md`** (spec 006) must name every AI tool used. If another agent continues the
  work, record which tool did which part.

## Environment notes (this machine)

- Node **24.22.1** is at `C:\Program Files\nodejs` and comes first on PATH. Node 22 is
  still installed, so terminals opened before the install still resolve to it. Reopen them.
- **Docker Desktop must be running** for compose, and for `npm test` from spec 002 T2 on,
  because of Testcontainers.
- `core.autocrlf=true` on this machine. `.gitattributes` forces LF in the repo, but files
  checked out before it existed are still CRLF in the working copy (the seed CSV, for
  example). Code that reads them must accept both.
- npm runs through `cmd.exe` here, where `^` is an escape character. Don't put `^` in npm
  arguments; npm writes the caret into `package.json` itself.
- The first `npm install -w <dir>` into a brand-new workspace has silently done nothing,
  twice. Check its `package.json` afterwards and re-run if needed.
- Windows PowerShell 5.1 adds a BOM when piping text to a program. Test the hook, or
  anything that reads stdin, from Git Bash.
- To commit a multi-line message from PowerShell, put it in a here-string variable and run
  `git commit -m $msg`. `git commit -F -` doesn't work with PowerShell pipes.

## How to resume on a fresh machine

```bash
git pull                # if working from another machine
node -v                 # v24.x
docker info             # daemon running
npm ci
cp .env.example .env    # if .env is missing
npm run lint && npm test
```
