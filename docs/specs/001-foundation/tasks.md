# Tasks 001 — Foundation

Flow per task: test (where one applies) → implementation → run checks → `code-reviewer`
on the diff → fix → tick the box here → Claude proposes the diff summary and commit
message → **Matheus commits**. The spec reference goes in the commit body as
`Refs: spec-001/Tn`.

Order is strict top to bottom. T1–T2 come before any feature code, as M1 requires. T3–T5
put the agent rules in place before the code they govern. Budget: about 1 h 15 in total.

- [x] **T1 — npm workspaces and Node pin**
  - Files: `package.json`, `package-lock.json`, `.npmrc`, `.gitattributes`, `.gitignore`
  - Done: `npm ci` succeeds on Node 24 and is refused on Node 22 (`engine-strict`).
    `git ls-files --eol` shows the new files as LF.
  - Commit: `chore: set up npm workspaces pinned to Node 24`

- [x] **T2 — TypeScript, ESLint and Prettier**
  - Files: `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`,
    root scripts
  - Done: `npm run lint` and `npm run format:check` pass with zero warnings. A scratch file
    using `parseFloat`, `.toFixed()` or `v-html` fails lint (checked manually, then deleted).
  - Commit: `chore: configure strict TypeScript, ESLint and Prettier`

- [x] **T3 — CLAUDE.md**
  - Files: `CLAUDE.md`
  - Done: it contains the mandatory spec rule verbatim, the user-commits rule, commands,
    conventions, the money rule, the security checklist and "no feature without a test".
    Under ~150 lines.
  - Commit: `docs: add the agent working rules in CLAUDE.md`

- [ ] **T4 — Subagents**
  - Files: `.claude/agents/{spec-writer,test-writer,code-reviewer,qa-verifier}.md`
  - Done: each has one job, minimal tools (the reviewer and verifier have no Edit/Write),
    and a defined output format. Invoking `code-reviewer` on the T2 diff returns ranked
    findings.
  - Commit: `chore: add spec, test, review and QA subagents`

- [ ] **T5 — Post-edit lint/typecheck hook**
  - Files: `.claude/settings.json`, `.claude/hooks/check-edited-file.mjs`
  - Done: introducing a type error in a `.ts` file makes the hook report it to the agent
    (exit 2). A clean edit is silent. The run time is noted here.
  - Commit: `chore: lint and typecheck files after agent edits`

- [ ] **T6 — Shared package with the error envelope**
  - Files: `packages/shared/{package.json,tsconfig.json,src/index.ts,src/errors.ts,test/errors.test.ts,README.md}`
  - Test first: `isApiErrorBody` accepts and rejects the cases in tech spec §8.
  - Done: `npm test -w packages/shared` is green, and `build` emits `dist/` with `.d.ts`.
  - Commit: `feat(shared): add the API error envelope type`

- [ ] **T7 — API skeleton with health and error handling**
  - Files: `apps/api/{package.json,tsconfig.json,src/{config,logger,app,start}.ts,src/http/{health,errors}.ts,src/db/pool.ts,test/{health,errors}.test.ts,README.md}`
  - Test first: health 200/503, 404 envelope, 500 without leaks, 400 on malformed JSON.
  - Done: tests green. `npm run dev -w apps/api` against a local db answers
    `/api/health`. Missing env vars fail fast with the variable's name, not its value.
  - Commit: `feat(api): add the Express skeleton with a health check`

- [ ] **T8 — Web skeleton**
  - Files: `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,src/{main.ts,App.vue,api.ts},README.md}`
  - Done: `build` and `typecheck` (vue-tsc) pass. In dev, the page shows "API: ok" through
    the Vite proxy. `isApiErrorBody` is imported from shared.
  - Commit: `feat(web): add the Vue skeleton that reads API health`

- [ ] **T9 — Docker compose stack**
  - Files: `apps/api/Dockerfile`, `apps/web/{Dockerfile,nginx.conf}`, `docker-compose.yml`,
    `.dockerignore`, `.env.example`
  - Done: after `docker compose down -v && docker builder prune -f`,
    `cp .env.example .env && docker compose up --build --wait` exits 0. The curls in PRD
    US-1 pass. `id -u` ≠ 0 in api and web. The cold-build time is noted here. Without
    `.env`, compose fails with the copy hint.
  - Commit: `build: add the docker compose stack with health checks`

- [ ] **T10 — CI workflow**
  - Files: `.github/workflows/ci.yml`
  - Done: after Matheus pushes, both `check` and `stack` are green on GitHub. A link to the
    run is recorded here.
  - Commit: `ci: run checks and a compose smoke test on every push`

## Notes recorded during execution

- T2: root scripts are only `lint`, `format`, `format:check` for now. `typecheck`, `build`,
  `test` and `dev` arrive with the workspaces they run (T6–T8), not as placeholders.
- T2: Prettier runs as `prettier .` and `.prettierignore` excludes `*.md`, `roles/` and the
  lockfile. Same outcome as an extension list, with one source of truth.
- T2: `defineConfig` from `eslint/config` instead of the deprecated `tseslint.config()`.
- T2: guard check passed: a scratch `.ts` and `.vue` failed on `no-restricted-globals`,
  `no-restricted-properties`, `no-restricted-syntax` (toFixed) and `vue/no-v-html`. Deleted.
- T2 review: the `code-reviewer` subagent only exists from T4, whose Done runs it on this diff.
- T3: 130 lines. The commands table marks which spec each command arrives in, so nothing
  is listed as a placeholder script. The rule text was checked line by line against the original.
