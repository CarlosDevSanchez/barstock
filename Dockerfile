# syntax=docker/dockerfile:1
#
# Production image of the app (`next build` + `next start`). For LOCAL use: it talks to a Supabase stack reachable at
# NEXT_PUBLIC_SUPABASE_URL (see docs/05-guias/docker-local.md and `bun run local:up`).
#
# NEXT_PUBLIC_* values are inlined at build time, so they are build arguments. Secrets are NOT: the service_role key is only
# given at runtime (docker-compose.yml) and never stored in an image layer.

FROM node:24-slim AS base
# Next.js runs on Node; Bun installs and runs the scripts. Same Bun version as package.json ("packageManager").
COPY --from=oven/bun:1.4.1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
# Exact versions from the lockfile; Bun skips dependency install scripts.
RUN bun install --frozen-lockfile

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
