# @aangan/web

The donation page: Vue 3 + TypeScript, built by Vite, served by nginx in Docker. It has the
campaign page with the donation form, sign-in, a donor's own donations and the admin table with
refunds.

| Route | Page | Who |
|---|---|---|
| `/`, `/campaigns/:slug` | Campaign: totals, progress, donation form, latest 20 gifts | anyone |
| `/login` | Sign in | anyone |
| `/me` | The signed-in donor's own donations | signed in |
| `/admin` | Search, filter, sort and page every donation; refund | admin |

The router only decides what to show. The API refuses a request without a session, so a guard
here is a convenience.

```bash
npm run build:shared           # once, from the root: the app imports @aangan/shared from dist/
npm run dev -w apps/web        # Vite on :5173, proxying /api to the API on :4000
npm test -w apps/web           # vitest
npm run typecheck -w apps/web  # vue-tsc
npm run build -w apps/web      # → dist/, served by nginx
```

## How it reaches the API

The browser only ever calls relative `/api/...` URLs. In dev, Vite proxies them to
`localhost:4000`. In Docker, nginx proxies them to the `api` service. So the
bundle has no API URL baked in, and cookies stay same-origin.

`src/api.ts` is the one place that calls `fetch`:

- `getJson(path)` returns the parsed body on 2xx, as `unknown`, or `undefined` when the
  body is empty (a 204). Callers validate it with the shared Zod schemas.
- On an API error it throws `ApiError` with the envelope's `code` and client-facing
  `message`, read with `isApiErrorBody` from `@aangan/shared`.
- Anything else becomes a generic `unexpected_response`, so a raw response is never shown
  to the donor. That includes a proxy's HTML error page, and a 2xx that isn't JSON (which
  means the request never reached the API).
- A network failure rejects with `fetch`'s own `TypeError`, not an `ApiError`, so callers
  must handle both.

From the root, `npm run dev` starts shared's watcher, the API and Vite together.

## Safety rules

- Vue templates escape output. Lint bans `v-html`, binding `innerHTML` or `outerHTML` (also
  through `v-bind="{ ... }"`), and `innerHTML`, `outerHTML`, `insertAdjacentHTML` and
  `document.write` in `src/`. `test/lint-rules.test.ts` proves each rule fires.
- Every `<script>` must be `lang="ts"`.
- `src/zod-config.ts` is imported first and turns off Zod's JIT: nginx's CSP forbids `eval`, and
  Zod's probe for it would be reported as a violation on every load.
- Money is formatted only at the display edge with the shared `formatCents`.

## nginx (`nginx.conf`)

- `/api/` is proxied to `api:4000`, resolved per request so a recreated API container is found.
  Bodies over 64 kB are refused.
- The SPA falls back to `index.html`; a missing `/assets/` file is a real 404.
- CSP `default-src 'self'`, `nosniff`, a referrer policy, no server version.
- The two errors nginx answers itself, a 400 for an undecodable URL and a 413, are the API's JSON
  envelope, byte for byte. CI compares them with the API's own answers.
