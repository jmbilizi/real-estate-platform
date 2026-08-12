# Build context is the workspace root, so pnpm resolves catalog: versions and hoisted deps.

# Debian (glibc), NOT alpine — musl fails cluster-DNS lookups (`EAI_AGAIN postgres-svc`); see the
# root CLAUDE.md gotcha. An alpine build crash-looped this service's migrate initContainer 7 times.
FROM node:20-slim AS base

# ── Stage 1: Install workspace dependencies ───────────────────────────────────
FROM base AS deps
ARG COPY_CERTS=false

# node:20-slim ships no CA bundle at all, so ca-certificates is installed first (apt over HTTP,
# no TLS needed to bootstrap) before the enterprise root is registered. COPY_CERTS is local-dev only.
RUN --mount=type=bind,source=.workspace-certs,target=/tmp/certs,readonly \
    if [ "$COPY_CERTS" = "true" ] && [ -f /tmp/certs/workspace-enterprise-roots.pem ]; then \
      echo "Installing enterprise CA certificates for local development..." && \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
      cp /tmp/certs/workspace-enterprise-roots.pem /usr/local/share/ca-certificates/workspace-roots.crt && \
      update-ca-certificates && \
      rm -rf /var/lib/apt/lists/* && \
      echo "Enterprise CA certificates installed successfully"; \
    else \
      echo "Skipping enterprise CA setup (CI/CD mode or certs not available)" && \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
      rm -rf /var/lib/apt/lists/*; \
    fi

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace member's manifest must be present for --frozen-lockfile, even
# the ones this image doesn't build.
COPY apps/clients/cribstop/next/package.json ./apps/clients/cribstop/next/
COPY apps/services/property-service/package.json ./apps/services/property-service/
COPY libs/property-contracts/package.json ./libs/property-contracts/
# Root package.json's "preinstall" hook requires this script — pnpm runs
# lifecycle scripts for the root project too, even inside a container build.
COPY tools/node/scripts/ensure-pnpm.js ./tools/node/scripts/ensure-pnpm.js

RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ── Stage 2: Build, then resolve production deps ─────────────────────────────
# FROM deps (not base) to inherit the CA bundle, corepack cache and node_modules — without them
# corepack tries to fetch pnpm/latest from npmjs.org and fails behind SSL inspection.
FROM deps AS builder
WORKDIR /app

COPY nx.json tsconfig.json ./
COPY tools ./tools
COPY apps/services/property-service ./apps/services/property-service
COPY libs/property-contracts ./libs/property-contracts

# `prune`, not `build`: it depends on build and additionally emits a pruned package.json AND
# pnpm-lock.yaml, and the production install below needs that lockfile for --frozen-lockfile.
RUN pnpm exec nx run property-service:prune --skip-nx-cache

# Production deps are resolved here, not in the runtime image, so the runtime needs no package
# manager and no network. The pruned lockfile inherits the workspace's `catalogs` config and a
# frozen install fails when that config isn't visible (ERR_PNPM_LOCKFILE_CONFIG_MISMATCH), so the
# pruned output gets its own pnpm-workspace.yaml carrying the catalog — `--ignore-workspace` would
# hide the catalog again. `--dir` keeps the CWD at /app so corepack resolves the pinned pnpm version.
RUN node -e "const y=require('fs').readFileSync('pnpm-workspace.yaml','utf8'); \
      const i=y.indexOf('catalog:'); \
      require('fs').writeFileSync('dist/apps/services/property-service/pnpm-workspace.yaml', \
        i === -1 ? 'packages: []\n' : 'packages: []\n' + y.slice(i));" && \
    pnpm --dir dist/apps/services/property-service \
      install --prod --frozen-lockfile --ignore-scripts

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# groupadd/useradd rather than busybox adduser — this is a Debian base.
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nodeapp

# The bundle plus the node_modules resolved in the builder stage.
COPY --from=builder --chown=nodeapp:nodejs /app/dist/apps/services/property-service ./

# migrate.js and migrations/ are read at runtime and are not in the webpack bundle, so they must be
# copied explicitly — without them the migrate initContainer has nothing to run or nothing to apply.
COPY --from=builder --chown=nodeapp:nodejs /app/apps/services/property-service/migrate.js ./migrate.js
COPY --from=builder --chown=nodeapp:nodejs /app/apps/services/property-service/migrations ./migrations

USER nodeapp

# Port 3002 per the PRD §2.1 service map.
EXPOSE 3002
ENV PORT=3002
ENV HOST=0.0.0.0

CMD ["node", "main.js"]
