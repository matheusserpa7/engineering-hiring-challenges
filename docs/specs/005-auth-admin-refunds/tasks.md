

**T3.** Skipping the dummy hash, storing the raw token, mounting the limiter after the router,
dropping `expires_at > now()`, un-gating `derive` and refunding successes each fail a test; the
slot gate is proved by wrapping `node:crypto`'s `scrypt`, not by a constant. On compose all three
seeded accounts log in, `/auth/me` is 200 and the token is not in `sessions`. Review: **F1
changed**, every login attempt now counts (a public demo login could reset a refunded counter),
default `LOGIN_RATE_LIMIT` 20; omitted `auth` now truly refuses logins. Accepted: signing in as
B in a browser that holds A's cookie leaves A's row valid until it expires (8 h). The timing-ratio
test stays (cut-list item if it flakes in CI).
