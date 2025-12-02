# Kubernetes Operations Quick Reference

## Important Notes

### Network Configuration for Image Pulling

All Hetzner cluster configs now include custom firewall rules to ensure nodes can pull images from public registries:

- **DNS**: Outbound UDP port 53 (required for resolving registry hostnames)
- **HTTPS**: Outbound TCP port 443 (primary registry access)
- **HTTP**: Outbound TCP port 80 (fallback registry access)
- **Registry Mirror**: Enabled for P2P image distribution between nodes

**CRITICAL**: These outbound rules are required because Hetzner Cloud firewalls switch to deny-all when ANY outbound rule is defined. Without these rules, nodes cannot pull container images.

If you experience image pull failures:

1. Verify firewall rules in `cluster-config.yaml`
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

# Quick status
kubectl get statefulset postgres
kubectl get pods -l app=postgres
kubectl get services -l app=postgres
kubectl get pvc -l app=postgres

# Detailed status
kubectl describe statefulset postgres
kubectl logs postgres-0
kubectl exec postgres-0 -- psql -U postgres -c "SELECT version();"

# Watch rollout
kubectl rollout status statefulset/postgres -w
```

## Common Workflows

### Add New Environment

```bash
# 1. Copy existing environment
cp -r infra/k8s/hetzner/dev infra/k8s/hetzner/staging

# 2. Update kustomization.yaml
code infra/k8s/hetzner/staging/kustomization.yaml
# Change: commonLabels.environment: staging

# 3. Update patches (resources, storage)
code infra/k8s/hetzner/staging/patches/postgres-resources.yaml
code infra/k8s/hetzner/staging/patches/postgres-storage.yaml

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
code infra/k8s/hetzner/dev/patches/postgres-resources.yaml

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
git add infra/k8s/hetzner/dev/patches/postgres-resources.yaml
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
kubectl rollout status statefulset/postgres
kubectl describe statefulset postgres | grep "Image:"
```

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
```

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
# Port-forward to local machine
kubectl port-forward postgres-0 5432:5432

# Test connection
psql -h localhost -U postgres_sa -d postgres

# Or using kubectl exec
kubectl exec -it postgres-0 -- psql -U postgres_sa

# Check service DNS
kubectl run -it --rm debug --image=postgres:16 --restart=Never -- \
  psql -h postgres-serv -U postgres_sa -c "SELECT version();"
```

### Storage Issues

```bash
# Check PVC status
kubectl get pvc -l app=postgres

# Check PV
kubectl get pv

# Check storage class
kubectl get storageclass hcloud-postgres-storage

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
kubectl describe service postgres-serv
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
kubectl get svc postgres-serv postgres-hl

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
