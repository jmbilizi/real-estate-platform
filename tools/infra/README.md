# Infrastructure Development Tools

Automated tooling for Kubernetes infrastructure development and validation.

**Multi-Cloud Ready**: Automatically detects and validates all cloud providers in `infra/k8s/` (Hetzner, AWS, GCP, Azure, etc.)

## Quick Start

```bash
# One-time setup (installs Kustomize + adds to PATH)
npm run infra:setup

# Validate all environments
npm run infra:validate
```

## Tools Installed

### Kustomize (Required)

- **Purpose**: Kubernetes manifest templating and validation
- **Auto-installed**: Yes (Windows/Linux/macOS)
- **PATH**: Automatically configured
- **Location**: `~/.local/bin/kustomize`

### kubectl (Optional)

- **Purpose**: Kubernetes CLI for advanced validation
- **Auto-installed**: No (install manually if needed)
- **Used for**: Dry-run validation against live clusters

## Available Commands

```bash
# Validate all providers and environments (auto-discovery)
npm run infra:validate

# Validate specific environment across all providers
npm run infra:validate:dev
npm run infra:validate:test
npm run infra:validate:prod

# Build manifests manually (replace {provider} and {env})
kustomize build infra/k8s/{provider}/{env} --enable-alpha-plugins

# Examples:
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins
kustomize build infra/k8s/aws/prod --enable-alpha-plugins
```

## Git Hook Integration

Automatically validates infrastructure changes:

- **Triggers**: When `infra/k8s/**/*.yaml` files are staged
- **Pre-commit**: Validates all environments (~5-10s)
- **Pre-push**: Safety net if pre-commit bypassed
- **Graceful**: Skips with warning if Kustomize not installed

**Setup**: Run `npm run hooks:setup` (includes all git hooks)

## How It Works

1. **First-time setup**: `npm run infra:setup`
   - Downloads Kustomize binary for your OS
   - Installs to `~/.local/bin`
   - Adds to PATH permanently
   - Refreshes current session (no restart needed)

2. **Subsequent runs**: Idempotent
   - Detects existing installation
   - Skips download if already installed
   - Won't add duplicate PATH entries

3. **Validation**: Automatic via git hooks or manual
   - Git hooks run on commit/push
   - Manual: `npm run infra:validate`

## Multi-Provider Support

### How It Works

The validation script automatically discovers cloud providers:

1. Scans `infra/k8s/` for directories (excluding `base`)
2. Each directory is treated as a cloud provider (e.g., `hetzner`, `aws`, `gcp`)
3. Looks for standard environments: `dev`, `test`, `prod`
4. Validates any environment that has a `kustomization.yaml`

### Directory Structure

**Current (Hetzner only):**

```
infra/k8s/
├── base/               # Shared configurations
└── hetzner/            # Hetzner Cloud
    ├── dev/
    ├── test/
    └── prod/
```

**After Adding AWS:**

```
infra/k8s/
├── base/               # Shared configurations
├── hetzner/            # Hetzner Cloud
│   ├── dev/
│   ├── test/
│   └── prod/
└── aws/                # AWS (auto-detected!)
    ├── dev/
    │   ├── kustomization.yaml
    │   └── patches/
    ├── test/
    └── prod/
```

**Validation automatically includes both:**

```bash
npm run infra:validate

# Output:
# Discovered providers: aws, hetzner
# ✓ aws/dev: PASSED
# ✓ aws/test: PASSED
# ✓ hetzner/dev: PASSED
# ✓ hetzner/test: PASSED
# ✓ hetzner/prod: PASSED
```

### Adding a New Provider

**No configuration needed!** Just create the directory structure:

```bash
# 1. Create directory
mkdir -p infra/k8s/aws/dev/patches/statefulsets

# 2. Create kustomization.yaml
cat > infra/k8s/aws/dev/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
patches:
  - path: patches/statefulsets/postgres.statefulset.yaml
labels:
  - pairs:
      environment: dev
      provider: aws
EOF

# 3. Create provider-specific patches (combined resources + storage)
cat > infra/k8s/aws/dev/patches/statefulsets/postgres.statefulset.yaml <<EOF
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
spec:
  template:
    spec:
      containers:
        - name: postgres
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
  volumeClaimTemplates:
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: gp3  # AWS-specific
        resources:
          requests:
            storage: 14Gi
EOF

# 4. Validate (AWS automatically discovered!)
npm run infra:validate
```

### Provider-Specific Differences

Only customize what's different per provider:

- **StorageClass**: `hcloud-volumes` (Hetzner), `gp3` (AWS), `pd-ssd` (GCP), `azure-disk` (Azure)
- **Resource limits**: May vary by provider pricing/availability
- **Network policies**: Provider-specific networking
- **Annotations**: Load balancer annotations, etc.

Everything else stays in `base/` and is shared.

## Local Kubernetes Resource Operations (Podman+Minikube)

The following scripts ensure all resource operations (apply, delete, build) are always run against your intended local cluster context (e.g., `podman-local`).

**Why?**

- Prevents accidental application of resources to the wrong cluster (especially if you use multiple clusters or cloud contexts).
- Automatically switches `kubectl` to the correct context before running any resource command.

## Usage

```bash
# Build manifests for local cluster (prints YAML)
npm run infra:local:k8s-resources:build

# Apply manifests to local cluster (safe context)
npm run infra:local:k8s-resources:apply

# Delete manifests from local cluster (safe context)
npm run infra:local:k8s-resources:delete
```

These scripts use `tools/infra/kubectl-local-context.js` to:

- Check your current `kubectl` context
- Switch to `podman-local` if needed
- Only then run the resource operation

**If the context cannot be switched, the script aborts with a clear error.**

## Customizing the Cluster Name

If you change your local cluster name in `infra/k8s/podman/local/cluster/cluster-config.yaml`, update the `LOCAL_CONTEXT` variable in `tools/infra/kubectl-local-context.js` to match.

## Troubleshooting

**Kustomize not found after setup**:

- Restart your terminal
- Or run: `refreshenv` (Windows) / `source ~/.bashrc` (Unix)

**Manual installation** (if auto-install fails):

- Windows: `choco install kustomize`
- macOS: `brew install kustomize`
- Linux: Download from [GitHub releases](https://github.com/kubernetes-sigs/kustomize/releases)

## Files

- `setup-infra.js` - Auto-installer (cross-platform)
- `validate-kustomize.js` - Validation script (used by git hooks)
