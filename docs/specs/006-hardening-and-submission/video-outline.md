# Video outline (2 to 3 minutes)

Bullets to talk from, not a script. Timing follows `docs/06`. Record from the compose stack on a
clean `docker compose up`, with the browser at 100% zoom.

**0:00–0:20 — who and what**
- Name, the role, one sentence: a donation page for the Aangan campaign; Vue + Express + Postgres
  in one compose file, 953 tests and a browser suite.

**0:20–1:10 — show it working** (demonstrate, do not describe)
- Open `localhost:3000`: $43,058.00, 46 donors, 28%.
- Donate $21 with the *Succeeds* card: receipt appears, the total moves, the gift is in the list.
- Pick *Times out*: "We're confirming your payment", the row stays pending (this is the decision).
- Sign in as `admin@…`: search `गुरुङ`, refund the gift just made, the total returns.
- Sign in as `donor@…`: only their 3 donations.

**1:10–2:00 — the part I am proudest of, in code** (pick one; recommended: idempotent intake)
- `apps/api/src/repositories/donations.ts:47` — the `ON CONFLICT (idempotency_key) DO NOTHING` claim:
  the unique constraint, not a read-then-write, decides who charges.
- `apps/api/src/services/donations.ts:118` — a replay returns the stored answer; the same key with
  another body is a 422.
- The 20-parallel test in `apps/api/test/db/` and the one-liner burst in the README.
- Alternative I rejected: check-then-insert in a transaction; it still races without a lock.
- Fallback choices: the refund's conditional `UPDATE` (`repositories/refunds.ts:24`), or privacy
  decided in the SQL `CASE` (`repositories/public-donations.ts:45`).

**2:00–2:40 — trade-offs and what is not done**
- Integer cents everywhere; lint bans `toFixed`.
- A timeout leaves the donation pending; nothing reconciles it (Known issues).
- No CSV export (S0). In-memory rate limits. WebKit and the Secure cookie.
- Imported rows are legacy data, exempt from the new-donation rules, on purpose.

**2:40–3:00 — next, in order**
- Reconcile pending donations (a provider lookup, or a sweeper).
- Persist the rate limiter (Redis or Postgres) and add per-account lockout with an admin unlock.
- Name search as a `UNION` of indexed queries; page `/me/donations`.

**Before posting:** open the link in a private window, signed out of the host.
