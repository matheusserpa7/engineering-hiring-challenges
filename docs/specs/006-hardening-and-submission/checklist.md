# Submission checklist — evidence

Mirrors `roles/full-stack-engineer/CHECKLIST.md`, which stays unedited. Each item is
**pass**, **n/a** or **fail**, with the command or the file that shows it. The Security rows
were filled by the T7 sweep on 2026-10-27 at `a9afe9a`; the other sections by T10 and T11.

## Security (T7)

| Item | Result | Evidence |
|---|---|---|
| `git log -p` grep finds nothing real | pass | Hits are the public demo passwords (`admin12345`, `donor12345`, `other12345` in the seed, tests and docs), the `POSTGRES_PASSWORD=change_me_locally` placeholder, token/password identifiers in code and specs. No key, no private key. |
| gitleaks over all history (v8.30.1, 93 commits) | pass | 3 findings, all `generic-api-key` on the test idempotency key `3f2b8c1e-5a47-4d0e-9c6b-1a2b3c4d5e6f` (`apps/api/test/db/donations-idempotency.test.ts:21`, `donations.test.ts:26`, `packages/shared/test/donations.test.ts:187`). A fixed UUID, not a credential. |
| `.env` not committed, `.env.example` is | pass | `.gitignore` lists `.env`; `git ls-files .env` is empty. |
| `npm audit --omit=dev` | pass | `found 0 vulnerabilities`. |
| Headers, SPA (`/`, `/login`, `/assets/*.js`) | pass | nginx CSP `default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Server: nginx` with no version. |
| Headers, API (`/api/health`) | pass | helmet CSP `default-src 'none';frame-ancestors 'none'`, `nosniff`, no `X-Powered-By`. |
| nginx's own 400 | pass | JSON envelope with `nosniff` (T2; CI compares it with the API's). |
| Containers do not run as root | pass | `docker compose exec api id -u` → 1000; `web` → 101. |
| Money: no float columns, no `parseFloat`/`toFixed` | pass | grep over `apps/*/src`, `packages/*/src`, `e2e`: no hits; lint bans both. The migration has no float or double column (only comments mention them). |
| Errors leak nothing | pass | `apps/api/src/http/errors.ts:53` is the one `.message` in `http/`: it is an `AppError`'s own fixed text, never a caught exception's. |
| Timezones | pass | no `getMonth` or `new Date()` in `services/`, `repositories/`, `http/`. |
| Unicode | pass | `toLowerCase` only on emails (ASCII by schema); names use NFC and `ILIKE`. |
| `any` / `console.` / narration / `TODO` | pass | zero hits in source and READMEs. |
| Files over ~500 lines | pass | one: `apps/api/test/db/public-donations.test.ts` (518), a test file, left whole. |
