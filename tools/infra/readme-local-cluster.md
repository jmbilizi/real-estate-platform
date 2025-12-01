# ⚠️ Required: cluster-config.yaml

All local cluster scripts **require** a valid config file at:

      infra/k8s/podman/local/cluster/cluster-config.yaml

This file **must** contain:

- A valid `cluster_name` field (e.g. `cluster_name: podman-local`)
- A `resources:` section with `cpus`, `memory`, and `disk` nested under it, e.g.:

```yaml
cluster_name: podman-local
nodes: 2
kubernetes_version: v1.28.3
resources:
  cpus: 2
  memory: 3072
  disk: 20g
registries:
  insecure:
    - gcr.io
    - docker.io
    - registry.k8s.io
    - ghcr.io
```

If the file or any required field is missing or invalid, all setup, context, and delete scripts will fail with a clear error. No defaults or fallbacks are used.

**Always edit your cluster name and resources in the config file, never in scripts.**

# Podman + Minikube Local Development Setup

Automated cross-platform setup for local Kubernetes development using **Podman + Minikube**.

**100% Open Source**: Podman Desktop + Minikube (no Docker Desktop required)

## What It Does

1. **Detects your platform** (Windows, macOS, Linux)
2. **Installs Podman Desktop** if not already installed:
   - **Windows**: Via winget (preferred) or Chocolatey
   - **macOS**: Via Homebrew
   - **Linux**: Via flatpak/dnf/yay depending on distribution
3. **Installs Minikube** if not already installed
4. **Initializes Podman machine** in rootful mode (4 CPU, 8GB RAM, 50GB disk)
5. **Configures insecure registries** for development (bypasses certificate issues)
6. **Creates or repairs Minikube cluster** named `podman-local`:
   - Creates new cluster if doesn't exist
   - Repairs cluster if corrupted (restarts containers, fixes config)
   - Auto-recovers after computer restart (~30s)
7. **Optionally deploys** local infrastructure resources via `--apply` flag

## Usage

```bash
# 1. Setup cluster (creates or repairs existing cluster)
npm run infra:local:cluster:setup

# 2. Deploy resources
npm run infra:local:k8s-resources:apply

# 3. Check status
kubectl get pods

# 4. View logs
kubectl logs <pod-name>

# 5. Port forward (example for PostgreSQL)
kubectl port-forward postgres-0 5432:5432

# 6. Delete cluster and all resources (complete cleanup)
npm run infra:local:cluster:delete
```

**Important Notes:**

- **Setup** (`infra:local:cluster:setup`):
  - Creates cluster if doesn't exist
  - Restarts cluster if stopped
  - **Repairs cluster** if corrupted (fixes containers, configuration, kubectl context)
  - NEVER deletes data unless repair is impossible
- **Delete** (`infra:local:cluster:delete`): Complete teardown - deletes K8s resources, cluster, containers, images, and volumes. Podman machine is preserved for fast recreation.

## Cluster Repair

The setup script includes intelligent repair capabilities:

1. **Container repair**: Restarts stopped containers
2. **Configuration repair**: Updates cluster configuration
3. **Context repair**: Fixes kubectl context
4. **API verification**: Tests cluster connectivity

If automatic repair fails, the script will recommend manual cleanup and recreation.

## Manual Installation

If automatic installation fails, install Podman Desktop manually:

- **Windows**: https://podman-desktop.io/downloads (or `winget install RedHat.Podman-Desktop`)
- **macOS**: https://podman-desktop.io/downloads (or `brew install --cask podman-desktop`)
- **Linux**: https://podman-desktop.io/downloads (or `flatpak install io.podman_desktop.PodmanDesktop`)

Then run `npm run infra:local:cluster:setup` again.

## Platform-Specific Notes

### Windows

- Requires Windows 10/11 with WSL2
- Podman Desktop will automatically install and configure WSL2
- Podman machine runs in **rootful mode** for better Kubernetes compatibility
- Uses **Kubernetes v1.28.3** (stable, cgroups v1 compatible)
- First-time setup: ~5 minutes
- Post-restart recovery: ~30 seconds (automatic)

### macOS

- Uses libkrun (default) or AppleHV for virtualization
- Requires macOS 12 (Monterey) or later
- Podman machine runs in rootful mode
- First-time setup: ~3-5 minutes
- Post-restart recovery: ~30 seconds (automatic)

### Linux

- Uses QEMU for virtualization
- Requires KVM support (most modern Linux distributions)
- Supported distributions: Ubuntu, Debian, Fedora, Arch, openSUSE
- Podman machine runs in rootful mode
- First-time setup: ~2-3 minutes
- Post-restart recovery: ~30 seconds (automatic)

## Troubleshooting

### "Podman CLI not in PATH"

- **Windows**: Restart terminal or reboot
- **macOS/Linux**: Run `source ~/.bashrc` or restart terminal

### "Cluster not ready after setup"

```bash
# Check cluster status
minikube status --profile=podman-local

# Check Podman machine
podman machine list

# Run setup again (automatic repair + restart)
npm run infra:local:cluster:setup

# If repair fails, delete and recreate
npm run infra:local:cluster:delete
npm run infra:local:cluster:setup
```

### "Registry connection errors"

The setup automatically configures insecure registries for development. If you still see errors:

```bash
# Check registry config
podman machine ssh "cat /etc/containers/registries.conf.d/99-dev.conf"

# Reconfigure (run setup again, it will fix corrupt config)
npm run infra:local:cluster:setup
```

### "Cluster stopped after computer restart"

**This is expected behavior**. The setup script automatically detects and restarts the cluster:

```bash
# Just run setup again (30s restart, not full recreation)
npm run infra:local:cluster:setup
```

### "Installation failed"

1. Install manually:
   - Podman Desktop: https://podman-desktop.io/downloads
   - Minikube: `winget install Kubernetes.minikube` (Windows) or `brew install minikube` (macOS)
2. Verify installation: `podman --version` and `minikube version`
3. Run setup again: `npm run infra:local:cluster:setup`

## Cluster Details

**Cluster Configuration:**

- **Name**: `podman-local` (container, context, and node)
- **Nodes**: 2 (1 control-plane + 1 worker) - configurable
- **Kubernetes Version**: v1.28.3 (stable, cgroups v1 compatible)
- **Driver**: Podman (rootful mode)
- **Container Runtime**: containerd
- **Auto-Recovery**: Yes (~30 seconds after computer restart)

**Resources:**

- **Per Node**: 2 CPU, 3GB RAM, 20GB disk
- **Total Cluster**: 4 CPU, 6GB RAM, 40GB disk
- **Podman Machine**: 4 CPU, 8GB RAM, 50GB disk

**Customizing Resources:**

Edit the `resources:` section in your `cluster-config.yaml` to adjust per-node CPU, memory, or disk. Example:

```yaml
resources:
  cpus: 2 # CPU cores per node
  memory: 3072 # Memory in MB per node (3GB)
  disk: 20g # Disk size per node
```

**Important**: Total resources (nodes × per-node) cannot exceed Podman machine capacity. The script validates this automatically.

**Insecure Registries** (development only):

- `gcr.io`
- `docker.io`
- `registry-1.docker.io`
- `registry.k8s.io`
- `ghcr.io`

**Access:**

```bash
# Cluster context
kubectl config current-context  # podman-local

# Cluster info
kubectl cluster-info

# View nodes
kubectl get nodes
# NAME              STATUS   ROLES           AGE   VERSION
# podman-local      Ready    control-plane   5m    v1.28.3
# podman-local-m02  Ready    <none>          2m    v1.28.3

# Container status
podman ps
# CONTAINER ID  IMAGE                                 COMMAND     CREATED     STATUS      PORTS       NAMES
# ...           gcr.io/k8s-minikube/kicbase:v0.0.42  ...         5 minutes   Up 5 min    ...         podman-local
# ...           gcr.io/k8s-minikube/kicbase:v0.0.42  ...         2 minutes   Up 2 min    ...         podman-local-m02
```

## Resources

- Local resources: `128Mi-256Mi` memory, `100m-250m` CPU
- Local storage: `2Gi` using `local-path` StorageClass
- See: `infra/k8s/podman/local/patches/`

## Related Scripts

- `npm run infra:local:k8s-resources:build` - Build manifests (preview YAML)
- `npm run infra:validate` - Validate all environments (including local)
- `npm run infra:setup` - Setup Kustomize and other tools
