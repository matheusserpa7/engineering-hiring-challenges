# Tech Spec 004 — Donation intake

Status: draft, awaiting approval · Implements [`prd.md`](prd.md) · Inherits tech spec 000
§3, §5, §6, §9, ADRs 0002, 0003, 0005, spec 002's schema, pool and logger, spec 003's
`campaignPhase`, `parseQuery` and web client. **No migration:** 0001 already has
`idempotency_key unique`, `request_hash`, `failure_code`, `payment_*` and the sequence.

## 1. Affected components

```
packages/shared/src/donations.ts       DonationRequestSchema, DonationReceiptSchema,
                                       IdempotencyKeySchema, normaliseName, codePointLength
packages/shared/src/errors.ts          + 9 codes (§2)
apps/api/src/payments/mock-provider.ts TS port of reference/mock-payment-provider.js
apps/api/src/payments/charge.ts        PaymentProvider type; chargeWithPolicy (deadline, 1 retry)
apps/api/src/repositories/donations.ts upsertDonor, claimDonation, findByKey, recordOutcome
apps/api/src/services/donations.ts     submitDonation; requestHash, receiptNumber (pure)
apps/api/src/http/donations.ts         route: limiter, key header, body, status mapping
apps/api/src/http/validate.ts          parseQuery → parseInput(schema, value, 'query'|'body')
apps/api/src/{app,start,config}.ts     trust proxy, access-log serializer, deps, new env
apps/web/src/api.ts                    + postJson; ApiError gains details, retryAfter
apps/web/src/idempotency-key.ts        UUID v4 from getRandomValues (E13)
apps/web/src/composables/use-donation.ts   key lifecycle, submit, outcome state
apps/web/src/composables/use-campaign.ts   + refresh() that keeps the ready state
apps/web/src/components/{donation-form,donation-result}.vue
apps/web/src/views/campaign-page.vue   Donate link + form section when phase is open
```

New dependency: `express-rate-limit` (api).

## 2. API contract — `POST /api/donations`

Headers: `Content-Type: application/json`, `Idempotency-Key: <uuid>` (required). Body:

```json
{ "campaignSlug": "aangan-courtyard", "amountCents": 10100,
  "donor": { "fullName": "अनिशा गुरुङ", "email": "anisha@example.com" },
  "dedication": { "type": "in_honor_of", "name": "Aama" }, "message": "…",
  "privacyMode": "public", "isRecurring": false, "paymentToken": "tok_ok" }
```

`dedication` and `message` optional or `null`; `isRecurring` optional, default `false`.
`message` is top level (000 §5 deviation). Every object is `.strict()`.

2xx body (`DonationReceiptSchema`, strict): `{ id, receiptNumber, amountCents, currency,
status, createdAt }`, `status` ∈ `completed | pending | refunded`.

| Situation | Status | `error.code` / notes |
|---|---|---|
| Charged (new or replay) | 201 | `status: "completed"` (or `"refunded"` on a later replay, E3) |
| Timeout, unknown outcome, abandoned pending | 202 | `status: "pending"`, receipt included |
| Declined | 402 | `card_declined` · `insufficient_funds` |
| Provider failed twice | 502 | `payment_provider_error` |
| Same key in flight | 409 | `request_in_progress`, `Retry-After: 1` |
| Key missing or not a UUID | 400 | `idempotency_key_required` |
| Body not JSON / too large | 400 / 413 | `malformed_json` / `payload_too_large` (existing) |
| Schema failure | 422 | `validation_failed`, `details: [{ field, issue }]`, e.g. `amountCents`/`too_big` |
| Same key, different body | 422 | `idempotency_key_mismatch` |
| Unknown campaign | 404 | `not_found` (a body field, so a malformed slug is 422) |
| Campaign closed or upcoming | 422 | `campaign_closed` |
| Outside campaign min/max | 422 | `amount_out_of_range`, `details: [{ field: "amountCents", issue: "out_of_range" }]` |
| Over the rate limit | 429 | `rate_limited`, `Retry-After` |
| Anything else | 500 | `internal_error`; detail logged with `{ err }` and the request id |

Every replayed answer carries `Idempotent-Replayed: true`. Zod messages are never sent.

## 3. Intake algorithm (`services/donations.ts`)

1. **Route:** rate limiter (mounted ahead of `express.json`, §5) → `IdempotencyKeySchema`
   on the header (400) → `parseInput(DonationRequestSchema, body, 'body')` (422) → service.
2. `hash = requestHash(request)`: SHA-256 hex of `JSON.stringify` of a fixed-order array of
   the *parsed, normalised* fields, token included (E4). Key order or spacing in the client's
   JSON cannot change it.
3. **Key first (E2):** `findByKey(key)`. If a row exists → §3.1. This read only short-cuts;
   step 5's unique constraint stays the arbiter.
4. **Rules:** load the campaign by slug (404); `campaignPhase(campaign, now())` must be
   `open` (422 `campaign_closed`); `min_cents ≤ amountCents ≤ max_cents` (422). The charge
   amount is this validated value; currency comes from the campaign row.
5. **Claim, one transaction, then commit before any network call:**
   ```sql
   INSERT INTO donors (email, full_name) VALUES ($email, $name)
     ON CONFLICT (email) DO UPDATE SET email = donors.email RETURNING id;   -- name never overwritten
   SELECT nextval('receipt_number_seq');
   INSERT INTO donations (…, status, receipt_number, idempotency_key, request_hash)
     VALUES (…, 'pending', $receipt, $key, $hash)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *;
   ```
   No row returned → a concurrent request won: re-read by key → §3.1.
6. **Charge** outside any transaction: `chargeWithPolicy(provider, { token, amountCents,
   idempotencyKey: donation.id }, deadline)` (§4).
7. **Record** with one conditional statement per outcome, `updated_at = now()`:
   `UPDATE donations SET status = 'completed', payment_charge_id, payment_last4,
   failure_code = null WHERE id = $1 AND status = 'pending' RETURNING *` · declined →
   `status 'failed', failure_code = <provider code>` · `provider_error` → `failed`,
   `provider_error` · unknown → stays `pending`, `failure_code = 'provider_timeout'`.
   Zero rows updated → re-read and answer from the row. If the write itself fails after a
   charge, log `{ err, donationId }` and answer 202 from the claimed row: the donor must not
   retry under a new key.
8. Log `{ donationId, receiptNumber, status }` at info: the "confirmation". Never the body.

### 3.1 Answering from an existing row (E3, E7)

Different `request_hash` → 422 `idempotency_key_mismatch` (checked first) · `completed`
or `refunded` → 201 · `failed` with `card_declined`/`insufficient_funds`/other decline → 402
· `failed` with `provider_error` → 502 · `pending` with `provider_timeout` → 202 · `pending`
with no outcome and `created_at > now() - (timeout + 5 s)` (database clock) → 409 · older →
202. No response body is stored: the row is the record and the answer is derived from it.

## 4. Payment adapter (`payments/`)

- `mock-provider.ts` ports the reference file line for line; state (flaky attempts, dup ids)
  is per instance from `createMockProvider({ latencyMs })`, so tests need no `__reset`.
  `PaymentError` keeps the provider's `code`.
- `chargeWithPolicy` returns `{ kind: 'charged', chargeId, last4 } | { kind: 'declined', code }
  | { kind: 'provider_error' } | { kind: 'unknown' }`:
  - one deadline of `PAYMENT_TIMEOUT_MS` covers both attempts (E6), via `Promise.race` with a
    timer cleared in `finally`;
  - `PaymentError('provider_error')` → one immediate retry with the same `idempotencyKey`
    (that is why it is safe), if the deadline allows; a second one → `provider_error`;
  - any other `PaymentError` → `declined` with its code (the donor sees `card_declined`
    unless the code is `insufficient_funds`);
  - the deadline, or a non-`PaymentError` throw → `unknown` (E5).
- `tok_timeout`'s promise never settles; the race abandons it. Accepted for a fixture.

## 5. Rate limit, proxy, logging

- `app.set('trust proxy', 1)`: `req.ip` is the address nginx appended (right-most
  `X-Forwarded-For`), so a forged left-most entry is ignored. Direct calls to `:4000` can
  still forge it (E11, risk below).
- `express-rate-limit`, in-memory, `windowMs` 10 min, `limit` from `DONATION_RATE_LIMIT`
  (default 30), keyed on `req.ip`, `standardHeaders: 'draft-8'`, handler returns our envelope
  with `Retry-After`. Mounted for `POST /api/donations` before `express.json`, so malformed
  bodies count too. Every attempt counts, replays included.
- pino-http `req` serializer logs `url` without its query string (forward note for 005's
  `?q=`). Bodies were never logged; the intake logs ids only (§3 step 8).

## 6. Cross-cutting

| Concern | Answer |
|---|---|
| Concurrency | The unique index on `idempotency_key` arbitrates; a duplicate insert waits for the winner's commit, then does nothing. The donor upsert is one statement and locks the donor row until the claim commits, so 20 new-email requests make 1 donor. Both transactions lock donor then key, so no deadlock. Outcome writes are `WHERE status = 'pending'`. The claim commits before the provider call, so no connection or lock is held across the network. |
| Idempotency | §3, §3.1. Losers in a true race burn a sequence value: gaps accepted (000 §4). |
| Authorisation | Public by design; no session read. `status`, `donorId`, `role`, `currency` and any total are not in the schema, so sending one is a 422. Cross-site JSON POSTs need a CORS preflight, which fails (no CORS middleware yet). |
| Validation | §7. Database checks (amount 100–2,500,000, message ≤ 280 code points, dedication pair, key required for `web` rows) are the last line. |
| Errors | Only `AppError`s reach the client with a message; Postgres errors are logged as `{ err }` (the serializer drops `detail`), never `error.detail`. |

## 7. Shared validation (`packages/shared/src/donations.ts`)

- Text: NFC first, then checks. Lengths use `codePointLength` and report Zod's `too_big` /
  `too_small` codes. `normaliseName`: every `\s` (incl. U+00A0, U+202F, U+FEFF), U+200B and U+2060 →
  one space, collapse, trim; ZWJ/ZWNJ kept (Devanagari conjuncts); C0/C1 controls → 422.
- `fullName`, `dedication.name`: 1–100 code points. `email`: trim, NFC, lower-case,
  `z.email()`, ≤ 254. `message`: trimmed, empty → `null`, ≤ 280 code points, line breaks
  allowed, other controls rejected.
- `amountCents`: shared `AmountCentsSchema`. `privacyMode`: required enum (E10).
  `paymentToken`: `^tok_[a-z0-9_]{1,60}$`. `campaignSlug`: `CampaignSlugSchema`.
- `IdempotencyKeySchema`: canonical UUID, case-insensitive, lower-cased (E1).
- `DonationReceiptSchema.receiptNumber`: `^HCC-\d{4}-\d{6,}$`.

## 8. Web

- **Form** (`donation-form.vue`): preset radio group from `presetCents` (labels via
  `formatCents`), "Other amount" (`inputmode="decimal"`, `parseDollarsToCents`, then the
  campaign's min/max: a comma gets "Use digits only, like 2500 or 2500.50"), name, email,
  "Dedicate this gift" → type + name, message with a code-point counter, privacy radios with
  one sentence, a "Test card" select (mock tokens; there is no card field). The built body
  is checked with `DonationRequestSchema` before sending; issues map to fields.
- **Key lifecycle** (`use-donation.ts`, E13): the key is bound to the serialised body. Same
  body and no final answer yet (network error, 409) → same key; a final answer
  (201/202/402/502) or any change → new key. Submit is disabled in flight.
- **Results** (`donation-result.vue`, focus moves to its heading): 201 thanks + receipt;
  202 "We're confirming your payment. Your reference is HCC-…. You won't be charged twice.";
  402 declined, no money taken, Try again; 502 nothing charged, Try again; 409 "Still
  processing" + Check again (same key); 429 wait message; network error "We couldn't reach
  the server. Trying again will not charge you twice." (same key).
- After 201/202, `refresh()` reloads campaign and list without the loading state (E14).

## 9. Decisions and alternatives

| # | Chosen | Rejected | Why |
|---|---|---|---|
| E1 | Required UUID key | Any string; optional key | A global unique index across guests needs unguessable, collision-free keys; optional makes rule 7 optional |
| E2 | Key looked up before rules | Rules first (000 §6) | A retry must replay its outcome, not hit a rule that changed since |
| E3 | Answer derived from the row | Stored response body | The row is the record; one less column to drift |
| E4 | Hash of the parsed, normalised body | Hash of raw bytes | Re-serialising clients and NFD/NFC must not read as "different" |
| E5 | Only a definitive answer leaves `pending` | Unknown → `failed` | "Charged with no record" is the failure that matters |
| E6 | One deadline for both attempts | A timeout per attempt | The donor waits at most `PAYMENT_TIMEOUT_MS` |
| E7 | Old no-outcome `pending` → 202 | 409 forever | A crash mid-charge must not lock the key |
| E8 | Declines kept as `failed` rows | Delete or no row | Never hard-delete; evidence for card testing |
| E9 | Names normalised at intake | Raw names | Spec 003 §3.3: surname split needs real spaces |
| E10 | `privacyMode` required in the API | Default `public` | Contract: no silent default; the form defaults |
| E11 | `trust proxy` 1, per-IP limit | `true`; no proxy trust | `true` lets any client choose its IP; none puts everyone in nginx's bucket |
| E12 | Receipt at claim, year in `ORG_TIMEZONE`, `padStart` | SQL `lpad` | `lpad` truncates past 999,999 and would collide |
| E13 | Key from `getRandomValues` | `crypto.randomUUID` | `randomUUID` needs a secure context; a phone on `http://<LAN IP>` lacks one |
| E14 | Form on the campaign page | `/donate` route | The total refreshes in place: land, give, see it |
| — | TS port of the mock | Import the `.js` as is | Needs `allowJs` and lint/format exceptions for one file |
| — | Advisory lock on a body hash | — | Two donors can send identical bodies (ADR 0003) |

## 10. Test plan

| Test | Type | Proves |
|---|---|---|
| shared `donations.test.ts` | Unit | Amount 99/100/2500000/2500001, -100, 1.5, `"100"`, `null`; unknown keys at each depth; enums; dedication pair; message 280 vs 281 emoji; NFD → NFC; `normaliseName` table (U+00A0, U+202F, U+200B, tabs; ZWJ kept); controls rejected; email lower-cased; key UUID cases; receipt schema strict |
| `mock-provider.test.ts` | Unit | Each token's outcome; float amount → `invalid_amount`; flaky fails once per key; instances share no state |
| `charge.test.ts` | Unit (fake timers) | Success; both declines; flaky → 2 calls, same key; provider_error twice → `provider_error`; deadline → `unknown`; deadline shared by the retry; a `TypeError` → `unknown` |
| `donation-helpers.test.ts` | Unit | `receiptNumber`: 76 → `…000076`; 1,234,567 not truncated; 2027-01-01T05:59:59Z → 2026, 06:00:00Z → 2027 (Chicago). `requestHash`: key order irrelevant, any field (token too) changes it |
| `rate-limit.test.ts` | Unit (never-connecting db) | Limit+1 → 429, `Retry-After`, envelope; `1.1.1.1, 9.9.9.9` and `2.2.2.2, 9.9.9.9` share a bucket; `…, 9.9.9.9` and `…, 8.8.8.8` don't |
| `logging.test.ts`, `config.test.ts` (cases) | Unit | Access log URL has no query string; new env defaults; a bad `ORG_TIMEZONE` fails boot |
| `db/donations.test.ts` | Integration (seeded, fixed clock, spy over the real mock, short timeout) | US-2, US-3, US-6 criteria: boundaries, campaign rules, strict body, normalised names, success fields and receipt 76, declines, timeout timing and row, flaky, the total and list move, anonymous gift absent from raw JSON, seeded email links to its donor without renaming it, no PII in captured logs |
| `db/donations-idempotency.test.ts` | Integration | 20 parallel → 1 row, 1 call, 201/409 only; mismatch 422; replays 201/402/202 with the header and 0 new calls; replay after close; stale pending → 202, fresh → 409; key missing/bad → 400; 20 keys, one new email → 20 rows, 1 donor; 2 keys, same body → 2 rows |
| web `api`, `use-donation` | Unit | `postJson` keeps status, details, `Retry-After`; key reused on network error/409, new after 402 or an edit; one fetch on a double click |
| web `donation-form`, `donation-result`, `campaign-page` | Component (fetch stubbed at the network) | PRD US-1 and the six result screens on the DOM; Donate only when open; refresh shows the new total |

Mutations to run once are listed per task. Not automated here: the donate path in a real
browser (006).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Forged `X-Forwarded-For` straight to `:4000` | Port bound to `127.0.0.1`; production would not publish the API. Known issue |
| In-memory limiter resets on restart, per instance | One instance; documented. Production: a shared store |
| Shared IP (event Wi-Fi) hits the limit | 30 per 10 min; a 429 says when to retry |
| `pending` rows never reconciled | The receipt is the support handle; Known issues names the gap |
| Test timing (timeout, 20 parallel) flakes on CI | Latency and timeout injected; assert ordering, not wall time, except the "within timeout + 1 s" bound |
| Pool exhaustion under 20 parallel | Claim is three short statements; no connection held during the charge |
| Budget | ~3 h 30; cut order in tasks.md |
