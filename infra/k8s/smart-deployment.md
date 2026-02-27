# Smart Service-Level Deployment System

## Overview

The platform now supports **intelligent granular deployment** - deploying individual services (postgres, redis, jaeger, etc.) independently based on what files changed, while respecting environment isolation.

## How It Works

### 1. Central Configuration

**File**: [infra/smart-deployment-config.yaml](../smart-deployment-config.yaml)

Defines service groupings, file-to-service mappings, and deployment rules:

```yaml
services:
  postgres:
    resources:
      - infra/k8s/base/statefulsets/postgres.statefulset.yaml
      - infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml
      - infra/k8s/hetzner/test/patches/statefulsets/postgres.statefulset.yaml
      - infra/k8s/hetzner/prod/patches/statefulsets/postgres.statefulset.yaml
    kubectl_labels:
      app: postgres
```

### 2. CI Detection Logic

**Workflow**: `.github/workflows/ci.yml` → `detect-infra-changes` → `trigger-deploy` job

**Decision Tree**:

```
Changed files detected
  ├─ Matches cluster config? → Trigger provision workflow (existing behavior)
  ├─ Matches ignored paths (docs)? → Skip deployment
  ├─ Matches global triggers? → Deploy ALL services to current env
  └─ Matches service resources? → Deploy ONLY affected service to current env
```

**Environment Isolation**:

- Dev patch change → Triggers **dev** deployment only
- Test patch change → Triggers **test** deployment only
- Prod patch change → Triggers **prod** deployment only
- Base resource change → Triggers deployment to **current branch's environment**

### 3. Deployment Strategies

**Strategy: `all`** (default, full deployment)

- Triggered by: Global triggers (kustomization.yaml, workflow changes, deploy-control.yaml)
- Action: `kubectl apply -f manifests.yaml --prune -l app.kubernetes.io/managed-by=kustomize`
- Deploys: All services in environment
- Note: The `app.kubernetes.io/managed-by=kustomize` label is added by kustomization.yaml's commonLabels, not on individual resources

**Strategy: `single`** (targeted deployment)

- Triggered by: Service-specific file changes
- Action: `kubectl apply -f manifests.yaml -l app=postgres` (single service)
- OR: Multiple parallel commands for multiple services (see Parallel Deployment section)
- Deploys: Only specified services

### 4. Label-Based Filtering

All K8s resources now have `app: {service-name}` labels:

```yaml
# Example: postgres.statefulset.yaml
metadata:
  name: postgres
  labels:
    app: postgres # ← Used for filtering
spec:
  template:
    metadata:
      labels:
        app: postgres
```

This enables `kubectl apply -l app=postgres` to deploy only postgres resources.

**For multiple services**: The parallel deployment system runs separate `kubectl apply` commands for each service in background jobs (see Parallel Deployment section).

## Deployment Scenarios

### Scenario 1: Base Resource Change (Affects All Environments)

**Change**: Edit `infra/k8s/base/statefulsets/postgres.statefulset.yaml`

**Behavior**:

- **Dev branch**: Deploys only postgres to **dev** environment
- **Test branch**: Deploys only postgres to **test** environment
- **Main branch**: Deploys only postgres to **prod** environment

**Why**: Base resources are shared, but deployment respects current branch environment.

### Scenario 2: Environment-Specific Patch Change

**Change**: Edit `infra/k8s/hetzner/dev/patches/statefulsets/redis.statefulset.yaml`

**Behavior**:

- **Dev branch**: Deploys only redis to **dev** environment
- **Test/Main branches**: No deployment (file doesn't match test/prod paths)

**Why**: Environment isolation prevents dev changes from affecting prod.

### Scenario 3: Global Trigger Change

**Change**: Edit `infra/k8s/base/kustomization.yaml`

**Behavior**:

- **Any branch**: Deploys ALL services to current branch's environment

**Why**: Kustomization changes affect resource ordering/references for all services.

### Scenario 4: Documentation Change

**Change**: Edit `infra/k8s/readme.md` or `infra/k8s/base/nginx-ingress/README.md`

**Behavior**:

- **Any branch**: No deployment triggered

**Why**: Documentation changes are in `ignored_paths` list.

### Scenario 5: Multiple Services Changed

**Change**: Edit both `infra/k8s/base/statefulsets/postgres.statefulset.yaml` and `infra/k8s/base/statefulsets/redis.statefulset.yaml`

**Behavior**:

- **Any branch**: Deploys **postgres AND redis** to current branch's environment
- CI detects: `affected_services="postgres,redis"`
- Workflow triggers deployment with `strategy=single, services=postgres,redis`
- **Deployment mode**: Parallel (detected 2 services)
- Action deploys each service simultaneously in background jobs
- **Result**: Both services deployed in ~1min (vs ~2min sequential)
- Jaeger remains untouched

**Why**: Parallel deployment automatically activates for multiple services, reducing total deployment time by ~60%.

### Scenario 6: Cluster Configuration Change

**Change**: Edit `infra/k8s/hetzner/dev/cluster/cluster-config.yaml`

**Behavior**:

- Triggers **provision-hetzner-k8s-cluster.yml** workflow
- Provision workflow creates/updates cluster
- Provision workflow triggers **deploy-k8s-resources.yml** with `strategy=all`
- **Result**: Full deployment after cluster provisioning completes

**Why**: Cluster changes handled by separate workflow (existing behavior preserved).

## Parallel Deployment

### How It Works

When multiple services are detected (e.g., `services=postgres,redis,jaeger`), the deployment action automatically switches to **parallel mode**:

```bash
# Traditional approach - single command with all services
# (NOT used in parallel mode)
kubectl apply -f manifests.yaml -l 'app in (postgres,redis,jaeger)'
# Total time: ~1-3 minutes (applies all, then waits for all rollouts)

# Parallel deployment (ACTUAL implementation)
kubectl apply -f manifests.yaml -l 'app=postgres' &  # Background job
kubectl apply -f manifests.yaml -l 'app=redis' &     # Background job
kubectl apply -f manifests.yaml -l 'app=jaeger' &    # Background job
wait  # Wait for all background jobs to complete
# Total time: ~1 minute (each service monitored independently)
```

**Key difference**: Each service gets its own apply + rollout monitoring, allowing independent success/failure tracking.

### Performance Comparison

| Scenario                             | Sequential | Parallel | Improvement     |
| ------------------------------------ | ---------- | -------- | --------------- |
| 1 service (postgres)                 | ~1 min     | ~1 min   | 0% (no benefit) |
| 2 services (postgres, redis)         | ~2 min     | ~1 min   | **50% faster**  |
| 3 services (postgres, redis, jaeger) | ~3 min     | ~1 min   | **67% faster**  |
| All infrastructure (3 services)      | ~3 min     | ~1 min   | **67% faster**  |

### When It Activates

- **Automatic**: Detects `service_count > 1` in deployment action
- **Example triggers**:
  - Edit both postgres and redis files → Parallel deployment
  - Manual workflow: `services=postgres,redis,jaeger` → Parallel deployment
  - Single service (`services=postgres`) → Standard deployment (no parallelization overhead)

### Error Handling & Auto-Rollback

```bash
# Scenario: postgres succeeds, redis fails (rollout timeout), jaeger succeeds
# Auto-rollback ENABLED in deploy-control.yaml

🚀 Deploying services in PARALLEL with rollout monitoring

Starting deployment: postgres
Starting deployment: redis
Starting deployment: jaeger

⏳ postgres: Waiting for rollout...
⏳ redis: Waiting for rollout...
⏳ jaeger: Waiting for rollout...

⏳ Waiting for all services to complete rollout...
  ✅ postgres: Deployment + rollout succeeded
  ❌ redis: Deployment or rollout failed
  ✅ jaeger: Deployment + rollout succeeded

❌ Parallel deployment completed with failures:
  - redis

🔄 Auto-rollback enabled - rolling back FAILED services only

🔄 Rolling back service: redis
  🔄 Rolling back StatefulSet/redis...
  ✅ Rollback completed for failed services

✅ Successfully deployed services (remain active):
  - postgres
  - jaeger

# Exit code 1 (job fails, but postgres + jaeger remain deployed)
```

**Rollback Behavior**:

- **Auto-rollback enabled** (via [deploy-control.yaml](../deploy-control.yaml)):
  - ✅ Failed services automatically rolled back to previous version
  - ✅ Successful services remain at new version (untouched)
  - ✅ Partial success preserved (no "all or nothing")
- **Auto-rollback disabled**:
  - ❌ Failed services remain in failed state
  - ✅ Successful services remain at new version
  - ℹ️ Manual intervention required to fix failed services

**Configuration** ([deploy-control.yaml](../deploy-control.yaml)):

```yaml
environments:
  dev:
    services:
      postgres:
        rollback_on_failure: false # Disabled by default - set to true to enable
      redis:
        rollback_on_failure: false

deployment_strategies:
  statefulset:
    rollback_on_failure: true # OR: Enable for all StatefulSets
    timeout: "2m" # Configurable rollout timeout
```

**Note**: Rollback uses OR logic - enabled if EITHER service-level OR strategy-level is true.

**Rollout Monitoring**:

- Each service's rollout status checked in parallel
- Timeout: Configurable via deploy-control.yaml (default: 2m for all workload types)
- Failure triggers rollback only for that specific service
- Other services continue independently

### Configuration

Control parallel deployment via [smart-deployment-config.yaml](../smart-deployment-config.yaml):

```yaml
deployment_mode:
  parallel_deployment:
    enabled: true # Set to false to force sequential deployment
```

**When to disable**:

- Small clusters with limited resources (parallel deployment may cause resource contention)
- Debugging deployment issues (sequential logs are easier to read)
- Services with implicit dependencies (not recommended - make dependencies explicit instead)

## Manual Deployment

You can manually trigger deployments via GitHub Actions UI:

### Deploy All Services

```yaml
Workflow: deploy-k8s-resources.yml
Environment: dev/test/prod
Deploy Strategy: all
Services: all
```

### Deploy Specific Service

```yaml
Workflow: deploy-k8s-resources.yml
Environment: dev
Deploy Strategy: single
Services: redis
```

### Deploy Multiple Services

```yaml
Workflow: deploy-k8s-resources.yml
Environment: test
Deploy Strategy: single
Services: postgres,redis,jaeger
```

## Adding New Services

To add a new infrastructure service (e.g., `rabbitmq`):

### 1. Create K8s Resources

```bash
# Create base resources
infra/k8s/base/statefulsets/rabbitmq.statefulset.yaml
infra/k8s/base/services/rabbitmq.service.yaml
infra/k8s/base/configmaps/rabbitmq.configmap.yaml
infra/k8s/base/secrets/rabbitmq.secret.yaml

# Add app label to all resources
metadata:
  labels:
    app: rabbitmq
```

### 2. Add to smart-deployment-config.yaml

**That's it!** The CI workflow automatically parses this file to detect affected services.

```yaml
services:
  rabbitmq:
    type: infrastructure
    description: "RabbitMQ message broker"
    resources:
      # Base resources (provider/environment-agnostic)
      - infra/k8s/base/statefulsets/rabbitmq.statefulset.yaml
      - infra/k8s/base/services/rabbitmq.service.yaml
      - infra/k8s/base/configmaps/rabbitmq.configmap.yaml
      - infra/k8s/base/secrets/rabbitmq.secret.yaml
      # Environment patches (provider/environment-specific)
      - infra/k8s/hetzner/dev/patches/statefulsets/rabbitmq.statefulset.yaml
      - infra/k8s/hetzner/test/patches/statefulsets/rabbitmq.statefulset.yaml
      - infra/k8s/hetzner/prod/patches/statefulsets/rabbitmq.statefulset.yaml
      - infra/k8s/podman/local/patches/statefulsets/rabbitmq.statefulset.yaml
    kubectl_labels:
      app: rabbitmq
```

**No workflow changes needed!** CI dynamically reads smart-deployment-config.yaml.

### 3. Test Deployment

```bash
# Make a change to the service
echo "# Updated config" >> infra/k8s/base/configmaps/rabbitmq.configmap.yaml
git add . && git commit -m "test: trigger rabbitmq deployment"
git push origin dev

# CI will:
# 1. Detect infra/k8s/base/configmaps/rabbitmq.configmap.yaml changed
# 2. Determine environment from branch (dev)
# 3. Trigger deploy workflow with strategy=single, services=rabbitmq
# 4. Deploy only rabbitmq to dev environment
```

## Benefits

✅ **Faster Deployments**: Deploy only what changed (1 service vs 3+ services)
✅ **Environment Isolation**: Dev changes never trigger prod deployments
✅ **Reduced Risk**: Smaller blast radius per deployment
✅ **Better CI Feedback**: Clearer which service triggered deployment
✅ **Flexible**: Manual override for full deployments when needed
✅ **Backward Compatible**: Default behavior is still "deploy all"

## Implementation Details

### Modified Files

1. **infra/smart-deployment-config.yaml** (new)
   - Central service configuration
   - File-to-service mappings
   - Global triggers and ignored paths

2. **.github/workflows/deploy-k8s-resources.yml**
   - Added `deploy_strategy` input (all/single)
   - Added `services` input (comma-separated list)
   - Passes strategy to composite action

3. **.github/workflows/ci.yml**
   - Enhanced `trigger-deploy` job with service detection logic
   - Environment-aware path filtering
   - Smart strategy selection (all vs single)

4. **.github/actions/deploy-k8s-resources/action.yml**
   - Added `deployStrategy` and `services` inputs
   - Label-based kubectl filtering for single strategy
   - Maintains all existing error handling (immutable fields, rollback)

5. **infra/k8s/base/**/\*.yaml\*\*
   - Added `app: {service}` labels to all resources
   - Enables kubectl label selectors

### No Changes Required To

- Deployment control flags (`deploy-control.yaml`)
- Secret substitution logic
- Rollback mechanisms
- Immutable field error handling
- Workload discovery (already uses manifests.yaml)

## Decision Flow Diagram

```
                           ┌─────────────────────────┐
                           │   Push to branch        │
                           │   (dev/test/main)       │
                           └───────────┬─────────────┘
                                       │
                           ┌───────────▼─────────────┐
                           │  Get changed files      │
                           │  (git diff)             │
                           └───────────┬─────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
        ┌─────────▼─────────┐  ┌──────▼──────┐  ┌─────────▼─────────┐
        │ Cluster config?   │  │ Deploy      │  │ Other files       │
        │ (cluster/*.yaml)  │  │ files?      │  │                   │
        └─────────┬─────────┘  └──────┬──────┘  └─────────┬─────────┘
                  │ YES                │ YES              │ NO
                  │                    │                  │
        ┌─────────▼─────────┐          │           ┌──────▼───────┐
        │ Trigger:          │          │           │ No action    │
        │ provision-        │          │           │              │
        │ hetzner-k8s-      │          │           └──────────────┘
        │ cluster.yml       │          │
        └─────────┬─────────┘          │
                  │                    │
                  └────────┬───────────┘
                           │
                 ┌─────────▼──────────┐
                 │ Parse smart-       │
                 │ deployment-        │
                 │ config.yaml        │
                 └─────────┬──────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
    ┌─────────▼─────┐ ┌───▼───┐ ┌─────▼─────────┐
    │ Global        │ │Ignored│ │ Service       │
    │ trigger?      │ │paths? │ │ resources?    │
    │ (kustomize,   │ │(*.md) │ │ (postgres,    │
    │  workflows)   │ │       │ │  redis, etc)  │
    └────┬──────────┘ └───┬───┘ └────┬──────────┘
         │ YES            │ YES       │ YES
         │                │           │
    ┌────▼────┐      ┌────▼────┐ ┌───▼──────────┐
    │ Deploy  │      │ Skip    │ │ Check env    │
    │ ALL     │      │         │ │ isolation    │
    │ services│      │         │ └───┬──────────┘
    └────┬────┘      └─────────┘     │
         │                       ┌────┼────┐
         │                       │         │
         │              ┌────────▼───┐ ┌───▼────────┐
         │              │ Base file  │ │ Patch file │
         │              │            │ │            │
         │              └────┬───────┘ └───┬────────┘
         │                   │             │
         │                   │    ┌────────▼────────┐
         │                   │    │ Matches current │
         │                   │    │ environment?    │
         │                   │    └────┬────────────┘
         │                   │         │ YES/NO
         │                   └─────┬───┘
         │                         │ YES
         │                    ┌────▼─────────┐
         │                    │ Deploy ONLY  │
         │                    │ affected     │
         │                    │ service(s)   │
         │                    └────┬─────────┘
         │                         │
         └─────────────────────────┘
                           │
                 ┌─────────▼──────────┐
                 │ Trigger:           │
                 │ deploy-k8s-        │
                 │ resources.yml      │
                 │ (strategy + svcs)  │
                 └────────────────────┘
```

## Troubleshooting

### Service Not Deploying When File Changes

**Symptoms**: Changed a service file but deployment didn't trigger

**Diagnosis Steps**:

1. Check file path matches pattern in [smart-deployment-config.yaml](../smart-deployment-config.yaml)
   ```bash
   # Example: Check if your file is listed
   yq -r '.services.postgres.resources[]' infra/smart-deployment-config.yaml
   ```
2. Verify environment isolation isn't blocking it
   - Changing `hetzner/prod/patches/postgres.yaml` on dev branch won't deploy
   - Solution: Push to correct branch or change base file instead
3. Check GitHub Actions logs for detection output
   - Look for "Checking service: postgres" messages
   - Verify "✅ Service affected" appears

**Common Fixes**:

- Add missing file pattern to `smart-deployment-config.yaml` resources list
- Push to correct branch (dev/test/main)
- Check wildcard pattern syntax (`**` for recursive, `*` for single-level)

### Wrong Environment Deployed

**Symptoms**: Deployment went to wrong environment (e.g., dev change deployed to prod)

**Diagnosis Steps**:

1. Verify branch-to-environment mapping:
   - `main` → prod
   - `test` → test
   - `dev` (or any other) → dev
2. Check patch path includes correct environment folder
   ```bash
   # Wrong: infra/k8s/hetzner/prod/patches/postgres.yaml on dev branch
   # Right: infra/k8s/hetzner/dev/patches/postgres.yaml on dev branch
   ```
3. Review CI logs for environment determination:
   ```
   Target environment: dev  # Should match your expectation
   ```

**Common Fixes**:

- Push to correct branch
- If editing patch files, ensure folder matches target environment
- Base file changes deploy to current branch's environment (by design)

### All Services Deployed When Only One Changed

**Symptoms**: Expected single-service deployment, got full deployment

**Diagnosis Steps**:

1. Check if changed file is in `global_triggers` list:
   ```yaml
   # smart-deployment-config.yaml
   global_triggers:
     - ^infra/k8s/base/kustomization\.yaml
     - ^\.github/workflows/deploy-k8s-resources\.yml
     - ^\.github/actions/deploy-k8s-resources/
     - ^infra/deploy-control\.yaml
   ```
2. Verify file not matching multiple service patterns unintentionally
3. Review CI logs for strategy selection:
   ```
   🚨 Global trigger detected - deploying ALL services to dev
   # vs
   ✅ Affected services in dev: postgres
   ```

**Common Fixes**:

- If global trigger change is unintentional, move file out of global_triggers
- If intentional (e.g., workflow change), full deployment is correct
- For single-service changes, ensure file matches only one service pattern

### Documentation Change Triggered Deployment

**Symptoms**: README edit caused deployment

**Diagnosis Steps**:

1. Check if file path is in `ignored_paths` list:
   ```yaml
   # smart-deployment-config.yaml
   ignored_paths:
     - ^infra/k8s/.*\.md$
     - ^infra/k8s/base/nginx-ingress/
   ```
2. Verify path pattern uses proper regex escaping
   - `\.md$` not `.md$` (dot must be escaped)
3. Check CI logs:
   ```
   ℹ️  Only ignored files changed - skipping deployment
   # vs
   ✅ Affected services in dev: postgres  # Shouldn't happen for docs
   ```

**Common Fixes**:

- Add missing path pattern to `ignored_paths` in smart-deployment-config.yaml
- Ensure regex pattern is correct (test with `grep -E`)
- Push update to smart-deployment-config.yaml to fix for future changes

### Manual Deployment Failed with "No specific services provided"

**Symptoms**: Workflow dispatch failed with validation error

**Error Message**:

```
❌ Deployment strategy is 'single' but no specific services provided
Services value: ''
```

**Fix**:
Use correct combination of inputs:

- **Option 1**: `strategy=all`, `services=all` (deploy everything)
- **Option 2**: `strategy=single`, `services=postgres` (deploy postgres only)
- **Option 3**: `strategy=single`, `services=postgres,redis` (deploy postgres and redis)

**Invalid**: `strategy=single`, `services=all` (rejected by validation)

### Service Deployment Timed Out

**Symptoms**: Deployment job failed with rollout timeout

**Diagnosis Steps**:

1. Check workload is actually starting:
   ```bash
   kubectl get pods -l app=postgres -n default
   ```
2. Review pod events for errors:
   ```bash
   kubectl describe pod postgres-0 -n default
   ```
3. Check timeout values in [deploy-control.yaml](../deploy-control.yaml):
   ```yaml
   deployment_strategies:
     statefulset:
       timeout: "2m" # Default is 2m - may need adjustment for slow clusters
   ```

**Common Fixes**:

- Increase timeout in deploy-control.yaml
- Fix underlying issue (image pull errors, resource constraints, etc.)
- Check if PVC binding is stuck (for StatefulSets)

## Future Enhancements

### Application Services

- [ ] **Application Deployment Support**: Extend to application services (not just infrastructure)
  - Add api-gateway, account-service, messaging-service, etc. to smart-deployment-config.yaml
  - Map application code changes (`apps/**`) to trigger service deployments
  - Current state: Only infrastructure services supported (postgres, redis, jaeger)
  - Future: `apps/api-gateway/src/**` changes trigger api-gateway deployment

### Deployment Intelligence

- [ ] **Deployment Metrics**: Track deployment strategy distribution (how often single vs all)
  - Add telemetry to CI job to collect deployment patterns
  - Create dashboard showing: most frequently deployed services, avg deployment time per service
  - Alert on unusual patterns (e.g., prod deploying more often than dev)

- [ ] **Dry-Run Mode**: Preview what would be deployed without applying
  - Add `dry_run` input to workflow_dispatch
  - Use `kubectl apply --dry-run=client -f manifests.yaml` to validate
  - Generate PR comment showing: "This PR will deploy: postgres, redis to dev environment"
- [ ] **PR Deployment Preview**: Comment on PR with deployment plan
  - GitHub Action comments on PR: "✅ Will deploy **postgres** to dev on merge"
  - Include resource changes summary (new/modified/deleted resources)
  - Link to deployment workflow for manual override

### Service Dependencies

- [ ] **Dependency-Aware Deployment**: Auto-deploy dependent services
  - Add `depends_on` field to smart-deployment-config.yaml service definitions
  - If api-gateway changes, automatically include postgres in deployment
  - Validate dependencies are healthy before deploying dependent service
- [ ] **Service Health Checks**: Validate service health before marking deployment complete
  - Add custom health check URLs to smart-deployment-config.yaml
  - Poll health endpoints after deployment
  - Auto-rollback if health check fails within timeout window

### Performance Optimizations

- [x] **Parallel Service Deployment**: ✅ **IMPLEMENTED**
  - Automatically detects when multiple services need deployment
  - Deploys each service simultaneously using background jobs
  - Waits for all to complete and reports any failures
  - **Performance**: 3 services: ~3min sequential → ~1min parallel
  - **Configuration**: [smart-deployment-config.yaml](../smart-deployment-config.yaml) `deployment_mode.parallel_deployment.enabled`

- [ ] **Incremental Rollout**: Canary deployments for single services
  - Add `canary: true` flag to smart-deployment-config.yaml
  - Deploy to subset of pods first (10% → 50% → 100%)
  - Monitor metrics during rollout, auto-rollback on errors

### Observability

- [ ] **Deployment Dashboard**: Visual representation of which services are deployed where
  - Show service version matrix across environments
  - Highlight services out of sync (different versions in dev vs prod)
  - One-click deployment promotion (dev → test → prod)

- [ ] **Auto-Rollback on Dependency Failure**: Rollback service if dependent service fails
  - Monitor dependent services after deployment
  - If postgres fails health check, auto-rollback api-gateway
  - Prevent cascading failures

### Developer Experience

- [ ] **Local Service Deployment**: Test single-service deployment on local Podman cluster
  - Add `pnpm run infra:local:deploy:single -- postgres` script
  - Use same label-filtering logic as CI
  - Faster iteration cycle for service-specific changes

- [ ] **Service Isolation Testing**: Verify service can deploy independently
  - Pre-merge validation: "Can this service deploy alone?"
  - Check for unintended global trigger patterns
  - Prevent accidental full deployments
