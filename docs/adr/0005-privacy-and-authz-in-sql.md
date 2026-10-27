# ADR 0005 — Privacy and ownership are enforced in the SQL, not after the fetch

Status: proposed · Date: 2026-10-25

## Context
Reviewers `curl` the public endpoint. An anonymous donor's name must be absent from the
payload, not hidden in the UI. Any authenticated user reading another donor's record is
a −8 deduction. The brief: "a filter applied after the fetch is one refactor away from
being dropped".

## Decision
- The public donation list is its own query. It derives `display_name` with a `CASE` on
  `privacy_mode` (public name / "The {surname} family" / "Anonymous"), nulls the dedication
  and message for anonymous rows, and never selects email, donor id or the raw name.
- It maps into a dedicated `PublicDonation` DTO.
- Authenticated reads go through viewer-scoped repository functions. These add
  `donor_id = :viewer OR :isAdmin` to the `WHERE`, and a miss is a 404.
- `/admin/*` additionally requires the admin role, which comes from the database (403).

## Consequences
- No serialiser change can leak PII, because the PII never leaves the database on the
  public path.
- A foreign record looks exactly like a missing one.
- The surname rule is a known, documented approximation. Spec 003 (C1) refines it: with a comma
  the surname is the last word before it, and a one-word name shows "Anonymous" because it
  could be the given name.

## Alternatives
- Strip fields in a serialiser: one refactor from a leak.
- Row-level security policies in Postgres: strong, but harder to test and explain in this
  time budget. Noted as the production direction.
