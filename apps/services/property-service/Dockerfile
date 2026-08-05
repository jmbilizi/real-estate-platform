# Build context: workspace root (set by build-image.js / Skaffold)
# Monorepo-aware — installs from the workspace root so pnpm resolves catalog:
# versions and hoisted deps correctly. Mirrors apps/clients/cribstop/next/Dockerfile.

FROM node:20-alpine AS base

# ── Stage 1: Install workspace dependencies ───────────────────────────────────
FROM base AS deps
ARG COPY_CERTS=false

# Optional: Enterprise CA setup (local dev only, skipped in CI/CD).
# On Alpine we append directly to the existing bundle — no apk call needed —
# because apk itself needs TLS to fetch packages.
RUN --mount=type=bind,source=.workspace-certs,target=/tmp/certs,readonly \
    if [ "$COPY_CERTS" = "true" ] && [ -f /tmp/certs/workspace-enterprise-roots.pem ]; then \
      echo "Installing enterprise CA certificates for local development..." && \
      cat /tmp/certs/workspace-enterprise-roots.pem >> /etc/ssl/certs/ca-certificates.crt && \
      echo "Enterprise CA certificates installed successfully"; \
    else \
      echo "Skipping enterprise CA setup (CI/CD mode or certs not available)"; \
    fi && \
    apk add --no-cache libc6-compat

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm-workspace.yaml declares apps/clients/cribstop/next as a member, so a
# --frozen-lockfile install needs its manifest present even though this image
# doesn't build it. property-service itself has no package.json of its own.
COPY apps/clients/cribstop/next/package.json ./apps/clients/cribstop/next/
# Root package.json's "preinstall" hook requires this script — pnpm runs
# lifecycle scripts for the root project too, even inside a container build.
COPY tools/node/scripts/ensure-pnpm.js ./tools/node/scripts/ensure-pnpm.js

RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ── Stage 2: Build the bundle and prune deps for production ──────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
# Copy corepack's downloaded pnpm binary so this stage needs no network access.
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nx.json tsconfig.json ./
COPY tools ./tools
COPY apps/services/property-service ./apps/services/property-service

# `prune` (not `build`) — it depends on build and additionally emits the pruned
# package.json + pnpm-lock.yaml into dist, which the runner stage installs from.
# A bare `nx build` emits package.json but no lockfile, so --frozen-lockfile
# would have nothing to honour.
RUN corepack enable pnpm && pnpm exec nx run property-service:prune --skip-nx-cache

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeapp

# The webpack bundle plus the pruned package.json / pnpm-lock.yaml.
COPY --from=builder --chown=nodeapp:nodejs /app/dist/apps/services/property-service ./

# Migrations are plain CommonJS files that node-pg-migrate reads at runtime — they are
# NOT part of the webpack bundle, so they must be copied in explicitly. Without them the
# migrate initContainer has nothing to apply.
COPY --from=builder --chown=nodeapp:nodejs /app/apps/services/property-service/migrations ./migrations

# Production dependencies only (pg, node-pg-migrate). Resolved from the pruned
# lockfile, so no workspace context is needed here.
RUN corepack enable pnpm && \
    pnpm install --prod --frozen-lockfile --ignore-scripts && \
    chown -R nodeapp:nodejs /app/node_modules

USER nodeapp

# Port 3002 per the PRD §2.1 service map.
EXPOSE 3002
ENV PORT=3002
ENV HOST=0.0.0.0

CMD ["node", "main.js"]
