# @aangan/shared

The contract between `apps/api` and `apps/web`. If it changes, both builds see it.

Today it holds the error envelope:

```ts
{ "error": { "code": ErrorCode, "message": string, "details"?: unknown } }
```

- `ERROR_CODES` / `ErrorCode`: every code the API can return. Each spec adds the codes its
  endpoints need.
- `ApiErrorBody`: the envelope type the API's error middleware builds.
- `isApiErrorBody(value)`: the guard the web client uses to read an error response. It
  rejects unknown codes, because it promises `code: ErrorCode`. A client on an older bundle
  therefore shows a generic error for a code it doesn't know yet.

Money helpers and the Zod schemas arrive in spec 002.

Both apps import the **built** output (`dist/`, ESM plus `.d.ts`), the same way in dev,
tests and Docker.

```bash
npm run build -w packages/shared   # tsc -p tsconfig.build.json → dist/
npm test -w packages/shared        # vitest
```

`tsconfig.json` covers `src` and `test` for typecheck and lint. `tsconfig.build.json`
emits `src` only, so tests never ship.
