# @aangan/web

The donation page: Vue 3 + TypeScript, built by Vite, served by nginx in Docker. Today it is
a skeleton that shows whether the API answers. The campaign page arrives in spec 003.

```bash
npm run build:shared           # once, from the root: the app imports @aangan/shared from dist/
npm run dev -w apps/web        # Vite on :5173, proxying /api to the API on :4000
npm test -w apps/web           # vitest
npm run typecheck -w apps/web  # vue-tsc
npm run build -w apps/web      # → dist/, served by nginx
```

## How it reaches the API

The browser only ever calls relative `/api/...` URLs. In dev, Vite proxies them to
`localhost:4000`. In Docker, nginx proxies them to the `api` service (spec 001 T9). So the
bundle has no API URL baked in, and cookies stay same-origin.

`src/api.ts` is the one place that calls `fetch`:

- `getJson(path)` returns the parsed body on 2xx, as `unknown`, or `undefined` when the
  body is empty (a 204). Callers validate it, with the shared Zod schemas from spec 002 on.
- On an API error it throws `ApiError` with the envelope's `code` and client-facing
  `message`, read with `isApiErrorBody` from `@aangan/shared`.
- Anything else becomes a generic `unexpected_response`, so a raw response is never shown
  to the donor. That includes a proxy's HTML error page, and a 2xx that isn't JSON (which
  means the request never reached the API).
- A network failure rejects with `fetch`'s own `TypeError`, not an `ApiError`, so callers
  must handle both.

From the root, `npm run dev` starts shared's watcher, the API and Vite together.

Vue templates escape output; `v-html` is banned by lint, and every `<script>` must be
`lang="ts"`.
