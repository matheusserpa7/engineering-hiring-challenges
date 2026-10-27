# End-to-end tests

Playwright on Chromium and WebKit, against the running compose stack. It never starts or resets
the stack.

```bash
docker compose up --build -d
npx playwright install chromium webkit    # once; add --with-deps on Linux
npm run e2e                               # from the root; builds shared first
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e   # another origin from ALLOWED_ORIGINS
```

| Spec | What it proves |
|---|---|
| `public` | The page shows the API's total and fits 375 px, also with the form open |
| `donate` | A $21 gift gets a receipt, appears in the list after a reload, and moves the total by 2,100 |
| `refund` | A gift whose donor name is an `<img onerror>` payload shows as text in the list and in the admin table; refunding returns the total |
| `session` | A well-formed session cookie the server never issued lands on `/login` |
| `xss` | The seeded script and `onerror` strings render as text in the public list; the seeded rows render in the admin table |

Every spec fails on a dialog or a CSP report, except `style-src-attr` (see the root README).

- **Serial, no retries.** Every spec reads and moves one campaign total, and a retry would hide a
  flake that is really a bug. Totals are compared as differences, never as the seed's numbers.
- **Budget.** A run uses 4 logins and 4 donations; the limits are 20 per 15 minutes and 30 per 10
  minutes. Raise `LOGIN_RATE_LIMIT` and `DONATION_RATE_LIMIT` in `.env` and run
  `docker compose up -d` for many runs.
- **WebKit** does not send the `Secure` cookie over `http://localhost`, so `refund` and the admin
  `xss` case are skipped there. `COOKIE_SECURE=false` makes them run.
- A failed run leaves `playwright-report/` and `test-results/`, both git-ignored.
