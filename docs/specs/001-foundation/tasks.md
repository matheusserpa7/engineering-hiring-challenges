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

- [x] **T4 — Subagents**
  - Files: `.claude/agents/{spec-writer,test-writer,code-reviewer,qa-verifier}.md`
  - Done: each has one job, minimal tools (the reviewer and verifier have no Edit/Write),
    and a defined output format. Invoking `code-reviewer` on the T2 diff returns ranked
    findings.
  - Commit: `chore: add spec, test, review and QA subagents`

- [x] **T5 — Post-edit lint/typecheck hook**
  - Files: `.claude/settings.json`, `.claude/hooks/check-edited-file.mjs`
  - Done: introducing a type error in a `.ts` file makes the hook report it to the agent
    (exit 2). A clean edit is silent. The run time is noted here.
  - Commit: `chore: lint and typecheck files after agent edits`

- [x] **T6 — Shared package with the error envelope**
  - Files: `packages/shared/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/errors.ts,test/errors.test.ts,README.md}`, root `package.json` scripts
  - Test first: `isApiErrorBody` accepts and rejects the cases in tech spec §8.
  - Done: `npm test -w packages/shared` is green, and `build` emits `dist/` with `.d.ts`.
  - Commit: `feat(shared): add the API error envelope type`

- [x] **T7 — API skeleton with health and error handling**
  - Files: `apps/api/{package.json,tsconfig.json,tsconfig.build.json,src/{config,logger,app,start}.ts,src/http/{health,errors}.ts,src/db/pool.ts,test/{health,errors,config}.test.ts,README.md}`, plus `payload_too_large` in shared's `ERROR_CODES`
  - Test first: health 200/503, 404 envelope, 500 without leaks (detail only in the log),
    400 on malformed JSON, 413 over the body limit, config errors name the variable only.
  - Done: tests green. `npm run dev -w apps/api` against a local db answers
    `/api/health`. Missing env vars fail fast with the variable's name, not its value.
  - Commit: `feat(api): add the Express skeleton with a health check`

- [x] **T8 — Web skeleton**
  - Files: `apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,src/{main.ts,App.vue,api.ts,env.d.ts},test/api.test.ts,README.md}`,
    plus the root `dev` script (`concurrently`) and shared's `dev` (`tsc --watch`), since
    T8 adds the last workspace it runs
  - Test first: `getJson` returns the parsed body on 2xx, and `undefined` for an empty
    one. It throws `ApiError` with the envelope's code on an API error, and a generic
    `unexpected_response` on anything else, including a 2xx whose body isn't JSON.
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
  lockfile. One source of truth instead of an extension list. It also formats `.html` and
  `.yaml`, which is wanted.
- T2: `defineConfig` from `eslint/config` instead of the deprecated `tseslint.config()`.
- T2: guard check passed: a scratch `.ts` and `.vue` failed on `no-restricted-globals`,
  `no-restricted-properties`, `no-restricted-syntax` (toFixed) and `vue/no-v-html`. Deleted.
- T2 review: the `code-reviewer` subagent only exists from T4, whose Done runs it on this diff.
- T3: 130 lines. The commands table marks which spec each command arrives in, so nothing
  is listed as a placeholder script. The rule text was checked line by line against the original.
- T4: Claude Code registers agents only at session start, so the first review ran as a
  general-purpose agent given `code-reviewer.md` verbatim. Its review of the T2 commit
  (`6ab79d2`) returned 1 major and 6 minor findings, verdict "fix first". The major one,
  confirmed by hand: the money rules do not reach Vue template expressions. That fix gets
  its own commit after T4.
- T2 fix, after T4 (tech spec §1 updated first): `vue/no-restricted-syntax` adds the money
  bans for templates. `checkGlobalObject` and an any-receiver `toFixed` property ban close
  the script bypasses. `no-undef` is off for `.vue`, and the Playwright ignores match at any
  depth. `.cjs` support was tried and dropped, because every package is ESM.
  - A second review found that template bracket access (`x['toFixed']`) still passed, so
    `property.value` selectors were added. `vue/block-lang` now requires `lang="ts"`,
    because `no-undef: off` relies on TypeScript checking every script block.
  - Final guard check: 6 script cases and 5 template cases fail lint (dot and bracket
    forms), and so does a `.vue` file without `lang="ts"`. Not caught in templates, and
    accepted: template-literal keys (`` x[`toFixed`] ``) and `v-slot` destructuring.
- For T6–T8, from the same review (TypeScript 6 behaviour):
  - every workspace tsconfig must set `module` explicitly;
  - the API config needs `"types": ["node"]`, because `types` now defaults to `[]`;
  - each workspace tsconfig must include its own config files (`vitest.config.ts`,
    `vite.config.ts`), or lint can't find them through the project service.
- T5: **~2.2 s per edit** (eslint on one file plus `tsc --noEmit` on a one-file package),
  well under the 10 s threshold in the risk table. Re-measure once `apps/api` is real.
  - Spec tweak (tech spec §2 updated first): the hook runs `npm run typecheck` in the
    nearest folder with a `package.json`, instead of `-w <name>`.
  - Verified with a scratch package, since deleted. The pipe test passed for clean,
    type-error, lint-error, skipped and relative-path inputs. A live Edit introducing a type
    error got `TS2322` back from the hook, and the fixing edit was silent.
  - Testing gotcha: PowerShell 5.1 adds a BOM when piping to a program. Test the hook
    from Git Bash, which is how Claude Code runs it.
  - Review: no blockers or majors, 5 minors, all fixed.
    - The search for a `package.json` stops at the repo root. Before, a file written
      ahead of its `package.json` could trigger the root typecheck, or loop forever.
    - The path is resolved once and used everywhere, so a relative path is checked
      even when sent from another working directory.
    - With no `node_modules`, the hook says "run `npm ci`" instead of printing a stack trace.
    - Files under `node_modules/` and `dist/` are skipped.
    - A comment wrongly said the hook runs in CI. It doesn't, and the comment is fixed.
  - Re-test after the fixes: all seven pipe cases pass, plus the missing-dependencies case.
    A malformed stdin gives exit 1, which is non-blocking, so the hook fails open.
- T6, recorded before the code:
  - The package is `@aangan/shared`.
  - It has two tsconfigs. `tsconfig.json` (src + test, `noEmit`) serves typecheck and lint.
    `tsconfig.build.json` (src only) emits `dist/`, so tests never ship.
  - Root `build`, `typecheck` and `test` scripts arrive here, with their first workspace.
  - `ErrorCode` holds only the codes spec 001 uses: `malformed_json`, `not_found`,
    `unavailable`, `internal_error`. Each later spec adds its own with its endpoint.
  - Shared runs in the browser too, so it gets no `"types": ["node"]`. The TypeScript 6
    note above was narrowed to the API.
- T6, done: the test was red first (module not found) and is now green, 14 cases. The
  build emits `dist/` with `.d.ts`.
  - Review, major: `typecheck` and `lint` didn't build shared, and the apps resolve it
    from `dist/`. A fresh clone and the CI `check` job would have failed from T7 on.
    Fixed with an explicit `build:shared` chained before `typecheck`, `lint` and `test`
    (tech spec §1 updated first). Verified starting from no `dist/`.
  - Review, minors:
    - The comment's reason for rejecting unknown codes was overstated. It now gives the
      real reason, honest narrowing, and names its cost.
    - Added a test with an `Object.prototype` key (`toString`) as the code, which pins
      the `Set` lookup.
    - Tech spec §3 and §4 were out of step with the code; corrected.
    - Added `declarationMap`, so go-to-definition lands in `src`.
  - Install gotcha: `npm` runs through `cmd.exe` here, where `^` is an escape character.
    Don't put `^` ranges in npm arguments; npm writes the caret into `package.json` itself.
  - Install gotcha: the first `npm install -w <dir>` into a brand-new workspace has twice
    done nothing silently. Check `package.json` afterwards and re-run if needed.
- T7, done. Tech spec §4 and §8 were updated before the code: the 413 code, the pool's
  timeouts and error listener, `config.test.ts`. Tests were red first (modules missing),
  now 13 green.
  - Manual check against a real Postgres:
    - 200 when the database answers.
    - Database stopped: 503 in 0.1 s, and the process survives the idle client's error.
    - Database paused: 503 in 5.1 s on an open connection, 2.2 s on a new one, then 200
      once it's unpaused.
    - A missing `DATABASE_URL` stops boot and names only the variable.
    - `npm run dev` reads the root `.env`.
  - SIGTERM can't be tested on Windows; it is checked in T9 by timing `compose down`.
  - esbuild's postinstall is skipped by npm 11's script approval. tsx works without it, so
    no approval was added.
  - Review: 2 majors, 9 minors.
    - Major: client errors (bad charset or encoding, an undecodable URL parameter) became
      500s logged as errors. Now they get their 4xx status and the `bad_request` code, and
      are not logged as errors. Test-first: the charset case returned 500.
    - Major: `connectionTimeoutMillis` doesn't cover a query on an open connection, and a
      paused database hung the health check indefinitely. Fixed with `query_timeout` 5 s,
      verified with `docker pause`.
    - Minors fixed: one-shot shutdown with an 8 s forced exit; the `headersSent` path logs
      through pino; a test for async throws; a test for log redaction; README corrections;
      `NODE_ENV` removed from the schema because nothing reads it yet.
    - Accepted: a 500 produces two log lines, the access line and the error line with
      its cause.
    - Deferred, each to the spec where it matters:
      - helmet CSP `default-src 'none'`: spec 005, ADR 004.
      - `trust proxy` behind nginx, needed for per-IP rate limits: spec 003.
      - The access log includes `?q=`, a donor-name search, so redact or omit the query
        string: spec 004.
      - An empty env var (`PORT=`) fails instead of taking its default, so compose must
        leave unset variables out: T9.
      - The undecodable URL parameter case gets its own test once routes have parameters:
        spec 002.
- T8, done. Test-first `api.test.ts` (red: module missing), now 5 green. vue-tsc, build
  and lint pass.
  - Manual check:
    - With the API and Vite running, curl through the proxy gets 200, and headless Edge
      (JavaScript executed) renders "API: ok".
    - With the database stopped, it renders "API: unavailable".
    - Root `npm run dev` starts all three in about 2 s and renders "API: ok".
  - `src/env.d.ts`: plain TypeScript, which type-aware lint uses, can't read `.vue`.
    vue-tsc still checks the real component types; the review confirmed that a wrong prop
    type is still caught.
  - Review: 1 major, 5 minors, all fixed (tech spec §8 and this task updated first).
    - Major: tech spec §1 and `CLAUDE.md` promised a root `npm run dev`, but no task added
      it. It's added here, with `concurrently` and shared's `tsc --watch`.
    - Minors:
      - A 2xx that isn't JSON counted as success, so a mis-routed `index.html` would have
        shown "API: ok". It's now `unexpected_response`; test-first, it was red.
      - Tests added for the 204 case and the non-JSON 2xx.
      - The README now says a network failure is fetch's `TypeError`.
      - The page title used an organisation name that isn't in the brief.
      - Removed the unused `jsx` option.
  - Forward notes:
    - T9: Vite inlines assets under 4 kB as `data:` URLs, which `default-src 'self'`
      blocks. Set `build.assetsInlineLimit: 0`, or allow `img-src data:`, when the first
      asset arrives.
    - Spec 005: the Vite proxy doesn't rewrite `Origin`, so the `Origin` allow-list needs
      `http://localhost:5173` in dev.
