# ADR 0004 — Opaque, hashed, DB-backed sessions in a Strict cookie

Status: proposed · Date: 2026-10-25

## Context
The admin needs login, and donors must see only their own records. The brief asks for
random, expiring tokens, a hashed password store, and `HttpOnly; Secure; SameSite` cookies
(or a stated trade-off). Registration is out of scope.

## Decision
- Login verifies with scrypt (`node:crypto`). Unknown emails are checked against a dummy
  hash, so timing and response are the same.
- On success we issue 32 random bytes in an `HttpOnly; Secure; SameSite=Strict` cookie and
  store only their SHA-256 with `expires_at`. Logout deletes the row.
- CSRF defence: the Strict cookie, JSON-only bodies, and an `Origin` allow-list on unsafe
  methods. The allow-list matters because `localhost:3000` and `:4000` are the same site.
- There is no `SESSION_SECRET`: nothing is signed.

## Consequences
- Revocation is a row delete, and a leaked database is not a set of live sessions.
- Each authenticated request costs one indexed lookup.
- Safari may refuse `Secure` cookies over `http://localhost`. WebKit e2e checks this, and
  a `COOKIE_SECURE` flag is the documented fallback.

## Alternatives
- JWT: revocation needs a denylist, which is a session table again.
- A token in `localStorage`: readable by any XSS.
- bcrypt or argon2: native addons, no security gain here.
