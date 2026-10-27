# @aangan/shared

The contract between `apps/api` and `apps/web`. If it changes, both builds see it.

It holds the error envelope:

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

And the public campaign contract (`src/campaigns.ts`, spec 003). The API builds these shapes
and the web app parses every response with them:

- `PublicCampaignSchema` / `PublicCampaign`: a campaign with its derived totals
  (`raisedCents`, `donorCount`, `progressPercent`) and its `phase` (`upcoming`, `open` or
  `closed`).
- `PublicDonationSchema` / `PublicDonation`: one row of the public list. It is strict, so a
  field that is not listed (an email, a donor id) cannot appear. `PublicDonationListSchema`
  is the `{ data: [...] }` body of the list endpoint.
- Dates are UTC strings ending in `Z`. An offset is rejected, so the API serialises a `Date`.
- `CampaignSlugSchema`, and `RecentDonationsQuerySchema` for `?limit=` (1 to 50, default 20:
  `DEFAULT_RECENT_DONATIONS`, `MAX_RECENT_DONATIONS`). The limit is matched as digits first,
  so `''` and `1e1` are rejected rather than coerced.
- `validation_failed` joins the error codes, for a 422.

And the donation intake contract (`src/donations.ts`, spec 004):

- `DonationRequestSchema`: the `POST /api/donations` body. Strict at every depth, so a
  `status`, `donorId` or `role` is a 422. Text is NFC; lengths count code points (a 280-emoji
  message passes, 281 fails). Names go through `normaliseName`; `email` is trimmed and
  lower-cased; a blank `message` becomes `null`. `privacyMode` is required.
- `normaliseName(value)`: NFC, then every run of whitespace, U+200B or U+2060 becomes one
  space, then trim.
  ZWJ and ZWNJ stay, because Devanagari conjuncts need them. `codePointLength` is exported
  for the form's counter.
- `IdempotencyKeySchema`: a UUID in any case, lower-cased. `DonationReceiptSchema`: the 2xx
  body, strict; `receiptNumber` is `HCC-YYYY-` plus six or more digits.
- Nine error codes join the list: `idempotency_key_required`, `idempotency_key_mismatch`,
  `request_in_progress`, `card_declined`, `insufficient_funds`, `payment_provider_error`,
  `campaign_closed`, `amount_out_of_range`, `rate_limited`.

And the auth and donor-record contracts (`src/auth.ts`, `src/donor-records.ts`, spec 005):

- `LoginRequestSchema`: `{ email, password }`, strict, so a `role` is a 422. The email is
  NFC, trimmed and lower-cased; the password is only length-checked (1 to 256 code points).
  `SessionResponseSchema`: `{ user: { id, email, fullName, role } }`.
- `DonationDetailSchema`: what a donor sees of their own donation. `AdminDonationSchema` adds
  `donorEmail` and `failureCode`; `AdminDonationPageSchema` is the `{ data, page, pageSize,
  total, totalPages }` envelope. All strict.
- `AdminDonationQuerySchema`: `q`, `status`, `sort`, `dir`, `page`, `pageSize` as strings from
  the URL. Digits are matched before they become numbers (`'1e1'` is rejected), a blank `q` is
  dropped, and a repeated key is a 422. `RefundRequestSchema`: `{ reason }`, 1 to 500 code
  points, line breaks allowed.
- Six error codes join the list: `unauthenticated`, `forbidden`, `invalid_credentials`,
  `already_refunded`, `not_refundable`, `origin_not_allowed`.

Both apps import the **built** output (`dist/`, ESM plus `.d.ts`), the same way in dev,
tests and Docker.

```bash
npm run build -w packages/shared   # tsc -p tsconfig.build.json → dist/
npm test -w packages/shared        # vitest
```

`tsconfig.json` covers `src` and `test` for typecheck and lint. `tsconfig.build.json`
emits `src` only, so tests never ship.
