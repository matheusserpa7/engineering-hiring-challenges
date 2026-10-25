# ADR 0002 — Money is integer cents, as a JS number, guarded at every boundary

Status: proposed · Date: 2026-10-25

## Context
A float anywhere on the money path is an automatic −8 points and a real-world receipt that
doesn't match a bank statement. Postgres `bigint` arrives in Node as a string, and
`SUM(bigint)` returns `numeric`.

## Decision
- `bigint` columns, plus a CHECK that amounts are between 100 and 2,500,000.
- Amounts are `number` in TS and `amountCents` in the API.
- A `pg` type parser converts `int8` to `number` and throws unless the value is a safe
  integer. Aggregates are cast `::bigint`.
- Dollar strings, from the CSV and the custom-amount input, are parsed by one regex-based
  function in `packages/shared`. There is no `parseFloat` anywhere.
- Formatting happens once, in the browser, with `Intl.NumberFormat`.
- Lint bans `parseFloat` and `toFixed`.

## Consequences
- Plain numbers keep the code simple: JSON can carry them, which native `BigInt` can't.
- The safe-integer limit (≈ $90 trillion) is far beyond any campaign total.
- Rounding never happens, because nothing is ever divided except the display percentage.

## Alternatives
- JS `BigInt`: no JSON support, so it would need serialisation ceremony at every edge.
- `numeric(12,2)` dollars: exact, but mixes units and invites `parseFloat` on read.
- A money library (Dinero): more API surface than one currency needs.
