# Docker & Container Registry Integration

## Overview

This workspace uses **GitHub Container Registry (GHCR)** for storing Docker images built from services in the monorepo. Images are built automatically via GitHub Actions using Nx affected detection to only build changed services.

## Architecture

### Image Naming Convention

```
ghcr.io/<owner>/<repo>/<service>:<tag>
```

**Examples:**

```bash
ghcr.io/yourusername/real-estate-platform/api-gateway:dev
ghcr.io/yourusername/real-estate-platform/api-gateway:dev-sha-a1b2c3d
ghcr.io/yourusername/real-estate-platform/api-gateway:latest
```

### Tag Strategy

| Branch | Tags                             | Description                                |
| ------ | -------------------------------- | ------------------------------------------ |
| `dev`  | `dev`, `dev-sha-<commit>`        | Development builds, always pull latest     |
| `test` | `test`, `test-sha-<commit>`      | Staging builds with vulnerability scanning |
| `main` | `latest`, `prod`, `<commit-sha>` | Production builds, immutable tags          |

## Workflows

### 1. CI Integration (Automatic)

When you push to `dev`/`test`/`main` branches:

1. **CI Workflow** runs quality checks (lint, test, build)
2. **Detects changes** to three areas: cluster configs, container images, deployment resources
3. **Orchestrates workflows** based on what changed:
   - **Images changed**: Triggers build-push-images → Builds containers → Auto-triggers deployment
   - **Only deploy resources changed**: Triggers deployment directly
   - **Cluster changed**: Triggers cluster provisioning → Auto-triggers deployment
4. **Builds affected containers** using Nx (if images changed)
5. **Pushes to GHCR** with environment-specific tags
6. **Scans for vulnerabilities** (test/prod only)
7. **Deployment waits** for image builds to complete

**Flows:**

```
# Scenario 1: Only deployment manifests changed
Push → CI (quality checks) → Deploy

# Scenario 2: Only container code changed
Push → CI (quality checks) → Build-Push-Images → Deploy (after images ready)

# Scenario 3: Both containers and manifests changed
Push → CI (quality checks) → Build-Push-Images → Deploy (after images ready)

# Scenario 4: Cluster config changed
Push → CI (quality checks) → Provision Cluster → Deploy
```

**Key Benefits:**

- ✅ Images never built from failing code (CI gates execution)
- ✅ Deployment never starts before images finish building (synchronized)
- ✅ Only relevant workflows trigger (no wasted CI minutes)

### 2. Manual Build (Local Development)

```bash
# Build single project
npm run container:build api-gateway -- --tag=local

# Build with enterprise certificates (corporate proxy)
npm run container:build api-gateway -- --copy-certs --tag=local

# Build and push to GHCR
npm run container:build api-gateway -- --tag=dev --push

# Build all services with container-build target
npm run container:build:all

# Build only affected services
npm run container:build:affected
```

### 3. Using Nx Directly

```bash
# Run container-build target for specific project
npx nx container-build api-gateway --tag=local

# Run for all projects with container-build target
npx nx run-many --target=container-build --all

# Run for affected projects only
npx nx affected --target=container-build
```

## Dockerfile Best Practices

### Certificate Handling

Dockerfiles use **conditional certificate installation** to support both local dev (with corporate proxies) and CI/CD (without):

```dockerfile
ARG COPY_CERTS=false
RUN --mount=type=bind,source=.workspace-certs,target=/tmp/certs,readonly \
    if [ "$COPY_CERTS" = "true" ] && [ -f /tmp/certs/workspace-enterprise-roots.pem ]; then \
      cp /tmp/certs/workspace-enterprise-roots.pem /usr/local/share/ca-certificates/workspace-roots.crt && \
      update-ca-certificates; \
    fi
```

**Local build with certs:**

```bash
npm run container:build api-gateway -- --copy-certs
```

**CI/CD build (no certs):**

```bash
# Automatically set COPY_CERTS=false in GitHub Actions
```

### Multi-Stage Builds

All Dockerfiles follow this pattern:

1. **Build stage**: Compile and build application
2. **Publish stage**: Prepare release artifacts
3. **Runtime stage**: Minimal final image with only runtime dependencies

### Security Features

- ✅ Non-root user in final image
- ✅ Health checks configured
- ✅ Minimal base images (distroless when possible)
- ✅ SBOM (Software Bill of Materials) generation
- ✅ Provenance attestation
- ✅ Vulnerability scanning (Trivy)

## GitHub Actions Workflows

### build-push-images.yml

**Triggers:**

- **workflow_call** from CI workflow (automatic after quality checks pass)
- **Pull requests** (validation only - build but don't push)
- **Manual dispatch** via workflow_dispatch (for on-demand builds)

**NOT triggered directly on push** - CI workflow handles orchestration.

**Features:**

- ✅ CI-gated execution (only runs after quality checks pass)
- ✅ Nx affected detection (only builds changed services)
- ✅ Matrix builds (parallel image building)
- ✅ Docker BuildKit with layer caching
- ✅ Multi-architecture support
- ✅ Vulnerability scanning with Trivy
- ✅ Security alerts integration
- ✅ Build summaries with image sizes

### Composite Action: build-push-image

Reusable action for building and pushing a single container image.

**Inputs:**

- `project`: Project name (required)
- `tag`: Image tag (required)
- `push`: Push to registry (default: true)
- `scan-image`: Run vulnerability scan (default: true)
- `platform`: Target platform (default: linux/amd64)

**Outputs:**

- `image`: Full image name with tag
- `digest`: Image SHA256 digest
- `size`: Image size in MB
- `scan-results`: Vulnerability scan summary

## Kubernetes Integration

### Image References (Template Pattern)

**IMPORTANT**: Deployment manifests use placeholders that are substituted **automatically during deployment**. This makes the infrastructure template-friendly and fork-compatible.

**Placeholders:**

```yaml
# Base deployment (uses latest tag)
image: ghcr.io/GITHUB_REPOSITORY_OWNER/GITHUB_REPOSITORY_NAME/api-gateway:latest

# Environment patches override with specific tags
# Dev patch:
image: ghcr.io/GITHUB_REPOSITORY_OWNER/GITHUB_REPOSITORY_NAME/api-gateway:dev

# Test patch:
image: ghcr.io/GITHUB_REPOSITORY_OWNER/GITHUB_REPOSITORY_NAME/api-gateway:test

# Prod patch:
image: ghcr.io/GITHUB_REPOSITORY_OWNER/GITHUB_REPOSITORY_NAME/api-gateway:latest
```

**Substitution happens in CI/CD:**

- `.github/actions/deploy-k8s-resources/action.yml` substitutes placeholders after Kustomize build
- Uses GitHub context variables: `${{ github.repository_owner }}`, `${{ github.event.repository.name }}`
- **Tags are NOT substituted** - they're already defined correctly in each environment patch
- Same pattern as secret substitution (in-memory replacement)

**Benefits:**

- ✅ **Fork-friendly**: Works automatically for any fork without manual updates
- ✅ **Consistent**: Matches secret substitution pattern
- ✅ **Secure**: Actual values never committed to Git
- ✅ **Automated**: No manual script execution required

**Example final values** (after substitution):

```yaml
# For original repo
image: ghcr.io/jmbilizi/real-estate-platform/api-gateway:dev

# For a fork
image: ghcr.io/yourname/your-fork-name/api-gateway:dev
```

**Local development:**

Skaffold overrides images automatically - no placeholder substitution needed:

```yaml
# skaffold.yaml
build:
  artifacts:
    - image: localhost:5001/api-gateway # Local override
      custom:
        buildCommand: node tools/infra/skaffold-build.js
```

### Image Pull Secrets

For private repositories, create an image pull secret:

```bash
# Create secret in Kubernetes
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<github-username> \
  --docker-password=<github-token> \
  --docker-email=<github-email>

# Reference in deployment
spec:
  imagePullSecrets:
    - name: ghcr-secret
```

## Adding New Services

1. **Create Dockerfile** in service directory (e.g., `apps/my-service/Dockerfile`)

2. **Run setup script** to add container-build target:

   ```bash
   npm run dotnet:setup-projects  # For .NET services
   # OR
   npm run nx:reset  # For all projects
   ```

3. **Verify Nx target** was added:

   ```bash
   npx nx show project my-service --json
   ```

4. **Test local build:**

   ```bash
   npx nx container-build my-service --tag=local
   ```

5. **Create K8s manifests** in `infra/k8s/base/deployments/my-service.deployment.yaml`

6. **Update smart-deployment-config.yaml** to include new service:
   ```yaml
   services:
     my-service:
       type: application
       resources:
         - infra/k8s/base/deployments/my-service.deployment.yaml
   ```

## Troubleshooting

### Build fails with "Dockerfile not found"

**Cause:** Script searches `apps/`, `apps/services/`, and `libs/` directories.

**Solution:**

```bash
# Ensure Dockerfile is in the correct location
ls apps/my-service/Dockerfile

# Or specify path manually in project.json
```

### "permission denied" pushing to GHCR

**Cause:** Missing `packages: write` permission or invalid token.

**Solution:**

```yaml
# In workflow, ensure permissions are set
permissions:
  contents: read
  packages: write
```

### Images not pulled in Kubernetes

**Cause:** Missing image pull secret for private repos.

**Solution:**

```bash
# Create secret (see "Image Pull Secrets" section)
kubectl create secret docker-registry ghcr-secret ...

# Verify secret exists
kubectl get secrets
```

### Layer caching not working

**Cause:** Cache registry reference mismatch.

**Solution:**

```yaml
# In composite action, cache-from/cache-to use same ref
cache-from: type=registry,ref=ghcr.io/owner/repo/service:buildcache
cache-to: type=registry,ref=ghcr.io/owner/repo/service:buildcache,mode=max
```

### Vulnerability scan blocking deployment

**Cause:** High/critical vulnerabilities found.

**Solution:**

```bash
# View scan results in GitHub Security tab
# Update base images or dependencies
# Scan results don't block build (exit-code: 0)
```

## Performance Optimization

### Build Speed

- ✅ **Layer caching**: Registry-backed caching speeds up builds 3-5x
- ✅ **Parallel builds**: Matrix strategy builds multiple images concurrently
- ✅ **Nx affected**: Only builds changed services
- ✅ **BuildKit**: Modern Docker build engine with advanced caching

### Image Size

Monitor image sizes in GitHub Actions summary:

```
📦 Image size: 245MB
```

**Reduction strategies:**

- Use multi-stage builds
- Use minimal base images (alpine, distroless)
- Clean up build artifacts
- Use .dockerignore to exclude unnecessary files

### Registry Storage

- Dev tags are overwritten (no accumulation)
- Test tags kept for 30 days
- Prod tags kept for 90 days
- Use GHCR cleanup policies to remove old images

## Security Best Practices

### 1. Secrets Management

❌ **Never** hardcode secrets in Dockerfiles:

```dockerfile
# BAD
ENV API_KEY=secret123
```

✅ **Use** environment variables from Kubernetes Secrets:

```yaml
env:
  - name: API_KEY
    valueFrom:
      secretKeyRef:
        name: app-secrets
        key: api-key
```

### 2. Base Image Updates

Monitor base image updates and rebuild regularly:

```bash
# Check for updates
docker pull mcr.microsoft.com/dotnet/aspnet:10.0

# Rebuild if newer version available
npm run container:build:all
```

### 3. Vulnerability Scanning

Review scan results in GitHub Security > Code scanning alerts:

- **CRITICAL**: Address immediately
- **HIGH**: Plan remediation within sprint
- **MEDIUM/LOW**: Track and address when feasible

## References

- [GitHub Container Registry Docs](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker BuildKit](https://docs.docker.com/build/buildkit/)
- [Nx Docker Plugin](https://nx.dev/packages/docker)
- [Trivy Vulnerability Scanner](https://github.com/aquasecurity/trivy)
