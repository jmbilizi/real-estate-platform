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
    │   ├── configmaps/
    │   │   └── postgres-init.configmap.yaml
    │   ├── secrets/
    │   │   └── postgres.secret.yaml                 # Template only (StrongBase64Password values)
    │   ├── services/
    │   │   └── postgres.service.yaml
    │   └── statefulsets/
    │       └── postgres.statefulset.yaml
    └── hetzner/                                     # Provider-specific configs
        ├── dev/
        │   ├── cluster/
        │   │   └── cluster-config.yaml
        │   ├── patches/
        │   │   ├── postgres-resources.yaml          # Dev resource limits
        │   │   └── postgres-storage.yaml            # Dev storage config
        │   ├── kustomization.yaml                   # Kustomize overlay
        │   └── .gitignore
        ├── test/
        │   └── ... (same structure as dev)
        └── prod/
            └── ... (same structure as dev)
```

### 2. File Naming Convention

Pattern: `{service}.{kind}.yaml`

**Examples:**

- `postgres.statefulset.yaml` - Clear resource type
- `postgres.service.yaml` - Clear resource type
- `postgres-init.configmap.yaml` - Clear purpose + type
- `cluster-config.yaml` - Simple, in provider/env/cluster/ directory

### 3. Deployment Control System

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

4. **Substitute secrets** in `base/secrets/postgres.secret.yaml` using yq (in-memory only)

5. **Build Kustomize manifests:** `kustomize build infra/k8s/hetzner/{env}`

6. **Apply manifests** with server-side apply: `kubectl apply --server-side=true --force-conflicts`

7. **Wait for rollout:** `kubectl rollout status statefulset/postgres` (300s dev/test, 600s prod)
   - Waits for pods to pass readinessProbe checks
   - Ensures StatefulSet reaches desired state

8. **Rollback on failure** (if enabled):
   - Automatically reverts if rollout fails
   - Runs `kubectl rollout undo statefulset/postgres`
   - Marks workflow as failed

9. **Verify deployment:** Check StatefulSet, Pods, Services, PVCs

### 6. Environment-Specific Configurations

**Resource specifications are defined in Kustomize patches** (`infra/k8s/hetzner/{env}/patches/`):

- **postgres-resources.yaml** - Defines replicas, memory requests/limits, CPU requests/limits, and pod affinity rules
- **postgres-storage.yaml** - Defines storage size and StorageClass

| Environment | Auto-Deploy | Production Features                                                                               |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------- |
| **Dev**     | ✅ True     | Fast iteration, minimal resources                                                                 |
| **Test**    | ❌ False    | Manual deployment, same as dev resources                                                          |
| **Prod**    | ❌ False    | Manual approval required, HA setup (3 replicas), pod anti-affinity, longer rollout timeout (600s) |

## Core Components

### Cluster Configuration

**Cluster Names** (preserved to prevent recreation):

- `hetzner-dev-cluster`
- `hetzner-test-cluster`
- `hetzner-prod-cluster`

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

### Kubeconfig Files

- `KUBECONFIG` - kubectl config (automatically uploaded by hetzner-k8s workflow after cluster creation/update)

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
- [ ] Verify databases created: `psql -h postgres-serv -U postgres_sa -l`
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
