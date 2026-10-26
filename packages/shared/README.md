# @aangan/shared

The contract between `apps/api` and `apps/web`. If it changes, both builds see it.

Today it holds the error envelope:

```ts
{ "error": { "code": ErrorCode, "message": string, "details"?: unknown } }
```

- `ERROR_CODES` / `ErrorCode`: every code the API can return. Each spec adds the codes its
  endpoints need.
- `ApiErrorBody`: the envelope type the API's error middleware builds.
- `isApiErrorBody(value)`: the guard the web client uses to read an error response. It
  rejects unknown codes, because it promises `code: ErrorCode`. A client on an older bundle
  therefore shows a generic error for a code it doesn't know yet.

And the money helpers (`src/money.ts`, ADR 0002). Money is integer cents everywhere:

- `AmountCentsSchema`: a donation amount, 100 to 2,500,000 cents (`MIN_DONATION_CENTS`,
  `MAX_DONATION_CENTS`). Rejects fractions, strings, `null` and `NaN`.
- `parseDollarsToCents(input)`: `"51"`, `"51.5"` or `"51.05"` to cents, using a regex and
  integer maths, never `parseFloat`. Trims whitespace. Returns `null` for anything else,
  including `"1,000.00"` (commas are locale-ambiguous), signs and exponents. Range is the
  schema's job.
- `formatCents(cents, locale?)`: `4305800` → `$43,058.00`, always in USD. The decimal
  string is built by slicing digits and formatted by `Intl.NumberFormat`, so no float is
  involved. There is no currency parameter, because cents assume two decimal places.
- `progressPercent(raised, goal)`: a whole percentage, rounded down. For integer inputs it
  is 0 when nothing is raised or the goal isn't positive, and never `NaN`. Not capped at
  100.

Endpoint DTOs and request schemas arrive with their endpoints (specs 003–005).

Both apps import the **built** output (`dist/`, ESM plus `.d.ts`), the same way in dev,
tests and Docker.

```bash
npm run build -w packages/shared   # tsc -p tsconfig.build.json → dist/
npm test -w packages/shared        # vitest
```

`tsconfig.json` covers `src` and `test` for typecheck and lint. `tsconfig.build.json`
emits `src` only, so tests never ship.
