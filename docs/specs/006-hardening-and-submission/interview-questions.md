# Questions to prepare for (no scripted answers)

Each points at the code to open. For each, be able to say what it does, why, and what the
alternative was. Line numbers are at `ee0f46e`.

## Money
- Why integer cents and not `numeric`? `packages/shared/src/money.ts:19` (`parseDollarsToCents`),
  `:32` (`formatCents`), ADR 0002.
- What does `SUM(bigint)` return, and where is that handled? `apps/api/src/db/pool.ts:7`.

## Concurrency and idempotency
- Two requests carry the same key at the same millisecond. Walk through the code.
  `apps/api/src/repositories/donations.ts:47`, `services/donations.ts:118` and `:138`.
- The provider times out. What is the row's state, what does the donor see, who fixes it?
  `apps/api/src/payments/charge.ts:32` and `:61`; Known issues.
- Twenty admins refund the same gift. `apps/api/src/repositories/refunds.ts:24`.

## Authorisation and privacy
- What stops `donor@` reading `other@`'s donation, and why is it a 404? `repositories/donor-records.ts:14`.
- Where is an anonymous donor's name removed? `repositories/public-donations.ts:45`, ADR 0005.
- Why does login take the same time for an unknown email? `services/auth.ts:39`.

## Security
- Why `SameSite=Strict` and an origin allow-list both? `http/security.ts`, ADR 0004.
- Why does every login attempt count against the limit, successes included? `http/security.ts`
  (`loginLimiter`) and spec 005 T3.
- What does the CSP stop, and why is Zod's JIT off? `apps/web/nginx.conf`, `apps/web/src/zod-config.ts`.

## Scale and gaps
- What breaks first at 4,000 donations a day? Name search scans `donations`
  (`repositories/donor-records.ts:113`); the in-memory limiters.
- Why did you skip the CSV export? What would you change first with a week?

## A live change to be ready for
- Raise the minimum donation to $5: where do the schema, the DB `CHECK` and the form each change,
  and which tests go red first?
