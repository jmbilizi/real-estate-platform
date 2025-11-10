# Hetzner K8s Cluster Setup

This directory contains the Kubernetes cluster configurations for our infrastructure deployed on Hetzner Cloud using [hetzner-k3s](https://github.com/vitobotta/hetzner-k3s).

## Overview

We use a GitOps approach to manage our Kubernetes infrastructure across three environments:

- **Dev** (`hetzner_dev_cluster_config.yaml`) - Development cluster, auto-deploys from `dev` branch
- **Test** (`hetzner_test_cluster_config.yaml`) - Testing cluster, auto-deploys from `test` branch (currently disabled)
- **Production** (`hetzner_prod_cluster_config.yaml`) - Production cluster, auto-deploys from `main` branch (currently disabled)

## Architecture

**Dev Cluster:**

- **1 Master Node** (CPX11) - Single control plane for cost optimization
- **Worker Pools**:
  - 1x CPX21 static worker node
  - 0-1x CPX21 autoscaling pool (for burst capacity)
- **Cost**: ~$17-29/month

**Test/Production Clusters:**

- **3 Master Nodes** (CPX11) - High availability setup
- **Worker Pools**:
  - 1x CPX21 static worker node
  - 1x CPX31 autoscaling pool (0-3 instances)
- **Cost**: ~$27-102/month

**All Clusters:**

- **K3s Version**: v1.32.0+k3s1
- **CNI**: Flannel with encryption enabled
- **Location**: ash-dc1 (Ashburn, VA)

## Deployment Workflow

1. Edit cluster config files
2. Create PR to target branch (dev/test/main)
3. PR triggers YAML validation (no deployment)
4. Merge PR
5. If `auto_deploy: true`, cluster deploys automatically

### Branch Mapping

- `dev` branch → Dev cluster (auto-deploy enabled)
- `test` branch → Test cluster (auto-deploy disabled)
- `main` branch → Production cluster (auto-deploy disabled)

## Setup

**Required GitHub Secrets:**

- `HETZNER_TOKEN` - Hetzner Cloud API token
- `HETZNER_SSH_PRIVATE_KEY` - SSH private key (full content)
- `HETZNER_SSH_PUBLIC_KEY` - SSH public key

**GitHub Environments:**

- `dev` - No protection
- `test` - Optional reviewers
- `production` - Required reviewers, restrict to main branch

## Configuration

See [hetzner-k3s Configuration Reference](https://github.com/vitobotta/hetzner-k3s#cluster-configuration) for all available options.

**Custom additions:**

- `auto_deploy: true|false` - Controls auto-deployment (removed before processing)
- `HETZNER_TOKEN` placeholder - Replaced by GitHub Actions with secret value

## Cost Estimate

| Cluster   | Masters  | Workers          | Monthly Cost |
| --------- | -------- | ---------------- | ------------ |
| Dev       | 1x CPX11 | 1-2x CPX21       | ~$17-29      |
| Test/Prod | 3x CPX11 | 1-4x CPX21/CPX31 | ~$27-102     |

## Troubleshooting

- Check GitHub Actions logs for errors
- Verify secrets are configured correctly
- Ensure `auto_deploy: true` for deployment
- Restrict firewall after initial setup (`allowed_networks` in config)

## Resources

- [hetzner-k3s Documentation](https://github.com/vitobotta/hetzner-k3s)
- [Hetzner Cloud Console](https://console.hetzner.cloud/)
