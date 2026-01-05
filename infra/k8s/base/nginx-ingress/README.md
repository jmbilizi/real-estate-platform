# Nginx Ingress Controller

# Official manifest reference (pinned version for deterministic deployments)

# https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.11.1/deploy/static/provider/cloud/deploy.yaml

#

# This resource is applied via kustomization.yaml as a remote reference.

# No local files needed - Kustomize fetches directly from GitHub.

#

# Why remote reference:

# - Official Kubernetes project manifest

# - Auto-updated security patches (when we bump version)

# - No manual YAML maintenance

# - Works on all providers (Podman, Hetzner, AWS, Azure)

#

# To update version:

# Edit base/kustomization.yaml and change controller-v1.11.1 to newer version
