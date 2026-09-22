# syntax=docker/dockerfile:1
#
# Two usable targets, both talking to a Supabase stack reachable at NEXT_PUBLIC_SUPABASE_URL (see
# docs/05-guias/docker-local.md):
#   - `run` (default): production image (`next build` + `next start`). `bun run local:up`.
#   - `dev`: hot-reload (`next dev`) over a bind-mounted repo, no rebuild needed on code changes. `bun run local:dev`.
#
# NEXT_PUBLIC_* values are inlined at build time for the `run` target, so they are build arguments there. Secrets are
# NOT: the service_role key is only given at runtime (docker-compose.yml) and never stored in an image layer.

FROM node:24-slim AS base
# Next.js runs on Node; Bun installs and runs the scripts. Same Bun version as package.json ("packageManager").
COPY --from=oven/bun:1.4.1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
# Exact versions from the lockfile; Bun skips dependency install scripts.
RUN bun install --frozen-lockfile

FROM deps AS dev
# LOCAL DEV ONLY, hot-reload: docker-compose.dev.yml bind-mounts the repo over /app and masks /app/node_modules with a
# named volume, so this layer's install survives and `next dev` picks up host edits. No source COPY here on purpose.
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["bun", "run", "dev"]

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    APP_URL=$APP_URL \
    # next.config.ts checks that the variable EXISTS at build time. The real key is provided at runtime, never baked in.
    SUPABASE_SERVICE_ROLE_KEY=build-time-placeholder \
    NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM base AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
    CMD bun -e "fetch('http://127.0.0.1:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "run", "start"]
