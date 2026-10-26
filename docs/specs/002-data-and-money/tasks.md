# Tasks 002 — Data and money

Flow per task: test first → implementation → run checks → `code-reviewer` on the diff →
fix → tick here → diff summary, decisions and commit message → Matheus says go → commit.
`Refs: spec-002/Tn` goes in the commit body. The order is strict. Budget: about 1 h 15.

- [x] **T1 — Shared money helpers**
  - Files: `packages/shared/{src/money.ts,src/index.ts,test/money.test.ts,package.json,README.md}`
  - Test first: `money.test.ts` (tech spec §9, row 1). These are the M8 money boundary
    tests.
  - Done: the shared tests are green, and `parseFloat` / `toFixed` appear nowhere (lint
    already enforces it). `zod` is a runtime dependency of shared.
  - Commit: `feat(shared): add exact dollar parsing and cent formatting`

- [x] **T2 — Kysely, the int8 parser and the first migration**
  - Files: `apps/api/src/db/{pool,database,migrate}.ts`, `apps/api/src/db/migrations/0001_initial.ts`,
    `apps/api/src/scripts/migrate.ts`, `apps/api/{vitest.config.ts,test/global-setup.ts,test/db/migration.test.ts,package.json,tsconfig.json}`,
    root `package.json` (`db:migrate`)
  - Test first: `migration.test.ts`. The constraints reject bad rows, and int8 comes back
    as a safe number.
  - Done:
    - The integration tests are green against Testcontainers on this machine. The
      Windows/Ryuk risk gets resolved or noted here.
    - `npm run db:migrate` against the compose db works, and running it twice is a no-op.
  - Commit: `feat(api): add the initial schema migration`

- [x] **T3 — Password hashing**
  - Files: `apps/api/src/auth/password.ts`, `apps/api/test/password.test.ts`
  - Test first: `password.test.ts`.
  - Done: green. The stored format carries its parameters. A malformed hash returns false.
  - Commit: `feat(api): hash passwords with scrypt`

- [x] **T4 — Seed reader**
  - Files: `apps/api/src/db/seed/read-seed.ts`, `apps/api/test/read-seed.test.ts`
  - Test first: `read-seed.test.ts`. It runs on the real seed files, plus an LF copy and a
    CRLF copy.
  - Done: green. A bad row fails naming its receipt number and nothing else.
  - Commit: `feat(api): parse the seed files into validated records`

- [ ] **T5 — Idempotent seed, on start and on demand**
  - Files: `apps/api/src/db/seed/seed.ts`, `apps/api/src/start.ts`,
    `apps/api/src/scripts/seed.ts`, `apps/api/test/db/seed.test.ts`, root `package.json`
    (`db:seed`), `apps/api/README.md`
  - Test first: `seed.test.ts`. It checks the seed-data README numbers, idempotency, the
    accounts and the sequence.
  - Done:
    - Green.
    - `npm run db:seed` twice against the compose db leaves 75 donations.
    - `start.ts` logs migrate → seed → listening, and exits 1 naming the step if one
      fails.
  - Commit: `feat(api): seed the campaign data on start`

- [ ] **T6 — Seed data in Docker and CI**
  - Files: `apps/api/Dockerfile`, `.github/workflows/ci.yml`, `docs/PROGRESS.md`
  - Done:
    - From a pruned cache, `up --build --wait` exits 0.
    - `psql` shows 75 donations and Aangan's 4,305,800 cents.
    - A restart keeps 75 rows.
    - `import('@aangan/shared')` works inside the API image.
    - The CI `stack` job asserts the two numbers, and both jobs are green after the push.
    - The cold-build time is noted here.
  - Commit: `build: ship the seed data in the api image and check it in CI`

## Dependencies

T1 comes first: T4 parses dollars with it. T2 comes before T5 (schema) and T3 before T5
(account hashes). T4 comes before T5. T6 comes last.

## Notes recorded during execution

- T1, done. Test-first: red because the module was missing; now 46 money tests, 60 in
  shared.
  - Review: no blockers. The money path is exact; the reviewer compared it against string
    arithmetic over the whole 7-digit range and against BigInt on 200,000 random cases.
  - Major, fixed: the "keeps every cent" test passed even with `cents / 100`. It now uses
    `Number.MAX_SAFE_INTEGER`, where the float version prints `.90` instead of `.91`.
    Checked side by side.
  - Major, fixed: tech spec §2 said "integer division", but the code slices digits.
    Spec updated first.
  - Minors, fixed:
    - `formatCents` lost its `currency` parameter and is always USD. With JPY it would
      silently round away cents. Spec updated first.
    - A test for the negative sign.
    - An accurate comment on what `.int()` adds.
    - The README's "never `NaN`" is now qualified as holding for integer inputs.
    - The package description.
  - Confirmed by the review:
    - `\d` matches ASCII digits only, so Devanagari or full-width digits are rejected.
    - `trim()` removes non-breaking spaces.
    - The regex can't backtrack catastrophically: a 1 MB input takes under 1 ms.
- T2, done. Test-first: red because the modules were missing.
  - Two deliberate mutations proved the tests bite: the int8 parser turned off gave 6
    failures; the amount lower bound set to 1 gave 2.
  - The Testcontainers/Windows risk is resolved (tech spec §11).
  - Review, 3 majors, fixed after the spec was updated first:
    - The int8 parser didn't cover `int8[]`, so `preset_cents` arrived as `string[]`
      (§4).
    - The hand-written types had no typed round-trip test (§4, §9).
    - Integration files ran in parallel and truncated each other's tables; they now run
      one at a time (§9).
  - Minors accepted:
    - No concurrent-migration test: the advisory lock is Kysely's documented behaviour.
    - No FK tests for `refunds.actor_id` / `sessions.donor_id`: not in §9.
    - `loadConfig()` outside the `try` in the migrate script stays; it's cosmetic.
  - Forward notes:
    - Spec 005: filter admin search on `email::text ILIKE …`, so it uses the trigram
      index (tech spec §3).
    - T5: `start.ts` gets its own pool with a longer `query_timeout` for migrate + seed,
      or the decision is revisited (§11).
- T3, done. Test-first: red because the module was missing.
  - Two deliberate mutations proved the tests bite: no NFC gave 1 failure; rethrowing
    scrypt errors gave 3.
  - The fixed 32-byte key length was found by the red test run, not planned: a truncated
    stored key verified. The code came first and tech spec §6 and §9 were updated after
    it, against the spec-first rule.
  - Review: no blockers. Major, fixed: the "non-base64 junk" cases passed only because junk
    decodes to 0 bytes, so the strict round-trip had no test. New cases put one stray
    character, space or newline, or strip the padding, on valid base64 that still decodes
    to the real bytes. Removing the round-trip check now fails exactly those 5.
  - Minors, fixed:
    - `decodeBase64` lost its redundant length and `undefined` checks; the key-length
      guard is simpler.
    - The NFC/NFD test uses `\u` escapes, so a formatter can't normalise them.
    - Lone-surrogate and NUL-byte password cases.
    - Comments on why the short and long key cases matter.
  - Minors accepted:
    - The `catch` returns `false` for every derive failure, not only invalid params. A
      host short on memory would make every login read as a wrong password. Spec 005
      sets a container memory floor and watches login failures; testing a rethrow would
      need a memory-starved host.
    - No cap on `r`/`p` beyond `maxmem`: the stored value is ours. A huge `p` within
      `maxmem` could pin a thread; noted, not fixed.
    - Salt length is not enforced on verify: harmless, it is only scrypt input.
  - Forward notes for spec 005:
    - Apply the login rate limit before the hash.
    - The default libuv pool is 4 threads, shared with fs and dns: at most 4 concurrent
      hashes at ~128 MiB each (~512 MiB peak, ~17 logins/s measured). Set a container
      memory limit of at least 1 GiB, or decide on a small semaphore or
      `UV_THREADPOOL_SIZE`.
    - The dummy-hash comparison for unknown emails stays in 005.
- T4, done. Test-first: red because the module was missing.
  - Two checks were added during implementation, and tech spec §5 and §9 were updated
    after the code, against the spec-first rule: an unknown campaign slug and a duplicate
    receipt number fail the file. The PII-free error handling (`csv-parse` code only, no
    Zod messages) was written down at the same time.
  - The test-writer asserted row 14 = 280 code points from the README; it had read only 20
    rows. The file has 283 (A1), so the test was corrected, not the parser.
  - Four deliberate mutations each failed exactly the intended test: no NFC, no
    lower-casing, the donor name added to an error message, the duplicate check off.
  - Review: no blockers. The fixes below went into the code first; tech spec §5 and §9
    were updated after it, against the spec-first rule.
    - Major (fixed): the receipt number was echoed unvalidated into the error message, a
      PII path if columns shift; the unknown-key test asserted only `.toThrow()`.
    - Minor (fixed): empty-file rejection, duplicate campaign slug, currency format, the
      error code asserted for malformed CSV, many untested paths pinned.
    - Mutations on the new checks: receipt format off → 4 failures, empty-file check off
      → 2, duplicate-slug check off → 1.
    - Accepted, not fixed:
      - a duplicate CSV header name is collapsed by `csv-parse` to the last column. The
        seed is immutable and a duplicated header is a malformed file;
      - whitespace-only values pass `min(1)`, and `parseDollarsToCents` trims (by design,
        shared T1);
      - no check that min ≤ max or `endsAt` ≥ `startsAt` on campaigns. The database check
        constraint rejects min/max, and the seed is fixed;
      - quoted newlines are kept as in the file, so CRLF and LF files give different
        message text. The real seed has none.
