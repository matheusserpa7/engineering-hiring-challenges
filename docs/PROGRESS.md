# Progress

Where the work stands, and what comes next. Updated at the end of every working session.
The plan itself lives in [`specs/000-overview/tasks.md`](specs/000-overview/tasks.md). This
file is only the current position.

Last updated: 2026-10-26

## Phases

| Phase | What | Status |
|---|---|---|
| 0 — Understanding | Read the brief, rubric, checklist and docs 00–11; verify the seed data; list ambiguities | Done |
| 1 — Overview | [PRD](specs/000-overview/prd.md), [Tech Spec](specs/000-overview/techspec.md), [Tasks](specs/000-overview/tasks.md), [ADRs 0001–0005](adr/) | Done · `02b074f` |
| 2 — Foundation | [Spec 001](specs/001-foundation/): workspaces, tooling, CLAUDE.md, subagents, hook, Docker stack, CI | **Done** · CI green: [run 40324681629](https://github.com/matheusserpa7/engineering-hiring-challenges/actions/runs/40324681629) |
| 3 — Features | Specs 002–005 (must-haves), then the status report | Next: write spec 002 |
| 4 — Submission | Spec 006: hardening, e2e, READMEs, AI-USAGE.md, clean-clone rehearsal, video | Not started |

## Specs

| Spec | Status | Tasks |
|---|---|---|
| 000-overview | Approved, committed | — |
| 001-foundation | **Done**, pushed, CI green | 10 / 10 |
| 002-data-and-money | Not written | — |
| 003-public-campaign | Not written | — |
| 004-donation-intake | Not written | — |
| 005-auth-admin-refunds | Not written | — |
| 006-hardening-and-submission | Not written | — |
| 007 (S0) / 008 (X1) | Optional, only after 006 | — |

## What exists now

- `npm ci && npm test` runs 32 tests (shared 14, API 13, web 5). `lint`, `typecheck` and
  `test` build the shared package first.
- `cp .env.example .env && docker compose up --build --wait` brings up db, api and web,
  all healthy, in about 30 s from a cold build cache. The API is on `:4000`, the site on
  `:3000`.
- `npm run dev` runs shared's watcher, the API (`tsx watch`) and Vite on `:5173`. It needs
  the compose `db`, or any Postgres, at the `DATABASE_URL` in `.env`.
- Agent setup: `CLAUDE.md`, four subagents in `.claude/agents/`, and a post-edit
  lint/typecheck hook (about 2 s per edit).

## Next steps, in order

1. Write **spec 002 (data and money)** with the `spec-writer` flow: PRD, tech spec and
   tasks. Then stop for approval.
2. Carry the forward notes from spec 001 into the specs they belong to. They're listed at
   the end of [`specs/001-foundation/tasks.md`](specs/001-foundation/tasks.md):
   - 002: test the undecodable URL parameter case; check shared's runtime dependencies
     end up in the API image.
   - 003: `trust proxy` set to `1`, not `true`.
   - 004: keep the `?q=` search out of the access log.
   - 005: helmet CSP `default-src 'none'`; the `Origin` allow-list includes `:5173` in dev.
3. Execute 002, then 003–005, one task per commit.

## Open questions for the company

The five questions in [PRD 000 → Open questions](specs/000-overview/prd.md#open-questions-to-email)
(seed row 14 length, row 71 dedication, closed-campaign donations, `donorCount`, anonymous
dedications).

- Email status: **not yet sent.** Update this line when it is sent and when answers arrive.
- Until then, assumptions A1–A12 in the PRD apply.

## Environment notes (this machine)

- Node **24.22.1** is at `C:\Program Files\nodejs` and comes first on PATH. Node 22 is
  still installed, so terminals opened before the install still resolve to it. Reopen them.
- **Docker Desktop must be running** for compose, and for `npm test` once spec 002 adds
  Testcontainers.
- `core.autocrlf=true` on this machine. `.gitattributes` forces LF, so keep it.
- npm runs through `cmd.exe` here, where `^` is an escape character. Don't put `^` in npm
  arguments.
- The first `npm install -w <dir>` into a brand-new workspace has silently done nothing,
  twice. Check its `package.json` afterwards.
- `AGENTS.md` and `.codex/` are the user's own (a Codex port). Leave them untracked and
  untouched.

## How to resume

```bash
git pull                # if working from another machine
node -v                 # v24.x
docker info             # daemon running
npm ci
cp .env.example .env    # if .env is missing
```

Then continue at the first unticked task of the current spec.
