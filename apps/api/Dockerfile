# syntax=docker/dockerfile:1
# Build context: the repo root (docker-compose.yml sets it).

# Manifests first, so a source change doesn't reinstall dependencies. npm ci needs every
# workspace's package.json to match the lockfile, web included.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w packages/shared -w apps/api

# Production dependencies of the API only: no TypeScript, Vite or test tooling at runtime.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev -w apps/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Same relative layout as the repo, so the workspace link node_modules/@aangan/shared
# still points at packages/shared.
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
# The seed files, unmodified, at the repo-relative path config.ts resolves SEED_DIR to. The API
# reads them on every start, so an image without them exits 1 at the seed step.
COPY roles/full-stack-engineer/seed roles/full-stack-engineer/seed

USER node
WORKDIR /app/apps/api
EXPOSE 4000
# 6 s outlasts the pool's 5 s query timeout, so a slow database shows up as a logged 503
# from the API rather than a probe killed with no trace.
HEALTHCHECK --interval=10s --timeout=6s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/start.js"]
