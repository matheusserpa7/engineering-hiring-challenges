# Progress

Where the work stands, and what comes next. Updated whenever a task or a session ends.
The plan itself lives in [`specs/000-overview/tasks.md`](specs/000-overview/tasks.md). This
file is only the current position.

Last updated: 2026-10-27

## Resume here

**Spec 004 is implemented (9 / 9). Push when the user asks, so CI runs the new smoke steps, then
start spec 005.**

1. Read [`CLAUDE.md`](../CLAUDE.md), then this file.
2. Close specs 002–004: push when the user asks, so CI runs the stack job (seed, public API and
   the new `Donation intake` step), and record the green run here. Run the `qa-verifier` agent
   if the user wants it.
3. Spec 005 (auth, admin, refunds) is not written. Start it with the `spec-writer` agent: PRD,
   tech spec and tasks, then stop for the user's ok. Read the forward notes below first.
4. Follow the per-task flow in `CLAUDE.md`. Commit only when the user says so.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 — Understanding | Read the brief, rubric, checklist and docs 00–11; verify the seed data; list ambiguities | Done |
| 1 — Overview | [PRD](specs/000-overview/prd.md), [Tech Spec](specs/000-overview/techspec.md), [Tasks](specs/000-overview/tasks.md), [ADRs 0001–0005](adr/) | Done · `02b074f` |
| 2 — Foundation | [Spec 001](specs/001-foundation/): workspaces, tooling, CLAUDE.md, subagents, hook, Docker stack, CI | Done · CI green: [run 40324681629](https://github.com/matheusserpa7/engineering-hiring-challenges/actions/runs/40324681629) |
| 3 — Features | Specs 002–005 (must-haves), then the status report | **In progress: specs 002 and 003 implemented, specs 004–005 to go** |
| 4 — Submission | Spec 006: hardening, e2e, READMEs, AI-USAGE.md, clean-clone rehearsal, video | Not started |

## Specs

| Spec | Status | Tasks |
|---|---|---|
| 000-overview | Approved, committed | — |
| 001-foundation | Done, pushed, CI green | 10 / 10 |
| 002-data-and-money | Approved (`e6dba0e`), implemented, not yet closed by QA or CI | **6 / 6** (T1 `5244ca5` · T2 `27f850e` · T3 `b9cfb7b` · T4 `621646b` · T5 `a50f445` · T6 in the next commit) |
| 003-public-campaign | Implemented, not yet pushed or closed by CI | **7 / 7** (T1–T6 committed, T7 in the next commit) |
| 004-donation-intake | Implemented, not yet pushed or closed by CI | **9 / 9** |
| 005-auth-admin-refunds | Not written | — |
| 006-hardening-and-submission | Not written | — |
| 007 (S0) / 008 (X1) | Optional, only after 006 | — |

## Git state

- Branch `main`, tracking `origin/main` on the user's fork.
- **These commits are local and not yet pushed:**

  ```
  a50f445  feat(api): seed the campaign data on start                  spec-002/T5
  621646b  feat(api): parse the seed files into validated records      spec-002/T4
  b9cfb7b  feat(api): hash passwords with scrypt                       spec-002/T3
  27f850e  feat(api): add the initial schema migration                 spec-002/T2
  cc24a59  chore: pin a model and effort per agent stage               spec-009
  97d3ad5  docs: make the resume point explicit for any agent
  5244ca5  feat(shared): add exact dollar parsing and cent formatting  spec-002/T1
  e6dba0e  docs: add spec 002 for data and money                       spec-002
  f861d69  docs: close spec 001 and update the progress log            spec-001/T10
  ```

  The T6 commit follows them. Push only when the user asks. The plan is to push after
  spec 002 T6, so CI checks the seeded stack.
  (The `cc24a59` commit carries `Refs: spec-009/T1`, but spec 009 is a mini-spec with no
  tasks file: it should read `Refs: spec-009`. Unpushed, so it can still be amended.)

## What exists now

- `npm ci && npm test` runs 666 tests (shared 209, API 347, web 110). The API's integration tests
  run against a real Postgres through Testcontainers, so they need Docker. `lint`,
  `typecheck` and `test` build the shared package first.
  - Without Docker: `npx vitest run --project unit`, from `apps/api`.
- `cp .env.example .env && docker compose up --build --wait` brings up db, api and web, all
  healthy, in about 17 s with a warm npm cache (the same build with `--no-cache` took 10 s on
  top, because the npm download cache survives it; the first CI run is the honest cold
  number). The API migrates and seeds on start: 75 donations, 72 donors, the three demo
  accounts (see `apps/api/README.md`), and Aangan at 4,305,800 cents. A restart changes
  nothing. The API is on `:4000`, the site on `:3000`.
- `npm run db:migrate` and `npm run db:seed` (from the root) run the same steps by hand
  against `DATABASE_URL`; `db:seed` migrates first, and both are safe to run again.
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

- 002 (done in T6): shared's runtime dependency is in the API image;
  `import('@aangan/shared')` works there.
- 004 (done in T5): `trust proxy` is `1`, not `true`.
- 004 (done in T5): the access log carries no query string, so 005's `?q=` stays out of it.
- 006: behind Docker Desktop, nginx may see one gateway address for every host client, so all
  local e2e traffic shares one bucket of `DONATION_RATE_LIMIT` per 10 minutes, and compose does
  not forward that variable. Forward it in compose or keep e2e donations under the limit.
- 006: pending donations are never reconciled with the provider (the mock has no lookup call);
  list it under Known issues.
- 005: helmet CSP `default-src 'none'`; the `Origin` allow-list includes `:5173` in dev.

From [spec 002's task notes](specs/002-data-and-money/tasks.md):

- Done in 003: the pool parses `int8` and `int8[]` into safe numbers; `numeric` stays a string, so
  an uncast `SUM()` fails loudly. Cast every aggregate `::bigint`.
- 004: the receipt sequence continues from 76 (`receipt_number_seq`). The pool's `pg`
  errors carry the failing row in `detail`; the logger's `err` serializer drops it, so log
  with `{ err }` and never build a message from `error.detail`.
- 005: admin search must filter `email::text ILIKE …` to use the trigram index.
- 005: apply the login rate limit before the hash. Node's thread pool runs 4 scrypt hashes
  at once (~128 MiB each, ~17 logins/s measured), so give the container at least 1 GiB or
  add a small semaphore; add the dummy-hash comparison for unknown emails.
- 005: `verifyPassword` returns false for any derive failure, so a host short of memory would
  make every login read as a wrong password. Watch the login failure rate.

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
  `git commit -m $msg`. `git commit -F -` doesn't work with PowerShell pipes. From Git Bash,
  `git commit -F - <<'EOF'` works.
- Testcontainers works with Docker Desktop here: Ryuk on, no workaround, about 4 s for the
  container once the image is pulled.
- Backslashes in inline `node -e` or heredoc snippets run through Git Bash get collapsed
  (`\d` arrives as `d`). Put a patch script in a file, build a backslash with
  `String.fromCharCode(92)`, or use the Edit tool.

## How to resume on a fresh machine

```bash
git pull                # if working from another machine
node -v                 # v24.x
docker info             # daemon running
npm ci
cp .env.example .env    # if .env is missing
npm run lint && npm test
```
