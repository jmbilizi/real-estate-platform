# Kubernetes Operations Quick Reference

## Important Notes

### Network Configuration for Image Pulling

All Hetzner cluster configs allow all outbound traffic to ensure K3s can access required infrastructure:

- **All TCP outbound** (registries, GitHub releases, package repos)
- **All UDP outbound** (DNS, other services)
- **Registry Mirror**: Enabled for P2P image distribution between nodes

**CRITICAL**: Hetzner Cloud firewalls switch to deny-all when ANY outbound rule is defined. K3s requires access to multiple endpoints (not just registries), so we allow all outbound traffic per K3s recommendations.

If you experience image pull failures:

1. Verify firewall rules in `cluster-config.yaml` show `port: any`
2. Check node connectivity: `ssh root@<node-ip> curl -I https://registry-1.docker.io`
3. Check pod events: `kubectl describe pod <pod-name>`

## Daily Operations

### Local Development

```bash
# Test Kustomize build (base/secrets/postgres.secret.yaml contains StrongBase64Password values)
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins

# Preview changes (requires kubectl access)
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl diff -f -

# Build and inspect
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins > manifests.yaml
code manifests.yaml  # or: notepad manifests.yaml

# Note: Workflows substitute real secret values using yq before deploying
# Local builds will show StrongBase64Password values - this is expected
```

### Deployment Control

```yaml
# infra/deploy-control.yaml

# Enable environment
environments:
  dev:
    enabled: true        # ✅ Environment can be deployed
    auto_deploy: true    # ✅ Auto-deploy on push to dev branch

# Disable environment
environments:
  prod:
    enabled: false       # ❌ Completely disabled
    auto_deploy: false   # ❌ No auto-deploy
```

### Manual Deployment

```bash
# Using GitHub CLI
gh workflow run deploy-k8s-resources.yml -f environment=dev

# Or via GitHub web UI
# Actions → Deploy K8s Resources → Run workflow → Select environment
```

### Check Deployment Status

```bash
# Set kubeconfig
export KUBECONFIG=~/.kube/dev-config

# PostgreSQL Status
kubectl get statefulset postgres
kubectl get pods -l app=postgres
kubectl get services -l app=postgres
kubectl get pvc -l app=postgres

# PostgreSQL Details
kubectl describe statefulset postgres
kubectl logs postgres-0
kubectl exec postgres-0 -- psql -U postgres -c "SELECT version();"

# Redis Status
kubectl get statefulset redis
kubectl get pods -l app=redis
kubectl get services -l app=redis
kubectl get pvc -l app=redis

# Redis Details
kubectl describe statefulset redis
kubectl logs redis-0
kubectl exec redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" INFO server

# Jaeger Status
kubectl get statefulset jaeger
kubectl get pods -l app=jaeger
kubectl get services -l app=jaeger
kubectl get pvc -l app=jaeger

# Jaeger Details
kubectl describe statefulset jaeger
kubectl logs jaeger-0
kubectl exec jaeger-0 -- wget -qO- http://localhost:14269/

# Watch rollouts
kubectl rollout status statefulset/postgres -w
kubectl rollout status statefulset/redis -w
kubectl rollout status statefulset/jaeger -w
```

## Common Workflows

### Add New Environment

```bash
# 1. Copy existing environment
cp -r infra/k8s/hetzner/dev infra/k8s/hetzner/staging

# 2. Update kustomization.yaml
code infra/k8s/hetzner/staging/kustomization.yaml
# Change: commonLabels.environment: staging

# 3. Update patches (combined statefulset config)
code infra/k8s/hetzner/staging/patches/statefulsets/postgres.statefulset.yaml

# 4. Add to deploy-control.yaml
code infra/deploy-control.yaml
# Add staging section under environments:

# 5. Configure GitHub Secrets
# - STAGING_KUBECONFIG
# - STAGING_POSTGRES_SA_PASSWORD
# - STAGING_ACCOUNT_SERVICE_PASSWORD
# - STAGING_MESSAGING_SERVICE_PASSWORD
# - STAGING_PROPERTY_SERVICE_PASSWORD

# 6. Update workflows
code .github/workflows/deploy-k8s-resources.yml
# Add staging job (copy dev/test job, modify)
```

### Update PostgreSQL Version

```bash
# 1. Update base StatefulSet
code infra/k8s/base/statefulsets/postgres.statefulset.yaml
# Change image: postgis/postgis:18-3.4 → postgis/postgis:19-3.5

# 2. Test locally
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | grep "image:"

# 3. Deploy to dev
git checkout -b update/postgres-version
git add infra/k8s/base/statefulsets/postgres.statefulset.yaml
git commit -m "chore: update PostgreSQL to 19-3.5"
git push origin update/postgres-version

# 4. Create PR, verify build passes
gh pr create --base dev --title "Update PostgreSQL version"

# 5. Merge PR (auto-deploys to dev if auto_deploy: true)
gh pr merge --merge

# 6. Monitor rollout
kubectl rollout status statefulset/postgres -w

# 7. Verify version
kubectl exec postgres-0 -- psql -U postgres -c "SELECT version();"
```

### Change Resource Limits

```bash
# 1. Update environment-specific patch
code infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml

# Example: Increase dev memory
spec:
  template:
    spec:
      containers:
        - name: postgres
          resources:
            requests:
              memory: "1Gi"
              cpu: "1000m"
            limits:
              memory: "2Gi"
              cpu: "2000m"

# 2. Test build
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | grep -A 10 "resources:"

# 3. Commit and push
git add infra/k8s/hetzner/dev/patches/statefulsets/postgres.statefulset.yaml
git commit -m "chore(dev): increase PostgreSQL resources"
git push origin dev

# 4. Workflow auto-deploys (if auto_deploy: true)
# 5. Verify (StatefulSet updated, pods NOT recreated unless spec.template changed)
kubectl describe statefulset postgres | grep -A 5 "Limits:"
```

### Add Database User

```bash
# 1. Add password to GitHub Secrets (Environment-scoped)
# Settings → Environments → dev → Add secret
# Name: NEW_SERVICE_PASSWORD
# Value: <generated-password>
# Repeat for test and prod environments

# 2. Update init script
code infra/k8s/base/configmaps/postgres-init.configmap.yaml

# Add after existing service users:
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$DB_NAME" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'new_service_user') THEN
      CREATE USER new_service_user WITH PASSWORD '$NEW_SERVICE_PASSWORD';
      GRANT CONNECT ON DATABASE $DB_NAME TO new_service_user;
      -- Add more grants as needed
    END IF;
  END
  $$;
EOSQL

# 3. Add secret key to base/secrets/postgres.secret.yaml template
code infra/k8s/base/secrets/postgres.secret.yaml

# Add new line in stringData section:
  NEW_SERVICE_DB_USER_PASSWORD: "StrongBase64Password"

# 4. Update workflow to substitute new secret value
code .github/workflows/deploy-k8s-resources.yml

# In the "Substitute secrets in secret file" step, add new yq eval line (example for dev job):
yq eval '.stringData.NEW_SERVICE_DB_USER_PASSWORD = "${{ secrets.NEW_SERVICE_DB_USER_PASSWORD }}"' - |

# Repeat for test and prod jobs

# 5. Commit, push, deploy
```

### Rollback Deployment

```bash
# Method 1: Using kubectl rollout
kubectl rollout undo statefulset/postgres

# Method 2: Using Git
git checkout dev
git revert HEAD  # Revert last commit
git push origin dev  # Triggers redeploy

# Method 3: Manual workflow with old commit
gh workflow run deploy-k8s-resources.yml -f environment=dev -r <old-commit-sha>

# Verify rollback
kubectl get statefulset postgres -o wide
kubectl describe statefulset postgres | grep Image
```

### Understanding Kubernetes Immutable Fields

**Problem**: Multiple Kubernetes resource types have fields that cannot be modified after creation.

#### Resource Types with Immutable Fields

**1. StatefulSet**

- `spec.volumeClaimTemplates` - Storage size, StorageClass
- `spec.selector` - Label selectors
- `spec.podManagementPolicy` - Parallel vs OrderedReady
- **Error:** `Forbidden: updates to statefulset spec...are forbidden`

**2. Deployment**

- `spec.selector` - Label selectors
- `spec.strategy` - When changing between Recreate/RollingUpdate
- **Error:** `Forbidden: updates to deployment spec...are forbidden`

**3. Service**

- `spec.clusterIP` - Internal cluster IP
- `spec.type` - ClusterIP, NodePort, LoadBalancer
- `spec.ipFamilies` - IPv4/IPv6 configuration
- **Error:** `spec.clusterIP: immutable` or `spec.type: immutable`

**4. DaemonSet**

- `spec.selector` - Label selectors
- **Error:** `Forbidden: updates to daemonset spec...are forbidden`

**5. Job**

- `spec.selector` - Label selectors
- `spec.completions`, `spec.parallelism` - Cannot decrease
- **Error:** `spec.selector: immutable` or `spec.completions: cannot be decreased`

**Error Example**:

```
The StatefulSet "postgres" is invalid: spec: Forbidden:
updates to statefulset spec for fields other than 'replicas',
'template', 'updateStrategy', 'persistentVolumeClaimRetentionPolicy'
and 'minReadySeconds' are forbidden
```

**Workflow Solution (Error-Driven Approach)**:

The GitHub Actions workflow and local kubectl script use an error-driven pattern to handle immutable field changes across **all resource types**:

```bash
# 1. Try to apply normally first (fail fast)
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
    # 3. Extract ONLY the resources that failed
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

**Key Benefits**:

- ✅ **No false positives**: Only acts on actual kubectl errors
- ✅ **Multi-resource support**: Handles StatefulSet, Deployment, Service, DaemonSet, Job
- ✅ **Precise**: Only deletes resources that actually failed
- ✅ **Safe**: `--cascade=orphan` for stateful resources (preserves PVCs/Pods)
- ✅ **Extensible**: Easy to add new resource types
- ✅ **Simple**: Let kubectl tell us what's wrong (Kubernetes-native)

**Manual Handling** (if workflow is disabled):

```bash
# 1. Identify the immutable field change
kubectl apply -f manifests.yaml
# Error: The StatefulSet "postgres" is invalid: spec.volumeClaimTemplates...

# 2. Delete resource (use --cascade=orphan for stateful resources)
kubectl delete statefulset postgres --cascade=orphan

# 3. Recreate with new spec
kubectl apply -f manifests.yaml

# 4. For StatefulSets: Verify PVCs still exist
kubectl get pvc -l app=postgres

# 5. Watch pods reconnect to existing resources
kubectl get pods -l app=postgres -w
```

**Important Notes**:

- `--cascade=orphan` for StatefulSet/Deployment/DaemonSet preserves Pods and PVCs
- Services don't need `--cascade=orphan` (stateless)
- Jobs should complete/fail before modification
- No data loss - PVCs persist across StatefulSet recreation
  kubectl rollout status statefulset/postgres
  kubectl describe statefulset postgres | grep "Image:"

````

## Troubleshooting

### Build Fails Locally

```bash
# Error: "no such file or directory"
# Solution: Check all paths in kustomization.yaml are relative

# Error: "namespace not found"
# Solution: Remove namespace from patches (using default)

# Error: "StrongBase64Password value detected in deployed secret"
# Solution: Check workflow "Substitute secrets in secret file" step succeeded
# Verify GitHub Environment Secrets are configured correctly

# Error: "no 'apiVersion' field in postgres.secret.yaml"
# Solution: Ensure base/secrets/postgres.secret.yaml has valid YAML structure
# File must start with: apiVersion: v1, kind: Secret
````

### Deployment Fails

```bash
# Check workflow logs
gh run list --workflow=deploy-k8s-resources.yml
gh run view <run-id> --log

# Check deploy-control.yaml flags
yq '.environments.dev.enabled' infra/deploy-control.yaml
yq '.environments.dev.auto_deploy' infra/deploy-control.yaml

# Check GitHub Secrets configured
# Settings → Secrets → Actions
# Verify: KUBECONFIG, POSTGRES_SA_PASSWORD, ACCOUNT_SERVICE_DB_USER_PASSWORD, etc. exist per environment
```

### Pod Not Starting

```bash
# Check pod status
kubectl get pods -l app=postgres

# Check events
kubectl describe pod postgres-0

# Check logs
kubectl logs postgres-0
kubectl logs postgres-0 --previous  # If crashed

# Check PVC
kubectl get pvc -l app=postgres
kubectl describe pvc postgres-data-postgres-0

# Check secrets
kubectl get secret postgres-secret
kubectl get secret postgres-secret -o jsonpath='{.data.POSTGRES_SA_PASSWORD}' | base64 -d
```

### Database Connection Issues

```bash
# PostgreSQL Port-forward
kubectl port-forward postgres-0 5432:5432

# PostgreSQL Connection test
psql -h localhost -U postgres_sa -d postgres

# Or using kubectl exec
kubectl exec -it postgres-0 -- psql -U postgres_sa

# Check PostgreSQL service DNS
kubectl run -it --rm debug --image=postgres:16 --restart=Never -- \
  psql -h postgres-svc -U postgres_sa -c "SELECT version();"

# Redis Port-forward
kubectl port-forward redis-0 6379:6379

# Redis Connection test (requires password from secret)
redis-cli -h localhost --user admin --pass <password> PING

# Or using kubectl exec
kubectl exec -it redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" INFO

# Check Redis ACL users
kubectl exec -it redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" ACL LIST

# Test specific ACL user
kubectl exec -it redis-0 -- redis-cli --user cache_user --pass "$REDIS_CACHE_PASSWORD" PING

# Jaeger UI Port-forward
kubectl port-forward svc/jaeger-svc 16686:16686

# Access Jaeger UI
# Open browser: http://localhost:16686

# Jaeger Health Check
kubectl exec -it jaeger-0 -- wget -qO- http://localhost:14269/
```

### Redis ACL Operations

```bash
# List all Redis users
kubectl exec redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" ACL LIST

# Check user permissions
kubectl exec redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" ACL GETUSER pubsub_user

# Monitor Redis activity
kubectl exec -it redis-0 -- redis-cli --user monitor --pass "$REDIS_MONITOR_PASSWORD" MONITOR

# Check active connections
kubectl exec redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" CLIENT LIST

# View cache hit rate
kubectl exec redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" INFO stats

# Check memory usage
kubectl exec redis-0 -- redis-cli --user admin --pass "$REDIS_ADMIN_PASSWORD" INFO memory

# Test pub/sub
kubectl exec -it redis-0 -- redis-cli --user pubsub_user --pass "$REDIS_PUBSUB_PASSWORD" PUBLISH test:channel "hello"
```

### Storage Issues

```bash
# Check PVC status
kubectl get pvc -l app=postgres

# Check PV
kubectl get pv

# Check storage class
kubectl get storageclass hcloud-volumes

# Check CSI driver (Hetzner)
kubectl get pods -n kube-system | grep hcloud-csi

# Force delete stuck PVC (DANGER: data loss!)
kubectl delete pvc postgres-data-postgres-0 --force --grace-period=0
```

## Emergency Procedures

### Cluster Unresponsive

```bash
# Check cluster health
kubectl cluster-info
kubectl get nodes
kubectl get pods --all-namespaces

# Restart hetzner-k3s cluster (DANGER!)
hetzner-k3s delete --config infra/k8s/hetzner/dev/cluster/cluster-config.yaml
hetzner-k3s create --config infra/k8s/hetzner/dev/cluster/cluster-config.yaml

# Redeploy resources
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl apply -f -
```

### Data Corruption

```bash
# 1. Stop writes (scale down services using this database)
kubectl scale deployment <service> --replicas=0

# 2. Backup current state (even if corrupted)
kubectl exec postgres-0 -- pg_dumpall -U postgres > backup-corrupted.sql

# 3. Restore from last known good backup
kubectl exec -i postgres-0 -- psql -U postgres < backup-last-good.sql

# 4. Verify data
kubectl exec postgres-0 -- psql -U postgres -d account_db -c "SELECT COUNT(*) FROM <table>;"

# 5. Resume services
kubectl scale deployment <service> --replicas=3
```

### Accidental Deletion

```bash
# If StatefulSet deleted but PVC retained:
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl apply -f -
# StatefulSet recreated, mounts existing PVC, data intact!

# If PVC deleted:
# 1. Check if PV still exists with Retain policy
kubectl get pv | grep postgres
# 2. If PV exists, bind new PVC to it
# 3. If PV gone, restore from backup (see Data Corruption)
```

## Monitoring Commands

```bash
# Watch pod status
watch kubectl get pods -l app=postgres

# Watch events
kubectl get events --sort-by='.lastTimestamp' -w

# Check resource usage
kubectl top pods -l app=postgres
kubectl top nodes

# Get all resources
kubectl get all -l app=postgres

# Describe everything
kubectl describe statefulset postgres
kubectl describe service postgres-svc
kubectl describe configmap postgres-init-script
```

## Useful Aliases

```bash
# Add to ~/.bashrc or ~/.zshrc

alias k="kubectl"
alias kgp="kubectl get pods"
alias kgs="kubectl get services"
alias kgss="kubectl get statefulsets"
alias kd="kubectl describe"
alias kl="kubectl logs"
alias kx="kubectl exec -it"
alias kpf="kubectl port-forward"

# PostgreSQL specific
alias pgdev="export KUBECONFIG=~/.kube/dev-config"
alias pgtest="export KUBECONFIG=~/.kube/test-config"
alias pgprod="export KUBECONFIG=~/.kube/prod-config"
alias pgpsql="kubectl exec -it postgres-0 -- psql -U postgres"
alias pgwatch="watch kubectl get pods -l app=postgres"
```

## Quick Checks

```bash
# Is PostgreSQL healthy?
kubectl get pods -l app=postgres -o wide | grep Running

# Are services accessible?
kubectl get svc postgres-svc postgres-hl

# Is storage bound?
kubectl get pvc -l app=postgres | grep Bound

# What version is running?
kubectl get statefulset postgres -o jsonpath='{.spec.template.spec.containers[0].image}'

# How many replicas?
kubectl get statefulset postgres -o jsonpath='{.spec.replicas}'

# When was last deployment?
kubectl rollout history statefulset/postgres
```

## Useful Links

- **Kustomize Docs**: https://kubectl.docs.kubernetes.io/references/kustomize/
- **kubectl Cheat Sheet**: https://kubernetes.io/docs/reference/kubectl/cheatsheet/
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **Hetzner K3s**: https://github.com/vitobotta/hetzner-k3s
- **GitHub Actions**: https://docs.github.com/en/actions

## Getting Help

```bash
# Kustomize help
kustomize build --help

# kubectl help
kubectl --help
kubectl get --help
kubectl describe --help

# Check versions
kustomize version
kubectl version
```
