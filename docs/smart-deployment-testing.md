# Smart Deployment Testing Guide

This guide explains how to test the smart deployment functionality in the CI/CD pipeline.

## Overview

The smart deployment system intelligently detects which services need to be deployed based on file changes, reducing deployment time and resource usage.

## Test Scenarios

### 1. Single Service Deployment (✅ CURRENT TEST)

**Test File**: `infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml`

**Expected Behavior**:

- ✅ Triggers deployment workflow
- ✅ Deploys ONLY postgres service (not redis or jaeger)
- ✅ Deploys ONLY to dev environment (not test/prod)
- ✅ Uses targeted deployment strategy

**How to Verify**:

1. Commit and push the change to `dev` branch
2. Check GitHub Actions → CI workflow
3. Look for the "Detect changed services" step output:
   ```
   ✅ Affected services in dev: postgres
   deploy_strategy=single
   services=postgres
   environment=dev
   🎯 Triggering TARGETED deployment for dev environment: postgres
   ```
4. Verify the deploy-k8s-resources workflow received:
   - `environment=dev`
   - `deploy_strategy=single`
   - `services=postgres`

### 2. Multiple Service Deployment

**Test Files** (must be in same environment):

- `infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml`
- `infra/k8s/hetzner/dev/patches/statefulsets/redis.statefulset.yaml`

**Important**: Both files must be in the same environment (dev/test/prod) to trigger parallel deployment.

**Expected Behavior**:

- ✅ Triggers deployment workflow
- ✅ Deploys BOTH postgres AND redis (but not jaeger)
- ✅ Deploys ONLY to dev environment
- ✅ Uses `deploy_strategy=single` (targeted deployment)
- ✅ Uses parallel deployment if enabled in smart-deployment-config.yaml

**How to Verify**:

```bash
# Make changes to both files
git add infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml
git add infra/k8s/hetzner/dev/patches/statefulsets/redis.statefulset.yaml
git commit -m "test: multi-service deployment"
git push origin dev
```

Check CI output:

```
✅ Affected services in dev: postgres,redis
deploy_strategy=single
services=postgres,redis
environment=dev
🎯 Triggering TARGETED deployment for dev environment: postgres,redis
```

### 3. Global Trigger (Full Deployment)

**Test Files** (any one triggers full deployment):

- `infra/smart-deployment-config.yaml`
- `infra/deploy-control.yaml`
- `.github/workflows/deploy-k8s-resources.yml`
- `infra/k8s/base/kustomization.yaml`

**Expected Behavior**:

- ✅ Triggers deployment workflow
- ✅ Deploys ALL services (postgres + redis + jaeger)
- ✅ Deploys to current branch's environment
- ✅ Uses full deployment strategy

**How to Verify**:

```bash
# Example: update smart-deployment-config.yaml
git add infra/smart-deployment-config.yaml
git commit -m "test: global trigger deployment"
git push origin dev
```

Check CI output:

```
🚨 Global trigger detected - deploying ALL services to dev
deploy_strategy=all
services=all
environment=dev
```

### 4. Environment Isolation

**Test Files**:

- Change `infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml` on `dev` branch
- Change `infra/k8s/hetzner/test/patches/statefulsets/postgres.statefulset.yaml` on `test` branch
- Change `infra/k8s/hetzner/prod/patches/statefulsets/postgres.statefulset.yaml` on `main` branch

**Expected Behavior**:

- ✅ Dev changes ONLY affect dev environment
- ✅ Test changes ONLY affect test environment
- ✅ Prod changes ONLY affect prod environment
- ✅ Cross-environment changes do NOT trigger deployment

**How to Verify**:

```bash
# On dev branch - change ONLY dev patch
git checkout dev
# Edit infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml
git commit -m "test: dev environment isolation"
git push origin dev

# Verify: Should deploy ONLY to dev
```

### 5. Base Resource Changes

**Test Files**:

- `infra/k8s/base/statefulsets/postgres.statefulset.yaml`
- `infra/k8s/base/configmaps/postgres.configmap.yaml`
- `infra/k8s/base/services/postgres.service.yaml`

**Expected Behavior**:

- ✅ Deploys to current branch's environment only
- ✅ Uses base resources + environment patches
- ✅ Single service deployment (postgres only)

**How to Verify**:

```bash
# On dev branch - change base postgres resource
git checkout dev
# Edit infra/k8s/base/statefulsets/postgres.statefulset.yaml
git commit -m "test: base resource change"
git push origin dev

# Verify: Should deploy postgres to dev
```

### 6. Ignored Paths (No Deployment)

**Test Files**:

- Any `.md` file in `infra/k8s/`
- Files in `ignored_paths` list in `smart-deployment-config.yaml`

**Expected Behavior**:

- ❌ Does NOT trigger deployment workflow at all
- ℹ️ CI shows "Only ignored files changed - skipping deployment"
- ✅ Other quality checks (lint, test, build) still run

**How to Verify**:

```bash
# Edit documentation
echo "test" >> infra/k8s/base/readme.md
git add infra/k8s/base/readme.md
git commit -m "docs: update readme"
git push origin dev
```

Check CI output:

```
ℹ️  Only ignored files changed - skipping deployment
deploy_strategy=none
```

## Configuration Files

### Smart Deployment Config

Location: `infra/smart-deployment-config.yaml`

Defines:

- Service-to-file mappings
- Global trigger paths
- Ignored paths
- Deployment settings (parallel mode)

### Deploy Control Config

Location: `infra/deploy-control.yaml`

Defines:

- Environment enable/disable flags
- Auto-deploy settings
- Deployment windows
- Service-specific overrides

## CI Workflow Logic

**Triggers**:

- `push` to branches (dev/test/main)
- `pull_request` (validation only - no deployment)
- `workflow_call` (invoked by provision workflow after cluster creation)

The `detect-infra-changes` job in `.github/workflows/ci.yml` performs:

1. **Get changed files** - Uses dorny/paths-filter
2. **Load configuration** - Reads smart-deployment-config.yaml
3. **Check global triggers** - Match against global_triggers.paths
4. **Check ignored paths** - Filter out documentation changes
5. **Detect affected services** - Loop through all services, match resource paths
6. **Environment isolation** - Only match files for current branch's environment
7. **Trigger deployment** - Call deploy-k8s-resources.yml with parameters

## Troubleshooting

### Deployment not triggering

**Check**:

1. Is the file listed in `smart-deployment-config.yaml` under a service's resources?
2. Is the file in the `ignored_paths` list?
3. Is the branch mapped correctly in `environment_mappings`?
4. Are the deploy control flags enabled in `deploy-control.yaml`?

### Wrong service deployed

**Check**:

1. Verify resource path patterns in `smart-deployment-config.yaml`
2. Check for wildcard matching issues (`**` vs `*`)
3. Review environment isolation logic (dev/test/prod path matching)

### Wrong environment deployed

**Check**:

1. Verify branch name matches `environment_mappings` in config
2. Check if change is in correct environment patch directory
3. Review environment isolation checks in CI workflow

## Performance Metrics

**Single Service Deployment**:

- Traditional: ~3-5 minutes (all services)
- Smart: ~1-2 minutes (single service)
- Savings: 40-60%

**Parallel Deployment** (if enabled in `smart-deployment-config.yaml`):

- Sequential: ~3 minutes (3 services × 1 min each)
- Parallel: ~1 minute (3 services simultaneously)
- Savings: 66%

**Note**: Parallel deployment is controlled by `deployment_mode.parallel_deployment.enabled` in the config file.

## Next Steps

After testing, you can:

1. Enable parallel deployment in `smart-deployment-config.yaml`
2. Add new services to the configuration
3. Fine-tune ignored paths
4. Configure deployment windows for test/prod
