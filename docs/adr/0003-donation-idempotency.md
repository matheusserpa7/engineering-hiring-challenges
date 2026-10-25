# ADR 0003 — Donation intake: required Idempotency-Key, pending row before the charge

Status: proposed · Date: 2026-10-25

## Context
DATA-MODEL rule 7 says one donation row per payment, non-negotiable, although the spec
lists idempotency as should-have S3. Donors double-click and mobile clients retry. The
provider can time out (`tok_timeout` never answers) or fail transiently (`tok_flaky`).
"Charged with no record" is the failure that matters.

## Decision
- `Idempotency-Key` is required.
- Inside one transaction: upsert the donor, then
  `INSERT … status 'pending' … ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`.
  The unique constraint is the arbiter between concurrent requests, with no read-then-write.
- Only the request that created the row charges the provider, keyed by the donation id,
  with an imposed timeout and at most one retry on `provider_error`.
- Outcomes are written with a conditional `UPDATE … WHERE status = 'pending'`.
- Losers either replay the stored outcome (201/402/202) or get 409 `request_in_progress`.
  A reused key with a different body gets 422.
- A timeout leaves the row `pending` and answers 202 with the receipt number.

## Consequences
- 20 parallel identical requests produce exactly one row and one charge. A test proves it.
- A crash mid-charge still leaves a record.
- `pending` rows need reconciliation. The mock has no lookup API, so this is documented,
  not built.
- A client that omits the header gets a 400. The README shows the header in every example.

## Alternatives
- An optional key: makes the guarantee optional.
- A unique `payment_charge_id`: known only after the charge, so too late.
- 504 and no row on timeout: loses the record of a possible charge.
- An advisory lock on a hash of the body: two different donors can send identical bodies.
