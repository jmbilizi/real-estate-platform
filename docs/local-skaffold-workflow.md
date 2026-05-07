# Local Development with Skaffold

## Overview

Skaffold provides a continuous development loop for Kubernetes:

1. **Watch** - Monitors code changes
2. **Build** - Rebuilds container images
3. **Deploy** - Updates Kubernetes cluster
4. **Stream** - Shows logs from all pods

## Quick Start

### First-Time Setup

```bash
# 1. Install Skaffold (one-time)
pnpm run infra:setup

# 2. Create local Podman cluster (if not exists)
pnpm run infra:local:cluster:setup

# 3. Start development mode
node tools/infra/dev-skaffold.js
```

### What Happens?

```
📦 Building image: api-gateway
🚀 Deploying to: kind-<cluster_name>
🔌 Port forwarding:
   - api-gateway: http://localhost:5123
   - jaeger: http://localhost:16686
   - postgres: localhost:5432
📝 Streaming logs...
```

## Development Workflow

### Standard Flow

```bash
# Terminal 1: Start Skaffold
node tools/infra/dev-skaffold.js

# Terminal 2: Edit code
# apps/api-gateway/Program.cs
# Save file...

# Skaffold automatically:
# 1. Detects change (2s)
# 2. Rebuilds image (30s with cache)
# 3. Redeploys pod (10s)
# 4. Streams new logs

# Total: ~45s from save to running
```

### Available Commands

```bash
# Development mode (watch + rebuild + deploy)
node tools/infra/dev-skaffold.js

# Debug mode (same as dev + enables debugging)
node tools/infra/run-skaffold.js debug --port-forward

# Build images only (no deploy)
node tools/infra/run-skaffold.js build --cache-artifacts=false

# Deploy existing images
node tools/infra/run-skaffold.js run --port-forward --tail

# Delete deployed resources
node tools/infra/run-skaffold.js delete

# Reset local disk usage (registry + podman cache)
node tools/infra/dev-reset-disk.js
```

## Relationship with Nx

### Local Development (Current)

**Skaffold operates independently:**

- Watches files directly (no Nx)
- Rebuilds on any .cs or .json change
- Fastest iteration loop

### CI/CD (Future)

**Nx detects affected, Skaffold builds:**

```bash
# GitHub Actions workflow:
AFFECTED=$(pnpm exec nx show projects --affected --withTarget=docker-build)
skaffold build --profile=ci --tag=$GIT_SHA
```

## Skaffold vs Manual Workflow

### Without Skaffold (Manual)

```bash
# Edit code
pnpm exec nx serve api-gateway  # OR
podman build -t api-gateway:local -f apps/api-gateway/Dockerfile .
kubectl apply -k infra/k8s/podman/local
kubectl rollout restart deployment/api-gateway
kubectl logs -f deployment/api-gateway
```

### With Skaffold (Automated)

```bash
node tools/infra/dev-skaffold.js
# Edit code → automatic rebuild → automatic redeploy → automatic logs
```

## Configuration Files

### Primary Config

- **skaffold.yaml** - Main configuration
  - Build settings (Podman, Dockerfile path)
  - Deploy settings (Kustomize path)
  - Port forwarding rules
  - Profiles (local, remote-dev, ci)

### Kubernetes Manifests

- **infra/k8s/podman/local/** - Local environment
  - Uses `image: api-gateway` (matches skaffold.yaml)
  - `imagePullPolicy: IfNotPresent` (Skaffold manages the final image reference)

### Dockerfile

- **apps/api-gateway/Dockerfile** - Container definition
  - Multi-stage build (build → publish → final)
  - .NET 10 base images
  - Optimized layer caching

## Profiles

### Local (Default)

```bash
node tools/infra/dev-skaffold.js
# (equivalent to: skaffold dev --profile=local with repo safety flags)
```

- Builds with Podman (local)
- Deploys to Podman cluster
- Pushes to `localhost:5001` via the custom builder (persistent local registry)

### Remote Dev (Future)

```bash
skaffold dev --profile=remote-dev
```

- Builds and pushes to ghcr.io
- Deploys to Hetzner dev cluster
- Port forwards from remote cluster

### CI (Future - GitHub Actions)

```bash
skaffold build --profile=ci --push
```

- Builds in CI environment
- Tags with git SHA
- Pushes to registry

## Troubleshooting

### "Cannot connect to Podman"

```bash
# Windows: Podman machine must be running
podman machine start

# Check status
podman machine list
```

### "Image not found"

```bash
# Force rebuild
node tools/infra/run-skaffold.js build --cache-artifacts=false

# Check images
podman images
```

### "Port already in use"

```bash
# Check what's using port 5123
netstat -ano | findstr :5123

# Stop other process or change port in skaffold.yaml:
# portForward.localPort: 5124
```

### "Context deadline exceeded"

```bash
# Increase timeout in skaffold.yaml:
# deploy:
#   statusCheckDeadlineSeconds: 600
```

### "File sync not working"

Skaffold's file sync requires compatible Dockerfile. For full hot reload:

1. Use development Dockerfile (future enhancement)
2. Or accept full rebuild (current: 30-45s)

## Performance Tips

### Faster Rebuilds

1. **Layer caching** - Skaffold caches Docker layers
2. **File sync** - Small changes sync without rebuild (configured in skaffold.yaml)
3. **BuildKit** - Enabled by default for parallel builds

### Current Build Times

- **Cold build** (first time): ~2-3 minutes
- **Warm build** (deps cached): ~45 seconds
- **Hot build** (code only): ~30 seconds
- **File sync** (future): ~3-5 seconds

## When to Use Skaffold vs nx serve

### Use `pnpm exec nx serve api-gateway`

- Regular feature development
- Unit testing
- Fast iteration (hot reload, no containers)
- **Fastest feedback loop** (~2 seconds)

### Use the cross-platform launcher (preferred)

- Run: `node tools/infra/dev-skaffold.js`
- Why: avoids Windows `pnpm.cmd` Ctrl+C prompts (like `Terminate batch job (Y/N)?`) while still
  working on macOS/Linux.

### Use the cross-platform launcher (preferred)

- Run: `node tools/infra/dev-skaffold.js`
- Why: avoids Windows `pnpm.cmd` Ctrl+C prompts (like `Terminate batch job (Y/N)?`) while still
  working on macOS/Linux.

## Next Steps

1. ✅ Local setup complete
2. 🔄 Add more services (account-service, messaging-service)
3. 🔄 Enable remote-dev profile for Hetzner cluster
4. 🔄 Integrate with CI/CD (GitHub Actions)
5. 🔄 Add hot reload Dockerfile for instant sync

## Resources

- [Skaffold Documentation](https://skaffold.dev/docs/)
- [Skaffold Profiles](https://skaffold.dev/docs/environment/profiles/)
- [File Sync](https://skaffold.dev/docs/filesync/)
- [Debugging](https://skaffold.dev/docs/workflows/debug/)
