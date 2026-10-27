# Progress

Where the work stands, and what comes next. Updated whenever a task or a session ends.
The plan itself lives in [`specs/000-overview/tasks.md`](specs/000-overview/tasks.md). This
file is only the current position.

Last updated: 2026-10-27

## Resume here

**Spec 006 is implemented (T1–T12 of 13) and QA found no failures. What is left is the author's:
record the video, then T13 (link the video, close this file) and the delivery steps.**

1. Read [`CLAUDE.md`](../CLAUDE.md), then this file.
2. CI is green on the pushed e2e job: [run 40549949249](https://github.com/matheusserpa7/engineering-hiring-challenges/actions/runs/40549949249)
   (spec 006 T6). The QA evidence is in [`specs/006-hardening-and-submission/checklist.md`](specs/006-hardening-and-submission/checklist.md).
3. Before submitting, the author: confirms `AI-USAGE.md` (the tools, which changes were his own),
   records the video from
   [`video-outline.md`](specs/006-hardening-and-submission/video-outline.md), then T13. Open the video
   link and both URLs in a private window.
4. Delivery: repo public (or `@sandesPathak` invited), `FirstName_LastName.zip` with `.git` and without
   `node_modules`, and the email from `SUBMISSION.md`. Then stop before any optional spec.

## Phases

| Phase | What | Status |
|---|---|---|
| 0 — Understanding | Read the brief, rubric, checklist and docs 00–11; verify the seed data; list ambiguities | Done |
| 1 — Overview | [PRD](specs/000-overview/prd.md), [Tech Spec](specs/000-overview/techspec.md), [Tasks](specs/000-overview/tasks.md), [ADRs 0001–0005](adr/) | Done · `02b074f` |
| 2 — Foundation | [Spec 001](specs/001-foundation/): workspaces, tooling, CLAUDE.md, subagents, hook, Docker stack, CI | Done · CI green: [run 40324681629](https://github.com/matheusserpa7/engineering-hiring-challenges/actions/runs/40324681629) |
| 3 — Features | Specs 002–005 (must-haves), then the status report | **Specs 002–005 implemented; the status report is left** |
| 4 — Submission | Spec 006: hardening, e2e, READMEs, AI-USAGE.md, clean-clone rehearsal, video | Not started |

## Specs

| Spec | Status | Tasks |
|---|---|---|
| 000-overview | Approved, committed | — |
| 001-foundation | Done, pushed, CI green | 10 / 10 |
| 002-data-and-money | Implemented, closed by CI and QA | **6 / 6** (T1 `5244ca5` · T2 `27f850e` · T3 `b9cfb7b` · T4 `621646b` · T5 `a50f445` · T6 in the next commit) |
| 003-public-campaign | Implemented, pushed | **7 / 7** |
| 004-donation-intake | Implemented, pushed | **9 / 9** |
| 005-auth-admin-refunds | Implemented, pushed, CI green (run 40540529874) | **10 / 10** (T1 `b58d10f` · T2 `5295230` · T3 `219cda5` · T4 `e3bf653` · T5 `826d46b` · T6 `bdc1aac` · T7 `00c6c7c` · T8 `458a061` · T9 `da7ecba` · T10 in the next commit) |
| 006-hardening-and-submission | Implemented, pushed except the last commits; waits for the video | **12 / 13** (T13 needs the video link) |
| 007 (S0) / 008 (X1) | Optional, only after 006 | — |

## Git state

- Branch `main`, tracking `origin/main` on the user's fork. 
- `origin/main` is at `725b96a` (spec 006 up to the progress log), CI green.
- `tasks.md` of spec 005 was overwritten by a script in the T3 commit and restored in the T6 commit;
  the history shows it. The T3 commit also changes decision F1 (login attempts all count).

## What exists now

- `npm ci && npm test` runs 940 tests (shared 275, API 488, web 177). The API's integration tests
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
- 005 (done in T2): helmet CSP `default-src 'none'`; the `Origin` allow-list includes `:5173` in dev.

From [spec 002's task notes](specs/002-data-and-money/tasks.md):

- Done in 003: the pool parses `int8` and `int8[]` into safe numbers; `numeric` stays a string, so
  an uncast `SUM()` fails loudly. Cast every aggregate `::bigint`.
- 004: the receipt sequence continues from 76 (`receipt_number_seq`). The pool's `pg`
  errors carry the failing row in `detail`; the logger's `err` serializer drops it, so log
  with `{ err }` and never build a message from `error.detail`.
- 005 (done in T5): the email arm filters `email::text ILIKE …` in a subquery and uses the trigram
  index. The name arm does not (the `OR` keeps a sequential scan on `donations`); a `UNION` of id
  sets fixes it if the table grows.
- 005 (done in T3): the login limiter runs before the hash, scrypt runs two at a time, unknown
  emails verify against a dummy hash made at boot (a host short of memory fails at boot).
  `verifyPassword` still returns false for any derive failure; watch the login failure rate.

From [spec 005's task notes](specs/005-auth-admin-refunds/tasks.md), for spec 006:

- Login attempts all count toward `LOGIN_RATE_LIMIT` (20 per address per 15 minutes, successes
  included), and compose forwards no such variable. Behind Docker Desktop every local client may
  share one bucket, so e2e that signs in often must stay under it or compose must forward it.
- `vue/no-v-html` does not catch `:innerHTML`; add a lint rule. The admin and donor pages render
  every donor-typed string as text and tests mutate this.
- No automated browser test of login → refund → public total (done by hand at 375 px), and none
  of WebKit with `Secure` cookies on `http://localhost`; `COOKIE_SECURE=false` is the fallback.
- Known issues to list: a refund that meets a `pending` row intake completes a moment later is a
  409 `not_refundable` (retry works); no lockout across many addresses on one account; signing in
  as B in a browser holding A's cookie leaves A's session valid until it expires; name search
  scans `donations` sequentially.
- QA run on specs 002–005 (2026-10-27, `qa-verifier`): every checkable criterion passed. One
  failure: `GET /api/campaigns/%E0%A4%A` (an undecodable percent-escape) through nginx on :3000
  answers nginx's HTML 400, not the JSON `bad_request` envelope of spec 003 US-5. The same
  escape in `/api/donations/:id` is also a 400 from Express, not the 404 of F12. Fix in nginx
  (or accept and list it under Known issues). Not verified by QA, so 006 must: XSS rows in a
  real browser, the 375 px layout of the public page, session expiry and tampered cookies against
  the stack, login timing, provider-call counts, the token paths and the 429 limit end to end.
- `/me/donations` returns the newest 100 with no paging; the admin list pages by 25.
- A lost 200 on a refund followed by a retry shows 409 `already_refunded`, which the admin page
  reads as done.

## Open items that aren't code

- **Clarification email** to the company: the five questions in
  [PRD 000 → Open questions](specs/000-overview/prd.md#open-questions-to-email). **Not
  yet sent.** Until answers arrive, assumptions A1–A12 in the PRD apply.
- **Time spent:** the user does not want hours in the repository; he sends his subscription usage
  himself. The README has no time section.
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
