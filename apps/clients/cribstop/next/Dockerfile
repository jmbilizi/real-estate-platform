# Build context: workspace root (set by build-image.js / Skaffold)
# This Dockerfile is monorepo-aware — it installs from the workspace root
# so pnpm can resolve catalog: versions and hoisted deps correctly.

# Debian (glibc), NOT alpine — musl fails cluster-DNS lookups (`EAI_AGAIN api-gateway-svc`); see the
# root AGENTS.md gotcha. This app resolves the gateway in-cluster on every server-rendered request
# (`src/app/api/_lib/gateway.ts`), so the whole Homes surface rides on that resolver, not just auth.
FROM node:20-slim AS base

# node:20-slim ships NO CA bundle at all (verified: node:20-alpine has 145 certs at
# /etc/ssl/certs/ca-certificates.crt, node:20-slim has no such file). It is installed here in `base`
# rather than in `deps` alone so that every stage — including the runtime image — keeps the TLS trust
# the Alpine base used to provide for free. apt runs over HTTP, so no TLS is needed to bootstrap it.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ── Stage 1: Install workspace dependencies ───────────────────────────────────
FROM base AS deps
ARG COPY_CERTS=false

# Optional: Enterprise CA setup (local dev only, skipped in CI/CD)
# The .workspace-certs directory is auto-generated for local development only
# and used when building behind corporate proxies with SSL inspection.
# In CI/CD, this step is skipped as GitHub Actions doesn't require custom CAs.
# On Debian the root is registered the supported way — dropped into
# /usr/local/share/ca-certificates/ and linked into the bundle by update-ca-certificates —
# rather than appended to the bundle by hand as the Alpine build had to do.
RUN --mount=type=bind,source=.workspace-certs,target=/tmp/certs,readonly \
    if [ "$COPY_CERTS" = "true" ] && [ -f /tmp/certs/workspace-enterprise-roots.pem ]; then \
      echo "Installing enterprise CA certificates for local development..." && \
      cp /tmp/certs/workspace-enterprise-roots.pem /usr/local/share/ca-certificates/workspace-roots.crt && \
      update-ca-certificates && \
      echo "Enterprise CA certificates installed successfully"; \
    else \
      echo "Skipping enterprise CA setup (CI/CD mode or certs not available)"; \
    fi

# Point Node/pnpm at the system cert store so installs work behind corporate SSL inspection.
# In CI/CD the file exists with standard CAs only — harmless.
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

# Copy workspace manifests needed for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy the app's own package.json so pnpm workspace resolution works
COPY apps/clients/cribstop/next/package.json ./apps/clients/cribstop/next/
COPY libs/property-contracts/package.json ./libs/property-contracts/
# Root package.json's "preinstall" hook requires this script — pnpm runs
# lifecycle scripts for the root project too, even inside a container build.
COPY tools/node/scripts/ensure-pnpm.js ./tools/node/scripts/ensure-pnpm.js

RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ── Stage 2: Build the Next.js app ───────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/clients/cribstop/next/node_modules ./apps/clients/cribstop/next/node_modules
# pnpm's isolated layout puts zod under the library's own node_modules, not the root store link.
# Without this, `next build` fails with "Cannot find module 'zod'" from a directory that exists.
COPY --from=deps /app/libs/property-contracts/node_modules ./libs/property-contracts/node_modules
# Copy corepack's downloaded pnpm binary so the builder stage needs no network access.
# Without this, corepack asks npmjs.org for pnpm/latest and fails behind a corporate proxy.
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack
# Copy root package.json so corepack resolves the pinned pnpm version (packageManager field).
COPY package.json ./

# Copy only the app source (not the entire monorepo)
COPY apps/clients/cribstop/next ./apps/clients/cribstop/next
# The source is required here (not just node_modules) because contracts.check.ts lives under
# src/, and `next build` type-checks it.
COPY libs/property-contracts ./libs/property-contracts

ENV NEXT_TELEMETRY_DISABLED=1
# Always enable standalone output in container builds
ENV NEXT_BUILD_STANDALONE=1

RUN corepack enable pnpm && \
    cd apps/clients/cribstop/next && \
    pnpm run build

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# groupadd/useradd rather than busybox addgroup/adduser — this is a Debian base.
# Same names and same uid/gid as before, so the standalone COPY --chown targets are unchanged.
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# In monorepo standalone builds, the .next/standalone dir mirrors the full workspace path.
# So server.js lives at apps/clients/cribstop/next/server.js (not the root), and static/
# public must be placed at the same relative path that server.js expects.
COPY --from=builder --chown=nextjs:nodejs /app/apps/clients/cribstop/next/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/clients/cribstop/next/.next/static ./apps/clients/cribstop/next/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/clients/cribstop/next/public ./apps/clients/cribstop/next/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/clients/cribstop/next/server.js"]
