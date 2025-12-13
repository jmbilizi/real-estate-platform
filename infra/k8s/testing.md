# Kubernetes Infrastructure Testing Guide

This guide covers testing the new Kustomize-based Kubernetes infrastructure locally before deploying to clusters.

## Prerequisites

- **Kustomize**: Run `npm run infra:setup` (auto-installs and configures PATH)
- **kubectl**: Optional - for dry-run validation (install from https://kubernetes.io/docs/tasks/tools/)
- **Access to dev cluster**: Kubeconfig file for hetzner-dev-cluster (for cluster testing only)

## Local Testing (No Cluster Required)

### 1. Quick Validation (Recommended)

Use the automated validation script:

```bash
# Validate all environments
npm run infra:validate

# Validate specific environment
npm run infra:validate:dev
npm run infra:validate:test
npm run infra:validate:prod
```

**Expected Result**: All environments show `✓ PASSED`

### 2. Manual Kustomize Build (Alternative)

Test Kustomize builds manually if needed:

```bash
# Dev environment
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins

# Test environment
kustomize build infra/k8s/hetzner/test --enable-alpha-plugins

# Prod environment
kustomize build infra/k8s/hetzner/prod --enable-alpha-plugins
```

**Expected Result**: No errors, YAML manifests printed to stdout

**Common Issues**:

- Invalid YAML syntax: Check base files and patches
- Missing base resources: Ensure all files referenced in `kustomization.yaml` exist
- StrongBase64Password values in output: Expected - workflows substitute real secrets before deployment

### 3. Inspect Generated Manifests

Save and inspect the generated manifests:

```bash
# Build dev manifests to file
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins > dev-manifests.yaml

# Check for expected values
grep -A 5 "kind: StatefulSet" dev-manifests.yaml
grep -A 5 "resources:" dev-manifests.yaml
grep "replicas:" dev-manifests.yaml
grep "storage:" dev-manifests.yaml

# Note: Secret values will show "StrongBase64Password" - workflows substitute real values before deployment
grep -A 5 "kind: Secret" dev-manifests.yaml
```

**Verify**:

- ✅ Environment-specific resource and storage specs applied (check `hetzner/{env}/patches/statefulsets/postgres.statefulset.yaml`)
- ✅ Labels: `environment: dev/test/prod`, `provider: hetzner`
- ✅ Secrets: Base64 encoded passwords (not StrongBase64Password)

### 4. Validate YAML Syntax

Use `kubectl` to validate without applying:

```bash
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl apply --dry-run=client -f -
```

**Expected Result**: `<resource> created (dry run)`

## Cluster Testing (Requires kubectl Access)

### 1. Configure kubectl

Get kubeconfig from dev cluster:

```bash
# Using hetzner-k3s CLI
hetzner-k3s kubeconfig --config infra/k8s/hetzner/dev/cluster/cluster-config.yaml > ~/.kube/dev-config

# Set context
export KUBECONFIG=~/.kube/dev-config
kubectl cluster-info
```

### 2. Dry-Run Apply

Test deployment without actually creating resources:

```bash
# Dry-run apply (secret file contains StrongBase64Password placeholder)
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl apply --dry-run=server -f -
```

**Expected Result**: No errors, resources validated by Kubernetes API server

### 3. Deploy to Dev Cluster

**IMPORTANT**: This will actually deploy PostgreSQL!

```bash
# Apply manifests
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl apply -f -

# Watch rollout
kubectl rollout status statefulset/postgres --timeout=300s
```

**Monitor**:

```bash
# Watch pod status
kubectl get pods -l app=postgres -w

# Check logs
kubectl logs postgres-0

# Check events
kubectl get events --sort-by='.lastTimestamp'
```

### 4. Verify Deployment

Check all resources created successfully:

```bash
# StatefulSet
kubectl get statefulset postgres -o wide

# Pods
kubectl get pods -l app=postgres

# Services
kubectl get services -l app=postgres

# PersistentVolumeClaims
kubectl get pvc -l app=postgres

# ConfigMaps
kubectl get configmap postgres-config

# Secrets
kubectl get secret postgres-secret
```

**Expected Resources**:

- 1 StatefulSet: `postgres`
- 1 Pod: `postgres-0` (Running)
- 2 Services: `postgres-hl` (headless), `postgres-svc` (ClusterIP)
- 1 PVC: `postgres-data-postgres-0` (Bound)
- 1 ConfigMap: `postgres-config`
- 1 Secret: `postgres-secret`

### 5. Test Database Initialization

Connect to PostgreSQL and verify databases:

```bash
# Port-forward to local machine
kubectl port-forward postgres-0 5432:5432 &

# Connect using psql (requires PostgreSQL client)
PGPASSWORD=$(kubectl get secret postgres-secret -o jsonpath='{.data.POSTGRES_SA_PASSWORD}' | base64 -d) \
psql -h localhost -U postgres_sa -d postgres

# Inside psql:
\l                           # List databases
\c account_db                # Connect to account_db
\dn                          # List schemas
\dt reference.*              # List tables in reference schema
SELECT * FROM pg_extension;  # Check extensions
\q                           # Quit
```

**Expected Databases**:

- `postgres` (default)
- `account_db` (with schemas: reference, config, audit)
- `messaging_db` (with schemas: reference, config, audit)
- `property_db` (with schemas: reference, config, audit)
- `appdb` (shared utility database)

**Expected Extensions** (in each database):

- `uuid-ossp`
- `postgis`
- `pg_trgm`

### 6. Test Service Connectivity

Test internal cluster DNS:

```bash
# Create temporary pod
kubectl run -it --rm debug --image=postgres:16 --restart=Never -- bash

# Inside pod:
psql -h postgres-svc -U postgres -c "SELECT version();"
psql -h postgres-hl -U postgres -c "SELECT version();"
exit
```

**Expected Result**: Both services respond with PostgreSQL version

### 7. Update Test (In-Place Update)

Modify a configuration and verify update doesn't recreate cluster:

```bash
# Before: Note the pod age
kubectl get pods postgres-0

# Modify a label in base/statefulsets/postgres.statefulset.yaml
# Add a new label: test-update: "true"

# Re-apply
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl apply -f -

# After: Check pod wasn't recreated (age should be same)
kubectl get pods postgres-0

# Verify cluster_name preserved
kubectl exec postgres-0 -- hostname
# Should still be: postgres-0.postgres-hl.default.svc.cluster.local
```

**Expected Behavior**:

- ✅ StatefulSet updated
- ✅ Pod NOT recreated (unless spec.template changed)
- ✅ PVC retained (retain policy)
- ✅ Data preserved

## Rollback Testing

Test rollback capability:

```bash
# Get rollout history
kubectl rollout history statefulset/postgres

# Rollback to previous version
kubectl rollout undo statefulset/postgres

# Check status
kubectl rollout status statefulset/postgres
```

## Cleanup (Dev Cluster Only!)

**DANGER**: This will delete all data!

```bash
# Delete all resources
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl delete -f -

# Verify cleanup
kubectl get all -l app=postgres
kubectl get pvc -l app=postgres

# Force delete PVC if stuck (CAUTION!)
kubectl delete pvc postgres-data-postgres-0 --force --grace-period=0
```

## GitHub Actions Testing

### 1. Test PR Validation

Create a test PR modifying any K8s file:

```bash
git checkout -b test/kustomize-validation
# Make a change to infra/k8s/base/statefulsets/postgres.statefulset.yaml
git commit -am "test: validate Kustomize build"
git push origin test/kustomize-validation
```

**Expected**: PR workflow runs, validates Kustomize builds for all environments

### 2. Test Deployment Workflow (Manual Trigger)

Trigger deployment workflow manually:

1. Go to GitHub Actions → "Deploy K8s Resources"
2. Click "Run workflow"
3. Select environment: `dev`
4. Click "Run workflow"

**Expected**:

- ✅ Workflow reads deploy-control.yaml
- ✅ Checks if dev enabled and auto_deploy true
- ✅ Builds Kustomize manifests
- ✅ Deploys to dev cluster
- ✅ Waits for rollout completion

### 3. Monitor Workflow

Watch workflow execution:

```bash
# Using GitHub CLI
gh run watch

# Or open in browser
gh run view --web
```

## Troubleshooting

### Kustomize Build Fails

**Error**: `accumulating resources: accumulation err='accumulating resources from '../../base/secrets/postgres.secret.yaml': security; file '...' is not in or below '...'`: must build at directory`

**Root Cause**: Overlay kustomization.yaml referenced individual files (`../../base/secrets/postgres.secret.yaml`) instead of the base directory (`../../base`)

**Solution**:

1. Ensure `base/kustomization.yaml` exists and lists all resources
2. Change overlay resources to reference base directory: `resources: [../../base]`
3. This is required by Kustomize security model - overlays must reference directories containing kustomization.yaml

---

**Error**: `Warning: 'commonLabels' is deprecated. Please use 'labels' instead`

**Solution**: Replace deprecated syntax with modern equivalents:

```yaml
# Old (deprecated)
commonLabels:
  environment: dev

# New (modern)
labels:
  - pairs:
      environment: dev
```

---

**Error**: `Warning: 'patchesStrategicMerge' is deprecated. Please use 'patches' instead`

**Solution**: Replace deprecated syntax with modern equivalents:

```yaml
# Old (deprecated)
patchesStrategicMerge:
  - patches/statefulsets/postgres.statefulset.yaml

# New (modern)
patches:
  - path: patches/statefulsets/postgres.statefulset.yaml
```

---

**Error**: `accumulating resources: accumulation err='accumulating resources from '...': evalsymlink failure`

**Solution**: Check all paths in `kustomization.yaml` are relative and files exist

---

**Error**: `no 'apiVersion' field in postgres.secret.yaml`

**Solution**: Ensure `base/secrets/postgres.secret.yaml` is valid YAML with apiVersion: v1, kind: Secret

---

**Error**: `namespace not found`

**Solution**: We're using `default` namespace. Remove namespace overrides from patches.

### Deployment Fails

**Error**: `PersistentVolumeClaim is pending`

**Solution**: Check Hetzner CSI driver installed:

```bash
kubectl get pods -n kube-system | grep hcloud-csi
```

---

**Error**: `Pod stuck in Init:0/1`

**Solution**: Check init script logs:

```bash
kubectl logs postgres-0 -c init-postgres
```

---

**Error**: `Secret not found`

**Solution**: Verify `base/secrets/postgres.secret.yaml` exists and is included in kustomization.yaml resources

### GitHub Actions Fails

**Error**: `yq: command not found`

**Solution**: Workflow installs yq automatically. Check step passed successfully.

---

**Error**: `KUBECONFIG not set`

**Solution**: Ensure GitHub secrets configured:

- `KUBECONFIG` (auto-created by hetzner-k8s workflow)

---

**Error**: `StrongBase64Password value detected in deployed secret`

**Solution**: Workflow substitution failed. Check "Substitute secrets in secret file" step passed.

## Success Criteria

✅ **Local Testing**:

- Kustomize builds successfully for all environments
- Generated manifests have correct environment-specific values
- No validation errors from kubectl dry-run

✅ **Cluster Testing**:

- PostgreSQL deploys successfully
- All 4 databases created with correct schemas
- All extensions installed
- Redis deploys successfully with ACL users configured
- Jaeger deploys successfully with OTLP endpoints active
- Services accessible via DNS
- PVC bound and storage available
- In-place updates work (pod not recreated)

✅ **CI/CD Testing**:

- PR validation catches syntax errors
- Push to dev/test/main triggers appropriate deployments
- deploy-control.yaml flags respected
- Rollout completes successfully
- Verification steps pass

## Next Steps

After successful testing:

1. ✅ **Verify prod config** (don't deploy yet!)
2. ✅ **Configure GitHub secrets** (real passwords!)
3. ✅ **Delete old infrastructure** (after confirming new works)
4. ✅ **Update documentation** (link to new paths)
5. ✅ **Train team** (new workflow patterns)
