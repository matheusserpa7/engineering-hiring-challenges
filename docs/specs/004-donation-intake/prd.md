# PRD 004 — Donation intake

Status: draft, awaiting approval · Parent: [000 overview](../000-overview/prd.md) ·
Depends on: [002 data and money](../002-data-and-money/prd.md),
[003 public campaign](../003-public-campaign/prd.md) · Decision record: [ADR 0003](../../adr/0003-donation-idempotency.md)

## Problem and context

A visitor can see Aangan's progress but cannot give. M4 is the money-moving path: a guest on
a phone picks an amount, names a dedication, chooses how public to be, and pays through the
mock provider. Three failures matter more than any screen: a donor charged twice (a double
click, a mobile retry), a donor charged with no record (`tok_timeout`), and a client-supplied
amount or status reaching the database. Reviewers probe all three with `curl`.

## Goals

1. `POST /api/donations` validates a strict body, derives the charge from the campaign's
   rules, and answers success (201), decline (402), timeout (202, pending) and provider
   failure (502) distinctly, each with an honest donor message.
2. A required `Idempotency-Key` makes every retry of one attempt produce one row and one
   provider call, proven by 20 parallel requests (DATA-MODEL rule 7, S3).
3. Donation intake is rate-limited per client IP behind nginx (S4, part).
4. The Vue form (presets, custom amount, dedication, message, privacy with its sentence)
   and the result screens live on the campaign page; the total and list refresh in place.

## Non-goals

- Login, "my donations", admin, refunds: spec 005. A logged-in donor still gives as a guest.
- Recurring donations (S2): `isRecurring` is accepted and stored as intent, not offered in
  the form.
- Reconciling `pending` rows with the provider: the mock has no lookup call (Known issues).
- Applying a provider answer that arrives after our deadline: needs a background write; the
  mock never answers late.
- Emailing a confirmation: logged as identifiers only.
- Playwright e2e of the donate path, CORS, helmet CSP and the `Origin` check: spec 005/006.

## User stories and acceptance criteria

Test files: shared `packages/shared/test/donations.test.ts`; API unit
`apps/api/test/{mock-provider,charge,donation-helpers,rate-limit,logging,config}.test.ts`;
API integration `apps/api/test/db/{donations,donations-idempotency}.test.ts`; web
`apps/web/test/{api,use-donation,donation-form,donation-result,campaign-page}.test.ts`.

### US-1 — A guest fills in the form (M4)
- **Given** Aangan is open, **then** the page shows a Donate link to the form, with presets
  $21, $51, $101, $501, $1,001 from `presetCents` and a custom amount; **given** a closed or
  upcoming campaign, **then** neither appears. *(campaign-page › "donate only when open")*
- **Given** the form, **then** privacy defaults to `public` and one sentence explains all
  three modes; dedication type and name appear only when "Dedicate this gift" is ticked; the
  message counter counts code points (280 emoji allowed, 281 blocked). *(donation-form ›
  "defaults and explanation", "dedication toggle", "message counts code points")*
- **Given** a custom amount of `0.99`, `25000.01` or `25,000`, **then** an inline error and
  no request; `1.00` and `25000.00` are sent as `100` and `2500000`. *(donation-form ›
  "custom amount boundaries")*
- **Given** a valid form, **then** the request body is exactly the shared schema's keys, with
  integer `amountCents` and an `Idempotency-Key` UUID header. *(donation-form › "sends the
  contract")*

### US-2 — The server trusts nothing it should not (M4, cat. 4 validation, cat. 3)
- **Given** `amountCents` of 99, 2500001, -100, 1.5, `"100"`, `"abc"` or `null`, **then** 422
  `validation_failed` naming `amountCents`, and no donor or donation row. 100 and 2500000 on
  Aangan give 201. *(donations › "amount boundaries over HTTP")*
- **Given** 500001 on Annadaan (max $5,000), **then** 422 `amount_out_of_range`; **given**
  roof-repair, **then** 422 `campaign_closed`; **given** an unknown slug, **then** 404.
  *(donations › "campaign rules")*
- **Given** an extra key at any depth (`status`, `donorId`, `donor.role`, `amount`), a bad
  `privacyMode`, a dedication with a type but no name, or a 281-code-point message, **then**
  422 and no row. *(donations › "strict body"; donations.test (shared) › table)*
- **Given** a name in NFD, with a no-break space, U+200B or a tab run, **then** it is stored
  NFC with single spaces; ZWJ/ZWNJ inside Devanagari survive byte-identical.
  *(donations › "names are normalised at intake"; shared › "normaliseName")*

### US-3 — Each payment outcome is distinct and honest (M4)
- **Given** `tok_ok`, **then** 201 `{ id, receiptNumber, amountCents, currency, status:
  "completed", createdAt }`; the first receipt after the seed is `HCC-2026-000076`; the row
  stores the charge id and `4242`, never a card number. *(donations › "success")*
- **Given** `tok_decline` / `tok_insufficient`, **then** 402 `card_declined` /
  `insufficient_funds`, the row is `failed`, and the screen says the card was declined and no
  money was taken. *(donations › "declines"; donation-result › "declined")*
- **Given** `tok_timeout`, **then** within `PAYMENT_TIMEOUT_MS` + 1 s the answer is 202 with a
  receipt number, the row is `pending` with `failure_code = provider_timeout`, the total does
  not move, and the screen says the payment is being confirmed and will not be charged twice.
  *(donations › "timeout"; donation-result › "pending")*
- **Given** `tok_flaky`, **then** 201 after exactly two provider calls with the same provider
  key; **given** a provider that fails twice, **then** 502 `payment_provider_error` and a
  `failed` row. *(donations › "flaky retried once"; charge › "second provider_error")*

### US-4 — One attempt, one row, one charge (S3, DATA-MODEL rule 7)
- **Given** 20 parallel identical requests with one key, **then** exactly 1 row and 1
  provider call; every answer is a 201 with that receipt or a 409 `request_in_progress`;
  none is 5xx. *(donations-idempotency › "20 parallel identical requests")*
- **Given** a used key with a different body, **then** 422 `idempotency_key_mismatch`, and
  the row and call count are unchanged. *(donations-idempotency › "same key, other body")*
- **Given** a finished attempt, **when** it is retried, **then** the same status and receipt
  come back with `Idempotent-Replayed: true`, even if the campaign closed in between.
  *(donations-idempotency › "replays", "replay survives campaign close")*
- **Given** no key or a non-UUID key, **then** 400 `idempotency_key_required` and no row.
  *(donations-idempotency › "key required")*
- **Given** a network failure after submit, **when** the donor presses Try again, **then** the
  same key is sent; after a decline, or any field change, a new one is. *(use-donation ›
  "key lifecycle")*

### US-5 — Abuse is limited, logs hold no PII (S4, M6)
- **Given** more than `DONATION_RATE_LIMIT` requests from one client IP in 10 minutes,
  **then** 429 `rate_limited` with `Retry-After`; a forged left-most `X-Forwarded-For` does
  not change the bucket. *(rate-limit › "limit", "trust proxy is one hop")*
- **Given** a donation, **then** no log line contains its name, email, message or token, and
  the access log never contains a query string. *(donations › "logs carry ids only";
  logging › "no query string")*

### US-6 — The gift appears (M3 + M4)
- **Given** a 201, **then** the next campaign read has `raisedCents` + amount and the list
  shows it with the right display name; an anonymous gift's raw JSON has no name or email.
  *(donations › "the total and list move"; campaign-page › "refreshes after a gift")*

## Traceability

| Requirement / rubric item | Story | Task |
|---|---|---|
| M4 presets + custom; client check is a convenience | US-1 | T1, T7 |
| M4 $1.00 / $25,000 on the server; amount derived from campaign rules | US-2 | T1, T3 |
| M4 guest checkout, name + email | US-1, US-2 | T3, T7 |
| M4 dedication (type, name) + message ≤ 280 | US-1, US-2 | T1, T3, T7 |
| M4 privacy selector, default `public`, one sentence | US-1 | T7 |
| M4 success / decline / timeout distinct and honest | US-3 | T2, T3, T8 |
| M4 receipt number; never a card number | US-3 | T3, T8 |
| S3 idempotency (+2) · DATA-MODEL rule 7 | US-4 | T4, T6 |
| S4 donation rate limit (part) | US-5 | T5 |
| M6 / cat. 4 schema validation, amounts not trusted (2 pts) | US-2 | T1, T3 |
| M6 errors leak nothing; log ids not bodies | US-3, US-5 | T3, T5 |
| M8 money boundaries $0.99/$1.00/$25,000.00/$25,000.01 (HTTP) | US-1, US-2 | T3, T7 |
| Cat. 3 awkward input (boundaries, Devanagari, emoji) | US-2 | T1, T3 |
| DATA-MODEL rules 2 (org time zone), 6 (Unicode) | US-2, US-3 | T1, T3 |
| Forward notes: `trust proxy 1`, no `?q=` in logs, sequence at 76, `{ err }` | US-3, US-5 | T3, T5 |

Not covered here, by design: the donate e2e (006), README *Decisions* lines for E1–E14 (006),
S2's form field, pending reconciliation (Known issues).

## Assumptions

Inherited: A7 (cap per donation), A8 (closed or upcoming campaigns reject), A10, A11 (guest
linked by email, stored name never overwritten), A12 (code points), C3 (only `completed`
counts), C4 (`campaignPhase`). Local decisions E1–E14 are in tech spec §9; these need you:

- **E1** — The key must be a UUID. The reference `concurrency-burst.mjs` sends no headers, so
  pointed at our endpoint it gets 20 × 400; the README will say why and show a keyed burst.
- **E2** — **Changes tech spec 000 §6 order:** an existing key is answered from its row
  *before* campaign rules are re-checked, so a retry after the campaign closes still replays.
- **E7** — A `pending` row with no outcome older than the timeout + 5 s replays as 202, not
  409 forever (covers a crash mid-charge).
- **E11** — `trust proxy` = 1. A request sent straight to `:4000` can forge its IP; accepted
  because the port is bound to `127.0.0.1` (decides spec 003 D1).

## Open questions

- **Blocking:** budget. Realistic estimate ~3 h 30 against the planned 1 h 30 (tasks.md).
- **Blocking:** the limit, 30 requests per IP per 10 minutes, counted on every attempt. It
  admits a 20-request burst and a temple's shared Wi-Fi; it only slows card testing.
