# ADR 0001 — A boring three-service stack

Status: proposed · Date: 2026-10-25

## Context
The brief scores a working, well-tested Express + Postgres service above anything clever.
There is a 5–8 hour budget, and every line must be defensible in an interview. The client
platform uses Next.js, but the brief calls matching it "a small advantage".

## Decision
- Postgres 16, an Express 5 API (TypeScript strict, Kysely + `pg`, Zod), and a Vue 3 + Vite
  SPA served by nginx, all in npm workspaces.
- nginx proxies `/api`, so the browser sees one origin.
- `packages/shared` holds money helpers, the Zod schemas and the DTO types, and both apps
  import it.

## Consequences
- I build in the frameworks I'm fastest in, and SQL semantics stay visible for the
  concurrency work.
- Not matching the client's Next.js stack is a stated trade-off in the README.
- No build-time API URL is needed, and cookies can be `SameSite=Strict`.

## Alternatives
- Next.js: the client's stack, but slower for me today.
- Fastify: its validation advantage is moot with shared Zod.
- Prisma: hides locking and ships an engine binary.
- SQLite: weak write concurrency for a concurrency exercise.
