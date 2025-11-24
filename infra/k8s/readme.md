# Kubernetes Infrastructure Documentation Index

## 📚 Documentation Overview

This directory contains comprehensive documentation for the Kubernetes infrastructure, including GitOps workflows, deployment procedures, and operational guides.

## 🗺️ Documentation Map

### Getting Started

1. **[IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)** - Start here!
   - Complete overview of the infrastructure migration
   - Architecture decisions and rationale
   - Directory structure explanation
   - Deployment control system
   - GitHub Actions workflows
   - Required secrets and configuration
   - **Who should read**: Everyone (managers, developers, ops)
   - **When to read**: Before working with this infrastructure

### Daily Operations

2. **[OPERATIONS.md](./OPERATIONS.md)** - Quick reference
   - Common commands and workflows
   - Troubleshooting procedures
   - Emergency procedures
   - Useful aliases and shortcuts
   - **Who should read**: Developers, ops engineers
   - **When to read**: Daily operations, troubleshooting

3. **[TESTING.md](./TESTING.md)** - Testing guide
   - Local testing (no cluster required)
   - Cluster testing procedures
   - GitHub Actions testing
   - Validation checklists
   - **Who should read**: QA engineers, developers
   - **When to read**: Before deploying changes, during CI/CD setup

### Configuration References

4. **[../deploy-control.yaml](../deploy-control.yaml)** - Deployment control
   - **Most deployment controls are actively enforced by workflows**
   - Environment gates: `enabled`, `auto_deploy` (enforced), `require_manual_approval` (not yet enforced)
   - Deployment windows: Time/day-based restrictions (enforced)
   - Service controls: Per-service enable/disable (enforced), approval requirements (not yet enforced)
   - Rollback: Automatic revert on rollout failure (enforced)
   - **Manual approval**: Configure via GitHub Environments (Settings → Environments → {env} → Required reviewers)
   - **Health validation handled by Kubernetes probes** (livenessProbe, readinessProbe in StatefulSet)
   - **All environments have identical structure** (different values)
   - **Who should read**: DevOps engineers, release managers
   - **When to read**: When configuring deployment policies or troubleshooting deployments

5. **Directory Structure Reference**
   - `base/` - Shared configurations (see below)
   - `hetzner/` - Provider-specific overlays (see below)
   - `.github/workflows/` - CI/CD pipelines (see below)

## 📂 Directory Structure

```
infra/
├── deploy-control.yaml              # Centralized deployment control
└── k8s/
    ├── README.md                    # 📑 This file - documentation index
    ├── IMPLEMENTATION-SUMMARY.md    # 📖 Complete overview (read first!)
    ├── OPERATIONS.md                # 🚀 Daily operations guide
    ├── TESTING.md                   # ✅ Testing procedures
    │
    ├── base/                        # Shared base configurations
    │   ├── configmaps/
    │   │   └── postgres-init.configmap.yaml
    │   ├── secrets/
    │   │   └── postgres.secret.yaml         # Secret template with StrongBase64Password placeholder
    │   ├── services/
    │   │   └── postgres.service.yaml
    │   └── statefulsets/
    │       └── postgres.statefulset.yaml
    │
    └── hetzner/                     # Hetzner Cloud provider
        ├── dev/                     # Development environment
        │   ├── cluster/
        │   │   └── cluster-config.yaml      # hetzner-k3s cluster config
        │   ├── patches/
        │   │   ├── postgres-resources.yaml  # Dev resource limits
        │   │   └── postgres-storage.yaml    # Dev storage config
        │   ├── kustomization.yaml           # Kustomize overlay
        │   └── .gitignore
        │
        ├── test/                    # Test environment
        │   └── ... (same structure as dev)
        │
        └── prod/                    # Production environment
            └── ... (same structure as dev)
```

## 🔄 Workflows

### GitHub Actions

Located in `.github/workflows/`:

1. **[hetzner-k8s.yml](../../.github/workflows/hetzner-k8s.yml)**
   - Purpose: Create/update Kubernetes clusters
   - Triggers: Push to main/test/dev, cluster config changes
   - Reads: `cluster-config.yaml`, `deploy-control.yaml`
   - Actions: Install hetzner-k3s, provision/update clusters

2. **[deploy-k8s-resources.yml](../../.github/workflows/deploy-k8s-resources.yml)**
   - Purpose: Deploy K8s resources using Kustomize
   - Triggers: Push to main/test/dev, K8s config changes
   - Reads: `deploy-control.yaml`, Kustomize overlays
   - Actions: Build manifests, deploy with kubectl, verify rollout

## 🎯 Use Cases & Reading Paths

### "I need to deploy a change to dev"

1. Read: [OPERATIONS.md](./OPERATIONS.md) → "Daily Operations"
2. Modify config files in `base/` or `hetzner/dev/`
3. Push to `dev` branch
4. Monitor: GitHub Actions workflow execution

### "I'm setting up this infrastructure for the first time"

1. Read: [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Full context
2. Configure: GitHub Secrets (see Required Secrets below)
3. Test: Follow [TESTING.md](./TESTING.md) - Local testing
4. Deploy: Push to `dev` branch

### "Something is broken in production"

1. Check: [OPERATIONS.md](./OPERATIONS.md) → "Troubleshooting"
2. Run diagnostics:
   ```bash
   kubectl get pods -l app=postgres
   kubectl logs postgres-0
   kubectl describe statefulset postgres
   ```
3. If needed: [OPERATIONS.md](./OPERATIONS.md) → "Emergency Procedures"
4. Rollback: [OPERATIONS.md](./OPERATIONS.md) → "Rollback Deployment"

### "I need to add a new environment (staging)"

1. Read: [OPERATIONS.md](./OPERATIONS.md) → "Add New Environment"
2. Copy `hetzner/dev/` to `hetzner/staging/`
3. Update `deploy-control.yaml`
4. Configure GitHub Secrets
5. Update workflows (copy dev/test job)
6. Test: [TESTING.md](./TESTING.md)

### "I need to update PostgreSQL version"

1. Read: [OPERATIONS.md](./OPERATIONS.md) → "Update PostgreSQL Version"
2. Modify `base/statefulsets/postgres.statefulset.yaml`
3. Test locally: `kustomize build infra/k8s/hetzner/dev`
4. Create PR → Merge to dev → Monitor rollout

### "I want to understand the architecture decisions"

1. Read: [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) → "What Changed"
2. Read: [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) → "Benefits Achieved"
3. Compare: Old vs new directory structure
4. Understand: Kustomize overlay pattern

## 🔐 Required GitHub Secrets

Configure in: Repository Settings → Secrets and variables → Actions

### Hetzner Cloud

- `HETZNER_TOKEN` - API token for cluster provisioning
- `HETZNER_SSH_PRIVATE_KEY` - SSH key for cluster nodes
- `HETZNER_SSH_PUBLIC_KEY` - SSH public key

### Kubeconfig Files (Repository Secrets)

- `DEV_KUBECONFIG` - Dev cluster kubectl config (auto-uploaded by hetzner-k8s workflow)
- `TEST_KUBECONFIG` - Test cluster kubectl config (auto-uploaded by hetzner-k8s workflow)
- `PROD_KUBECONFIG` - Prod cluster kubectl config (auto-uploaded by hetzner-k8s workflow)

**Note**: Uses repository secrets with environment prefixes because `github.token` can write repository secrets but not environment secrets (requires admin permissions).

### PostgreSQL Passwords (per environment)

**All environments (dev, test, prod):** `POSTGRES_SA_PASSWORD`, `ACCOUNT_SERVICE_DB_USER_PASSWORD`, `MESSAGING_SERVICE_DB_USER_PASSWORD`, `PROPERTY_SERVICE_DB_USER_PASSWORD`

**Note:** Each environment has its own set of these secrets (scoped to the environment).

## 🛠️ Tools Required

### Local Development

- **Kustomize**: https://kubectl.docs.kubernetes.io/installation/kustomize/
- **kubectl**: https://kubernetes.io/docs/tasks/tools/
- **yq**: https://github.com/mikefarah/yq
- **Git**: Version control

### Optional (for enhanced workflow)

- **GitHub CLI**: https://cli.github.com/
- **PostgreSQL client**: For database testing
- **hetzner-k3s**: For cluster management

## 📊 Environment Matrix

| Environment | Branch | Auto-Deploy | Purpose             |
| ----------- | ------ | ----------- | ------------------- |
| **Dev**     | dev    | ✅ Yes      | Daily development   |
| **Test**    | test   | ❌ No       | Integration testing |
| **Prod**    | main   | ❌ No       | Production workload |

**Resource Specifications**: See environment-specific patches in `hetzner/{env}/patches/`:

- `postgres-resources.yaml` - Replicas, memory, CPU limits
- `postgres-storage.yaml` - Storage size and StorageClass

## 🔍 Quick Lookups

### Find Configuration

| What                         | Where                                          |
| ---------------------------- | ---------------------------------------------- |
| Deployment flags             | `infra/deploy-control.yaml`                    |
| PostgreSQL image version     | `base/statefulsets/postgres.statefulset.yaml`  |
| Init script (database setup) | `base/configmaps/postgres-init.configmap.yaml` |
| Dev resource limits          | `hetzner/dev/patches/postgres-resources.yaml`  |
| Prod storage size            | `hetzner/prod/patches/postgres-storage.yaml`   |
| Cluster config (dev)         | `hetzner/dev/cluster/cluster-config.yaml`      |
| Service configuration        | `base/services/postgres.service.yaml`          |
| GitHub Secrets required      | See "Required Secrets" section above           |

### Find Workflows

| Workflow             | Location                                     | Purpose                    |
| -------------------- | -------------------------------------------- | -------------------------- |
| Cluster provisioning | `.github/workflows/hetzner-k8s.yml`          | Create/update K8s clusters |
| Resource deployment  | `.github/workflows/deploy-k8s-resources.yml` | Deploy K8s resources       |

### Find Documentation

| Topic                  | Document                  | Section                     |
| ---------------------- | ------------------------- | --------------------------- |
| Architecture overview  | IMPLEMENTATION-SUMMARY.md | "What Changed"              |
| Daily commands         | OPERATIONS.md             | "Daily Operations"          |
| Troubleshooting        | OPERATIONS.md             | "Troubleshooting"           |
| Testing procedures     | TESTING.md                | "Local Testing"             |
| Rollback procedures    | OPERATIONS.md             | "Rollback Deployment"       |
| Adding new environment | OPERATIONS.md             | "Add New Environment"       |
| Updating PostgreSQL    | OPERATIONS.md             | "Update PostgreSQL Version" |
| Emergency procedures   | OPERATIONS.md             | "Emergency Procedures"      |

## 🎓 Learning Path

### For New Team Members

1. **Day 1**: Read [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)
   - Understand architecture
   - Learn directory structure
   - Understand deployment control

2. **Day 2**: Follow [TESTING.md](./TESTING.md)
   - Install required tools
   - Test Kustomize builds locally
   - Deploy to dev cluster

3. **Day 3**: Bookmark [OPERATIONS.md](./OPERATIONS.md)
   - Familiarize with common commands
   - Try troubleshooting scenarios
   - Practice rollback procedures

4. **Ongoing**: Reference [OPERATIONS.md](./OPERATIONS.md)
   - Daily operations
   - Troubleshooting when issues arise

### For DevOps Engineers

1. Read all documentation in order:
   - IMPLEMENTATION-SUMMARY.md → TESTING.md → OPERATIONS.md

2. Configure development environment:
   - Install tools (Kustomize, kubectl, yq)
   - Clone repository
   - Test local builds

3. Practice workflows:
   - Local testing
   - Deploying to dev
   - Updating configurations
   - Rollback procedures

4. Set up automation:
   - Configure GitHub Secrets
   - Test workflows
   - Monitor deployments

## 📞 Support

### Issue Escalation

1. **Level 1** (Self-service):
   - Check [OPERATIONS.md](./OPERATIONS.md) → Troubleshooting
   - Review workflow logs in GitHub Actions
   - Check kubectl logs: `kubectl logs postgres-0`

2. **Level 2** (Team support):
   - Post in team Slack channel
   - Create GitHub Issue with:
     - Environment (dev/test/prod)
     - Error message
     - Steps to reproduce
     - kubectl describe output

3. **Level 3** (Emergency):
   - Contact on-call engineer
   - Reference [OPERATIONS.md](./OPERATIONS.md) → Emergency Procedures
   - Prepare: cluster logs, event timeline, impact assessment

### Contributing

When updating documentation:

1. Keep README.md (this file) as the index
2. Update specific guides (IMPLEMENTATION-SUMMARY.md, OPERATIONS.md, etc.)
3. Add new use cases to "Use Cases & Reading Paths"
4. Update "Quick Lookups" tables if configuration locations change
5. Test all commands before documenting

## 🔄 Versioning

- **deploy-control.yaml**: v3.0.0
- **Documentation**: Updated 2024 (current)
- **Kustomize**: v1beta1 (apiVersion in kustomization.yaml)

## ✅ Verification Checklist

Before declaring setup complete:

- [ ] All documentation read and understood
- [ ] Required tools installed (Kustomize, kubectl, yq)
- [ ] GitHub Secrets configured (see Required Secrets)
- [ ] Local Kustomize builds successful
- [ ] Dev deployment tested and verified
- [ ] Team trained on new workflows
- [ ] Rollback procedures tested
- [ ] Monitoring in place
- [ ] Old infrastructure documented for reference

## 📅 Maintenance Schedule

- **Weekly**: Review workflow logs, check for failed deployments
- **Monthly**: Review and rotate secrets
- **Quarterly**: Update PostgreSQL version, review resource limits
- **Annually**: Review architecture, consider migrations (ArgoCD, FluxCD)

---

**Last Updated**: 2024
**Maintained By**: Infrastructure Team
**Questions?**: See "Support" section above
