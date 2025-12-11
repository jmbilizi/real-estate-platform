# Kubernetes GitOps Implementation Summary

## Overview

This document describes the current Kubernetes infrastructure implementation using Kustomize-based architecture with GitOps automation and hierarchical deployment control.

## Current Architecture

### 1. Directory Structure

```
infra/
├── deploy-control.yaml                              # Centralized deployment flags
└── k8s/
    ├── base/                                        # Shared base configs
    │   ├── kustomization.yaml                       # Base Kustomize configuration
    │   ├── configmaps/
    │   │   ├── postgres-init.configmap.yaml         # PostgreSQL multi-tenant init
    │   │   ├── redis.configmap.yaml                 # Redis production config + ACL users
    │   │   └── redis-acl-guide.md                   # Redis ACL documentation
    │   ├── secrets/
    │   │   ├── postgres.secret.yaml                 # PostgreSQL passwords (4 users)
    │   │   └── redis.secret.yaml                    # Redis ACL passwords (5 users)
    │   ├── services/
    │   │   ├── postgres.service.yaml                # PostgreSQL headless + ClusterIP
    │   │   ├── redis.service.yaml                   # Redis headless + ClusterIP
    │   │   └── jaeger.service.yaml                  # Jaeger headless + ClusterIP
    │   └── statefulsets/
    │       ├── postgres.statefulset.yaml            # PostgreSQL 18 + PostGIS 3.4
    │       ├── redis.statefulset.yaml               # Valkey 9.0-alpine with ACL
    │       └── jaeger.statefulset.yaml              # Jaeger + OpenTelemetry all-in-one
    ├── hetzner/                                     # Hetzner Cloud provider
    │   ├── dev/
    │   │   ├── cluster/
    │   │   │   └── cluster-config.yaml
    │   │   ├── patches/
    │   │   │   └── statefulsets/
    │   │   │       ├── postgres.statefulset.yaml    # Dev resources + storage
    │   │   │       ├── redis.statefulset.yaml       # Dev resources + storage
    │   │   │       └── jaeger.statefulset.yaml      # Dev resources + storage
    │   │   ├── kustomization.yaml                   # Kustomize overlay
    │   │   └── .gitignore
    │   ├── test/
    │   │   └── ... (same structure as dev)
    │   └── prod/
    │       └── ... (same structure as dev)
    └── podman/                                      # Podman Desktop local provider
        └── local/
            ├── patches/
            │   └── statefulsets/
            │       ├── postgres.statefulset.yaml    # Local resources + storage (combined)
            │       ├── redis.statefulset.yaml       # Local resources + storage (combined)
            │       └── jaeger.statefulset.yaml      # Local resources + storage (combined)
            └── kustomization.yaml                   # Kustomize overlay
```

### 2. File Naming Convention

Pattern: `{service}.{kind}.yaml`

**Examples:**

- `postgres.statefulset.yaml` - PostgreSQL StatefulSet
- `redis.statefulset.yaml` - Redis StatefulSet
- `postgres.service.yaml` - PostgreSQL Service
- `redis.service.yaml` - Redis Service
- `postgres-init.configmap.yaml` - PostgreSQL initialization script
- `redis.configmap.yaml` - Redis production configuration
- `cluster-config.yaml` - Cluster configuration (in provider/env/cluster/)

### 3. Kustomize Architecture

**Base + Overlay Pattern:**

- `base/kustomization.yaml` - Defines all shared resources (Secrets, ConfigMaps, Services, StatefulSets)
- `hetzner/{env}/kustomization.yaml` - References base (`../../base`) and applies environment-specific patches

**Resources in Base:**

- **PostgreSQL**: postgis/postgis:18-3.4, multi-tenant initialization, 4 database users
- **Redis**: valkey/valkey:9.0-alpine, ACL-based authentication, 5 service users
- **Jaeger**: jaegertracing/opentelemetry-all-in-one:latest, distributed tracing, OTLP endpoints
- **Services**: Headless (for StatefulSet DNS) + ClusterIP (for load balancing)

**Minimal Base Philosophy:**

The base layer contains ONLY configuration that is **identical across all environments**:

- ✅ Container images (postgis/postgis:18-3.4, valkey/valkey:9.0-alpine)
- ✅ Health probes (pg_isready, redis-cli ping)
- ✅ Environment variables (connection strings, ACL passwords)
- ✅ Volume mounts (/var/lib/postgresql/data, /data for Redis)
- ✅ Security context (fsGroup: 999 for both PostgreSQL and Redis)
- ✅ Init containers (PostgreSQL multi-database, Redis ACL substitution)

**NEVER in base** (must be defined in patches):

- ❌ Resources (requests/limits) - varies by environment (dev: lower, prod: higher)
- ❌ Storage size/class - varies by provider (hetzner: hcloud-volumes, aws: gp3, gcp: pd-ssd)
- ❌ Replicas - single-instance (dev) vs HA (prod: multiple replicas)
- ❌ Affinity rules - production-specific

**Benefits**:

- Base changes ONLY for features/bugs (version upgrades, new env vars, probe tuning)
- Every environment explicitly declares its resource budget (self-documenting)
- No accidental inheritance of stale defaults
- Clear separation: base = what to run, patches = how much resources
- **PostgreSQL**: Multi-tenant databases (account_service_db, messaging_service_db, property_service_db)
- **Redis**: Enterprise ACL mode (admin, pubsub_user, cache_user, ratelimit_user, monitor users)

**Modern Kustomize Syntax:**

- `resources: [../../base]` - Reference base directory (not individual files)
- `patches:` - Modern syntax (replaces deprecated `patchesStrategicMerge`)
- `labels:` - Modern syntax (replaces deprecated `commonLabels`)

**Why base/kustomization.yaml is required:**

Kustomize overlays must reference a directory containing a `kustomization.yaml`, not individual resource files. This provides:

- Proper resource ordering (Secrets → ConfigMaps → Services → StatefulSets)
- Centralized base resource management
- Security validation (prevents referencing files outside base directory)

### 4. Deployment Control System

**File:** `infra/deploy-control.yaml` (v3.0.0)

**Purpose:** Centralized configuration controlling which environments are enabled for automated deployment.

**Architecture Principle:** All environments (dev/test/prod) have **identical YAML structure** with different values. This design ensures:

- Features can be tested in dev with `enabled: false` before promoting to test/prod
- Configuration changes can be safely merged across branches
- No structural surprises when promoting code between environments
- Clear documentation of all available controls per environment

**Currently Used by Workflows:**

- `enabled` - Whether environment accepts deployments
- `auto_deploy` - Whether to deploy automatically on push
- `require_manual_approval` - Whether manual approval required

**Defined for Future Implementation (all disabled for now):**

- `deployment_windows` - Time-based deployment restrictions
- `services.postgres.*` - Service-specific settings (resources, health checks, rollback)

**Workflow Implementation:** The deploy-k8s-resources.yml workflow now reads and enforces ALL deployment control settings:

- ✅ `enabled` and `auto_deploy` - Basic deployment gates
- ✅ `deployment_windows` - Blocks deployment outside allowed days/hours
- ✅ `services.postgres.*` - Service-level controls (enabled, auto_deploy, require_approval)
- ✅ `rollback_on_failure` - Automatically reverts failed rollouts

**Health Validation:** Kubernetes native probes (livenessProbe, readinessProbe) in the StatefulSet spec handle health checking. The workflow relies on `kubectl rollout status` which waits for pods to be ready based on these probes.

**Configuration Structure (all environments have same keys, different values):**

```yaml
global:
  auto_deploy: true # Master kill switch

environments:
  dev:
    enabled: true
    auto_deploy: true # Auto-deploy on push to dev branch
    require_manual_approval: false
    deployment_windows:
      enabled: false # No time restrictions in dev
    services:
      postgres:
        enabled: true
        auto_deploy: true
        rollback_on_failure: false # TODO: Enable to test rollback workflows

  test:
    enabled: true
    auto_deploy: false # Manual workflow dispatch
    require_manual_approval: false
    deployment_windows:
      enabled: false # TODO: Enable to test time restrictions
    services:
      postgres:
        enabled: true
        auto_deploy: false
        rollback_on_failure: false # TODO: Enable to test rollback workflows

  prod:
    enabled: true
    auto_deploy: false # NEVER auto-deploy
    require_manual_approval: true # ALWAYS require approval
    deployment_windows:
      enabled: false # TODO: Enable when implemented
    services:
      postgres:
        enabled: true
        auto_deploy: false
        rollback_on_failure: false # TODO: Enable when workflow implements rollback
```

**Key Point:** All environments have the same YAML keys - only the values differ. This allows testing features in dev before promoting to production.

**Architecture Principle:** deploy-control.yaml controls deployment policies (WHEN/HOW), while Kustomize patches control resource specifications (WHAT). This separation ensures:

- Single source of truth for each concern
- No duplication or drift between configurations
- Clear ownership (ops controls gates, devs control resources)

### 4. Kustomize Architecture

**Base Layer** (`infra/k8s/base/`):

- Shared configurations used by all environments
- Template secrets with StrongBase64Password values
- StatefulSet with minimal resources
- Services, ConfigMaps unchanged across environments

**Overlay Layers** (`infra/k8s/hetzner/{env}/`):

- Environment-specific patches (resources, storage)
- Secrets substituted in-memory using yq (GitHub Actions)
- Common labels: `environment: dev/test/prod`, `provider: hetzner`
- Namespace: `default`

**Benefits:**

- DRY principle - No duplication across environments
- Type-safe patches - JSON strategic merge
- Secret management - YAML template with in-memory yq substitution, never committed
- Easy to add environments - Copy overlay directory, change values

### 5. GitHub Actions Workflows

#### **hetzner-k8s.yml**

**Purpose:** Create/update Kubernetes clusters on Hetzner Cloud

**Triggers:**

- Push to `main`/`test`/`dev` branches
- Changes to `infra/k8s/hetzner/*/cluster/*.yaml`
- Manual workflow dispatch

**Key Features:**

- Uses `infra/k8s/hetzner/{env}/cluster/cluster-config.yaml` files
- Reads `auto_deploy` flag from cluster config
- Installs hetzner-k3s CLI
- Configures SSH keys from GitHub Secrets
- Creates/updates cluster (idempotent operation)
- Cluster readiness validation (waits for nodes, verifies CSI driver)
- Triggers resource deployment workflow after cluster ready

**Workflow:**

1. Detect changes using dorny/paths-filter
2. Check cluster `auto_deploy: true` flag
3. Setup SSH keys from GitHub Secrets
4. Substitute secrets in config
5. Create/update cluster with hetzner-k3s
6. Wait for cluster readiness (nodes, CSI driver, StorageClass)
7. **Upload KUBECONFIG** to GitHub Secrets (environment-scoped) using GitHub CLI
8. Trigger deploy-k8s-resources.yml workflow (passes environment parameter)

#### **deploy-k8s-resources.yml**

**Purpose:** Deploy Kubernetes resources using Kustomize

**Triggers:**

- Push to `main`/`test`/`dev` branches
- Changes to `infra/k8s/base/**` or `infra/k8s/hetzner/**`
- Changes to `infra/deploy-control.yaml`
- Manual workflow dispatch
- Called by hetzner-k8s.yml after cluster creation

**Key Features:**

- PR Validation - Validates Kustomize builds on PRs (no deployment)
- Change Detection - Deploys only affected environments
- Base Changes - Deploys to all environments if base/ changes
- **Full Deployment Control Enforcement:**
  - ✅ Environment gates (`enabled`, `auto_deploy`)
  - ✅ Service-level gates (`services.postgres.enabled`, `services.postgres.auto_deploy`)
  - ✅ Deployment windows (time/day restrictions with emergency override)
  - ✅ Health validation (via Kubernetes readinessProbe/livenessProbe)
  - ✅ Automatic rollback (reverts failed rollouts)
- Secret Substitution - Uses yq to replace StrongBase64Password with actual secrets in-memory
- Server-Side Apply - Better field ownership and conflict resolution
- Rollout Verification - Waits for StatefulSet ready status
- Resource Verification - Checks all resources after deployment

**Deployment Flow (per environment):**

1. **Load and validate deploy-control.yaml:**
   - Check: `.environments.{env}.enabled == true`
   - Check: `.environments.{env}.services.postgres.enabled == true`
   - Check: `.environments.{env}.auto_deploy == true`
   - Check: `.environments.{env}.services.postgres.auto_deploy == true`
   - Check deployment windows (if enabled): current day/time allowed
   - Exit early if any check fails

2. **Install tools:** kubectl, Kustomize (yq already installed in step 1)

3. **Configure kubectl** using `{ENV}_KUBECONFIG` from GitHub Secrets

4. **Substitute secrets** in `base/secrets/postgres.secret.yaml` and `base/secrets/redis.secret.yaml` using yq (in-memory only)

5. **Build Kustomize manifests:** `kustomize build infra/k8s/hetzner/{env}`

6. **Apply manifests with error-driven immutable field handling:**
   - Try `kubectl apply` first (fail fast)
   - If immutable field error detected:
     - Extract failed StatefulSet name(s) from error message
     - Delete ONLY those StatefulSets (`--cascade=orphan` preserves PVCs)
     - Retry `kubectl apply`
   - Pattern eliminates false positives (only acts on actual errors)
   - Scales to any number of StatefulSets (no hardcoded resource checks)

7. **Wait for rollout:** `kubectl rollout status statefulset/{name}` (300s dev/test, 600s prod)
   - Waits for pods to pass readinessProbe checks
   - Ensures StatefulSet reaches desired state

8. **Rollback on failure** (if enabled):
   - Automatically reverts if rollout fails
   - Runs `kubectl rollout undo statefulset/{name}`
   - Marks workflow as failed

9. **Verify deployment:** Check StatefulSet, Pods, Services, PVCs

### 6. Environment-Specific Configurations

**Resource specifications are defined in Kustomize patches** (`infra/k8s/{provider}/{env}/patches/statefulsets/`):

- **postgres.statefulset.yaml** - Defines replicas, memory requests/limits, CPU requests/limits, pod affinity rules, storage size, and StorageClass (combined patch)

| Environment | Provider | Auto-Deploy | Production Features                                                                               |
| ----------- | -------- | ----------- | ------------------------------------------------------------------------------------------------- |
| **Local**   | podman   | Manual      | Minimal resources, local-path storage, quick iteration                                            |
| **Dev**     | hetzner  | ✅ True     | Fast iteration, minimal resources, hcloud-volumes                                                 |
| **Test**    | hetzner  | ❌ False    | Manual deployment, same as dev resources                                                          |
| **Prod**    | hetzner  | ❌ False    | Manual approval required, HA setup (multiple replicas), pod anti-affinity, longer rollout timeout |

## Core Components

### Cluster Configuration

**Cluster Names** (preserved to prevent recreation):

- `hetzner-dev-cluster`
- `hetzner-test-cluster`
- `hetzner-prod-cluster`

**Network Configuration (CRITICAL for image pulling):**

All Hetzner clusters require explicit outbound firewall rules. When ANY outbound rule is defined in Hetzner Cloud Firewall, it switches to deny-all mode. K3s requires access to multiple endpoints beyond just registries, so we allow all outbound traffic per K3s documentation recommendations.

**Required Configuration** (`cluster-config.yaml`):

```yaml
custom_firewall_rules:
  - description: "Allow all outbound traffic"
    direction: out
    protocol: tcp
    port: any
    destination_ips:
      - 0.0.0.0/0
  - description: "Allow all outbound UDP"
    direction: out
    protocol: udp
    port: any
    destination_ips:
      - 0.0.0.0/0

embedded_registry_mirror:
  enabled: true # K3s P2P image distribution
```

**Why All Outbound Traffic:**

- **K3s Infrastructure**: GitHub releases, package repositories, system updates
- **Container Registries**: Docker Hub, GitHub Container Registry, registry.k8s.io, gcr.io
- **DNS Resolution**: Required for all external hostname lookups
- **Embedded Registry**: Reduces external pulls by sharing images across nodes via P2P
- **K3s Documentation**: "Typically, all outbound traffic is allowed"

**Consequences of Blocking Outbound:**

- Pods stuck in `ImagePullBackOff` or `ErrImagePull` state
- Deployments timeout waiting for pod readiness
- K3s unable to download required components
- Manual intervention required to diagnose and fix

**Applied to All Environments:** dev, test, prod cluster configs include these rules to ensure consistent behavior across all deployments.

### PostgreSQL Configuration

**Image:** `postgis/postgis:18-3.4`

**Databases:**

- `account_db` - User accounts and authentication
- `messaging_db` - Real-time messaging
- `property_db` - Property listings and search
- `appdb` - General application data

**Extensions:**

- `uuid-ossp` - UUID generation
- `postgis` - Geospatial features
- `pg_trgm` - Text search optimization

### Redis (Valkey) Configuration

**Image:** `valkey/valkey:9.0-alpine` (BSD-licensed Redis fork)

**Authentication:** Enterprise ACL mode (user-based access control)

**ACL Users:**

- `admin` - Full access (operations, monitoring, probes)
- `pubsub_user` - Pub/Sub and messaging keys (`~messaging:*`, `~pubsub:*`) - Used by messaging-service, notification-service, websocket-gateway
- `cache_user` - Cache and session keys (`~cache:*`, `~session:*`) - Used by property-service, account-service
- `ratelimit_user` - Rate limiting counters (`~ratelimit:*`) - Used by api-gateway
- `monitor` - Read-only monitoring (Prometheus/Grafana)

**Use Cases:**

- **Caching**: Sessions, API responses, computed results
- **Pub/Sub**: WebSocket notifications, real-time messaging
- **Rate Limiting**: API throttling, abuse prevention
- **Counters**: Analytics, metrics, leaderboards

**Persistence:** AOF+RDB hybrid for data durability

**Security Benefits:**

- User-based access control (prevents cross-service data access)
- Audit trails (WHO accessed data, not just WHAT)
- Least privilege (each service gets only needed permissions)
- Compliance ready (SOC2, HIPAA, PCI-DSS)
- Key namespacing (service-specific key patterns)

**Documentation:** See `infra/k8s/redis-acl-guide.md` for:

- ACL user permissions and command restrictions
- Application connection examples (Node.js, Python, .NET)
- Key naming conventions per service
- Operations (check permissions, monitor activity, add users)
- Troubleshooting permission errors

**Schemas:**

- `reference` - Reference data
- `config` - Configuration
- `audit` - Audit logging

**Storage Policy:** `persistentVolumeReclaimPolicy: Retain` (prevents data loss)

**Service Architecture:**

- Headless service for StatefulSet
- ClusterIP service for external access

**Health Probes:**

- Startup probe - Initial readiness check
- Liveness probe - Detects crashes
- Readiness probe - Ready for traffic

## Deployment Safety

### Idempotent Operations

All operations are designed to be safely repeatable:

- `kubectl apply` can run multiple times without side effects
- `hetzner-k3s create` updates existing clusters in-place
- Cluster names are preserved to prevent accidental recreation
- PersistentVolumes use Retain policy to prevent data loss

## Required GitHub Secrets

Configure these in GitHub repository settings:

### Hetzner Cloud

- `HETZNER_TOKEN` - Hetzner Cloud API token
- `HETZNER_SSH_PRIVATE_KEY` - SSH private key for cluster nodes
- `HETZNER_SSH_PUBLIC_KEY` - SSH public key for cluster nodes

### Infrastructure Deployment

- `INFRA_DEPLOY_TOKEN` - Personal Access Token (PAT) with `repo` scope
  - **Purpose**:
    1. Upload KUBECONFIG to environment secrets (default `GITHUB_TOKEN` lacks write permission)
    2. Trigger deploy-k8s-resources workflow (default `GITHUB_TOKEN` lacks actions:write permission)
  - **Scope**: `repo` (Full control of private repositories)
  - **Security**: Rotate regularly, monitor usage in audit logs

### Kubeconfig Files (Environment Secrets)

- `KUBECONFIG` - kubectl config (automatically uploaded by hetzner-k8s workflow after cluster creation/update)
  - Scoped to each environment (dev, test, prod)
  - Protected by environment-level access controls

**Architecture Decision**: Environment secrets with PAT instead of repository secrets.

**Rationale**:

1. **API Permissions**: GitHub Actions `GITHUB_TOKEN` has limited permissions:
   - **Read-only** access to the secrets API (cannot write secrets)
   - **No** `actions:write` permission (cannot trigger workflows via API)
   - Writing secrets and triggering workflows requires a PAT with `repo` scope or GitHub App token
2. **Security Benefits**: Environment secrets provide:
   - Scoped access (secrets only available to jobs declaring the environment)
   - Protection rules (required approvals, deployment branches)
   - Better audit trail for sensitive operations
   - Granular access control per environment
3. **Trade-off**: Requires PAT management (creation, rotation, monitoring) vs convenience of default token.

**Implementation**:

- `hetzner-k8s.yml` uses `gh secret set KUBECONFIG --env {env}` with `INFRA_DEPLOY_TOKEN` PAT
- `hetzner-k8s.yml` uses `gh workflow run` with `INFRA_DEPLOY_TOKEN` PAT to trigger deployments
- `deploy-k8s-resources.yml` reads `secrets.KUBECONFIG` from environment scope

### PostgreSQL Passwords

**Dev:**

- `POSTGRES_SA_PASSWORD`
- `ACCOUNT_SERVICE_DB_USER_PASSWORD`
- `MESSAGING_SERVICE_DB_USER_PASSWORD`
- `PROPERTY_SERVICE_DB_USER_PASSWORD`

**Test:**

- `POSTGRES_SA_PASSWORD`
- `ACCOUNT_SERVICE_DB_USER_PASSWORD`
- `MESSAGING_SERVICE_DB_USER_PASSWORD`
- `PROPERTY_SERVICE_DB_USER_PASSWORD`

**Prod:**

- `POSTGRES_SA_PASSWORD`
- `ACCOUNT_SERVICE_DB_USER_PASSWORD`
- `MESSAGING_SERVICE_DB_USER_PASSWORD`
- `PROPERTY_SERVICE_DB_USER_PASSWORD`

## Testing Checklist

Before deploying to production:

### Local Testing

- [ ] `kustomize build infra/k8s/hetzner/dev` succeeds
- [ ] `kustomize build infra/k8s/hetzner/test` succeeds
- [ ] `kustomize build infra/k8s/hetzner/prod` succeeds
- [ ] Generated manifests have correct environment-specific values
- [ ] `kubectl apply --dry-run=client` validates without errors

### Dev Cluster Testing

- [ ] Configure GitHub Secrets (dev only)
- [ ] Push change to `dev` branch
- [ ] Verify `hetzner-k8s.yml` workflow completes
- [ ] Verify `deploy-k8s-resources.yml` workflow completes
- [ ] Check PostgreSQL pod running: `kubectl get pods -l app=postgres`
- [ ] Verify databases created: `psql -h postgres-svc -U postgres_sa -l`
- [ ] Test service connectivity from another pod
- [ ] Update a config and verify in-place update (pod not recreated)

### Test Cluster Testing

- [ ] Set `auto_deploy: true` for test in `deploy-control.yaml`
- [ ] Configure GitHub Secrets (test)
- [ ] Push change to `test` branch
- [ ] Verify workflows complete
- [ ] Run same verification as dev

### Prod Deployment (Manual Trigger)

- [ ] **DO NOT** set `auto_deploy: true` for prod
- [ ] Configure GitHub Secrets (prod)
- [ ] Configure GitHub Environment protection rules
- [ ] Manually trigger `deploy-k8s-resources.yml` workflow
- [ ] Require manual approval
- [ ] Monitor rollout carefully
- [ ] Verify all replicas healthy
- [ ] Test failover (delete one pod, verify recovery)

## Rollback Plan

### Immediate Rollback

```bash
# Rollback to previous StatefulSet version
kubectl rollout undo statefulset/postgres

# Check rollback status
kubectl rollout status statefulset/postgres
```

### Disable Automated Deployments

1. Set `enabled: false` in `deploy-control.yaml` for affected environment
2. Push change to stop automated deployments
3. Investigate issue in dev environment
4. Fix and re-test before re-enabling

## Implementation Benefits

### Developer Experience

- **Clear file structure** - No ambiguity about file purpose or location
- **Environment parity** - Same base config, different patches
- **Local testing** - `kustomize build` without cluster access
- **Easy to add environments** - Copy overlay, change values

### Operations

- **GitOps architecture** - All infrastructure in Git
- **Automated deployments** - Push to branch triggers deployment
- **Deployment control** - Centralized flags for enable/disable
- **Change detection** - Only deploy affected environments
- **Rollout verification** - Automated health checks
- **Workflow coordination** - Cluster creation triggers resource deployment

### Security

- **Secrets management** - Stored in GitHub Secrets, never committed
- **Secret rotation** - Update GitHub Secret and redeploy
- **Environment isolation** - Separate clusters and secrets
- **Manual prod approval** - `auto_deploy: false` by default

### Reliability

- **Idempotent operations** - Safe to run repeatedly
- **In-place updates** - No cluster recreation required
- **Data persistence** - Retain policy on PVCs
- **Health probes** - Automated recovery via Kubernetes livenessProbe/readinessProbe
- **Rollback capability** - `kubectl rollout undo`
- **Server-side apply** - Better field ownership and conflict resolution
- **Error-driven immutability handling** - Graceful StatefulSet recreation on immutable field changes

### Error-Driven Kubernetes Resource Management

**Problem**: Multiple Kubernetes resource types have immutable fields that cannot be modified after creation:

- **StatefulSet**: volumeClaimTemplates, selector, podManagementPolicy
- **Deployment**: selector, strategy (when changing type)
- **Service**: clusterIP, type, ipFamilies
- **DaemonSet**: selector
- **Job**: selector, completions/parallelism (cannot decrease)

**Traditional Approaches** (what we DON'T do):

1. ❌ **Preemptive Deletion**: Delete all resources before every apply
   - **Problem**: Unnecessary pod recreations, false positives
   - **Example**: Changing only Redis config triggers PostgreSQL deletion
   - **Scalability**: Doesn't scale to multiple resource types (5+ patterns to check)

2. ❌ **Dry-Run Detection**: Check for conflicts before applying
   - **Problem**: Complex logic, race conditions, still causes false positives
   - **Maintenance**: Separate checks for each resource type

3. ❌ **Manual Intervention**: Let deployment fail, require human action
   - **Problem**: Not scalable, blocks automation

**Our Solution: Error-Driven Approach**

Let kubectl fail first, then handle the specific error across **all resource types**:

```bash
# 1. Try apply normally (fail fast)
if ! kubectl apply -f manifests.yaml 2>&1 | tee apply.log; then

  # 2. Detect which resource type has immutable field error
  RESOURCE_TYPE=""
  DELETE_ARGS=""

  if grep -q "Forbidden.*updates to statefulset spec.*are forbidden" apply.log; then
    RESOURCE_TYPE="statefulset"
    NAME_PATTERN='The StatefulSet "\K[^"]+'
    DELETE_ARGS="--cascade=orphan"
  elif grep -q "Forbidden.*updates to deployment spec.*are forbidden" apply.log; then
    RESOURCE_TYPE="deployment"
    NAME_PATTERN='The Deployment "\K[^"]+'
    DELETE_ARGS="--cascade=orphan"
  elif grep -qE "spec\.clusterIP.*immutable|spec\.type.*immutable" apply.log; then
    RESOURCE_TYPE="service"
    NAME_PATTERN='Service "\K[^"]+'
    DELETE_ARGS=""
  elif grep -q "Forbidden.*updates to daemonset spec.*are forbidden" apply.log; then
    RESOURCE_TYPE="daemonset"
    NAME_PATTERN='The DaemonSet "\K[^"]+'
    DELETE_ARGS="--cascade=orphan"
  elif grep -qE "spec\.selector.*immutable|spec\.completions.*cannot be decreased" apply.log; then
    RESOURCE_TYPE="job"
    NAME_PATTERN='Job "\K[^"]+'
    DELETE_ARGS=""
  fi

  if [ -n "$RESOURCE_TYPE" ]; then
    # 3. Extract ONLY the resource(s) that failed
    FAILED_RESOURCES=$(grep -oP "$NAME_PATTERN" apply.log)

    # 4. Delete ONLY those resources
    for res in $FAILED_RESOURCES; do
      kubectl delete "$RESOURCE_TYPE" "$res" $DELETE_ARGS
    done

    # 5. Retry deployment
    kubectl apply -f manifests.yaml
  fi
fi
```

**Benefits**:

- ✅ **No False Positives**: Only acts when kubectl actually fails with immutable field error
- ✅ **Multi-Resource Support**: Handles StatefulSet, Deployment, Service, DaemonSet, Job
- ✅ **Precise**: Extracts exact resource names from error message
- ✅ **Safe**: `--cascade=orphan` for stateful resources (preserves PVCs/Pods)
- ✅ **Extensible**: Easy to add new resource types (just add pattern)
- ✅ **Simple**: Pattern-based approach scales better than spec comparison
- ✅ **Kubernetes-Native**: Let kubectl validate, we handle errors
- ✅ **Future-Proof**: Works for any immutable field on any resource type

**Example Scenario**:

1. Developer changes PostgreSQL storage from 10Gi to 20Gi in `hetzner/dev/patches/`
2. Workflow builds manifests and tries `kubectl apply`
3. kubectl returns: `The StatefulSet "postgres" is invalid: spec: Forbidden: updates to statefulset spec for fields other than...`
4. Workflow detects immutable field error for StatefulSet resource type
5. Workflow extracts "postgres" from error message
6. Workflow deletes ONLY postgres StatefulSet with `--cascade=orphan` (redis-0 keeps running)
7. Workflow retries apply, PostgreSQL recreates with new 20Gi PVC
8. PostgreSQL pod reconnects to existing data (PVC persisted)
9. Redis pod never restarted (wasn't affected by the change)

**Applied To**:

- GitHub Actions: dev (L312), test (L636), prod (L983)
- Local: `tools/infra/kubectl-local-context.js`

## Next Features (Future Work)

### Namespaces

Namespace support can be added per environment:

```yaml
# infra/k8s/hetzner/dev/kustomization.yaml
namespace: real-estate-dev # 🆕 Isolate resources
```

### ArgoCD/FluxCD

Future migration to pull-based GitOps:

```yaml
# argocd-apps/postgres-dev.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: postgres-dev
spec:
  source:
    path: infra/k8s/hetzner/dev
    targetRevision: dev
  destination:
    namespace: real-estate-dev
```

### Monitoring & Alerts

Add observability stack:

- Prometheus for metrics
- Grafana for dashboards
- AlertManager for notifications
- PostgreSQL Exporter for database metrics

### Backup & Restore

Automated backup strategy:

- Velero for cluster backups
- pg_dump for database backups
- S3-compatible storage (Hetzner Object Storage)
- Automated restore testing

### Multi-Provider Support

Add AWS, GCP, Azure:

```
infra/k8s/
├── base/
├── hetzner/{dev,test,prod}/
├── aws/{dev,test,prod}/
└── gcp/{dev,test,prod}/
```

## Summary

This Kubernetes infrastructure provides:

- **Industry-proven patterns** - Kustomize overlays, GitOps, hierarchical control
- **Automated deployments** - GitHub Actions with change detection and workflow coordination
- **Environment-specific configs** - Dev/test/prod with appropriate resources
- **Safe deployment practices** - Manual approval for prod, rollout verification, server-side apply
- **Clear file structure** - Deterministic naming, provider/environment hierarchy
- **Production-ready operations** - Idempotent workflows, automated rollback, cluster readiness checks

The infrastructure is ready for deployment, with dev environment configured for auto-deployment and test/prod requiring manual approval.
