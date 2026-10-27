

**T4.** Dropping the owner filter, a 403 for a foreign row, mounting `/admin` without
`requireRole`, `/me` listing everyone and moving the guard behind `express.json` each fail a test.
Review: the admin guard now sits ahead of the body parser (a malformed body from a donor is 403,
from nobody 401), so `http/admin.ts` holds `adminGuard` only; T5 adds its router behind the
parser. Accepted: an undecodable percent-escape in `:id` (`%E0%A4%A`) is rejected by Express as 400
`bad_request` before the handler, so it differs from the 404 of F12; it reveals only the id format.
For T6: the "no row changed" assertion in `authz.test.ts` only starts to mean something there.
