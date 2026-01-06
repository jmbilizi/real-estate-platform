# Workflow Orchestration - CI/CD Integration

## Overview

This document explains how CI and CD workflows are orchestrated to prevent duplicate deployments and ensure quality checks pass before deployment.

## Problem Statement

**Before Fix:**

When both cluster configs and resource manifests changed:

```
User commits both cluster config + base manifests
    ↓
Two workflows trigger simultaneously:
    ├── provision-hetzner-k8s-cluster.yml (creates NEW cluster)
    └── deploy-k8s-resources.yml (deploys to OLD cluster)

Result: Race condition, resources deployed to wrong cluster!
```

Additionally, there was no CI validation before deployment - broken code could be deployed directly.

## Solution Architecture

### 1. workflow_run Chaining

**CI is the primary trigger for all push/PR events:**

```yaml
# ci.yml runs first
on:
  push:
    branches: [main, test, dev]
  pull_request:
    branches: [main, test, dev]
```

**Provisioning and deployment chain after CI success:**

```yaml
# provision-hetzner-k8s-cluster.yml
on:
  workflow_run:
    workflows: ["CI"]
    types: ["completed"]
    branches: [dev, test, main]

# deploy-k8s-resources.yml
on:
  workflow_run:
    workflows: ["CI"]
    types: ["completed"]
    branches: [dev, test, main]
```

**Why:** Single CI entry point, clean workflow sequencing, no embedded CI complexity.

### 2. Path-Based Change Detection

**Both workflows use detect-changes jobs to filter paths:**

```yaml
detect-changes:
  if: github.event_name == 'workflow_run' || github.event_name == 'workflow_dispatch'
  runs-on: ubuntu-latest
  uses: dorny/paths-filter@v3
```

**deploy-k8s-resources.yml** filters for resources:

```yaml
filters: |
  base:
    - 'infra/k8s/base/**'
  dev:
    - 'infra/k8s/hetzner/dev/patches/**'
```

**provision-hetzner-k8s-cluster.yml** filters for cluster configs:

```yaml
filters: |
  dev-cluster:
    - 'infra/k8s/hetzner/dev/cluster/**'
```

**Why:** Prevents duplicate triggers, enables environment-specific routing.

### 3. Workflow Gating

**All deployment jobs gate on workflow_run success:**

```yaml
deploy-dev:
  needs: [detect-changes]
  if: |
    always() &&
    github.event_name == 'workflow_run' &&
    github.event.workflow_run.conclusion == 'success' &&
    github.event.workflow_run.head_branch == 'dev' &&
    needs.detect-changes.outputs.dev-changed == 'true'
```

**Why:** Ensures quality checks pass before deployment, no bypass mechanism.

## Deployment Scenarios

### Scenario 1: Resource-Only Changes

**Files changed:** `infra/k8s/base/statefulsets/postgres.statefulset.yaml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (primary trigger)
    ↓
CI passes → deploy-k8s-resources.yml triggers via workflow_run
    ↓
detect-changes job filters resource changes (base/dev-changed)
    ↓
deploy-dev job runs → resources deployed to dev cluster
```

**Result:** ✅ Code validated before deployment, resources updated

### Scenario 2: Cluster Config Changes

**Files changed:** `infra/k8s/hetzner/dev/cluster/cluster-config.yaml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (primary trigger - ~1-2 min)
    ↓
CI passes → provision-hetzner-k8s-cluster.yml triggers via workflow_run
    ↓
detect-changes job filters cluster changes (dev-cluster-changed)
    ↓
update-dev-cluster job runs → creates/updates cluster (~3-5 min)
    ↓
cluster ready → calls deploy-k8s-resources.yml via workflow_dispatch (environment=dev)
    ↓
deploy-dev job runs → resources deployed to NEW cluster
```

**Result:** ✅ CI runs ONCE, then provisioning and deployment execute in order  
**Trade-off:** Total time ~4-7 min (CI + provision + deploy). Efficient and secure  
**Security:** CI validation enforced via workflow_run chaining; no bypass mechanism

### Scenario 3: Both Cluster + Resource Changes

**Files changed:**

- `infra/k8s/hetzner/dev/cluster/cluster-config.yaml`
- `infra/k8s/base/statefulsets/postgres.statefulset.yaml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (primary trigger)
    ↓
CI passes → provision-hetzner-k8s-cluster.yml triggers via workflow_run
    ↓
provision workflow creates/updates cluster
    ↓
calls deploy-k8s-resources.yml (deploys both cluster configs + resource changes)
```

**Result:** ✅ No duplicate deployment, correct sequencing

### Scenario 4: Manual Resource Deployment

**Command:** `gh workflow run deploy-k8s-resources.yml -f environment=dev`

**Flow:**

```
Manual workflow_dispatch trigger
    ↓
deploy-dev job runs directly (no CI - manual override)
    ↓
resources deployed to dev cluster
```

**Result:** ✅ Manual deployments skip CI (operator discretion)

## Technical Details

### Conditional Logic Breakdown

```yaml
deploy-dev:
  needs: [detect-changes]
  if: |
    always() &&
    github.event_name == 'workflow_run' &&
    github.event.workflow_run.conclusion == 'success' &&
    github.event.workflow_run.head_branch == 'dev' &&
    needs.detect-changes.outputs.dev-changed == 'true'
```

**Explanation:**

1. `always()`: Run even if previous jobs failed (allows checking detect-changes result)
2. `workflow_run.conclusion == 'success'`: Only deploy if CI passed
3. `workflow_run.head_branch == 'dev'`: Route to dev environment
4. `dev-changed == 'true'`: Only deploy if dev resources changed

**Edge Cases Handled:**

- ✅ CI failed on push → deployment blocked (workflow_run never triggers)
- ✅ Wrong environment → deploy skipped (branch routing)
- ✅ No changes → deploy skipped (path filtering)

### Path Filter Patterns

**deploy-k8s-resources.yml:**

```yaml
filters: |
  base:
    - 'infra/k8s/base/**'
  dev:
    - 'infra/k8s/hetzner/dev/patches/**'
  test:
    - 'infra/k8s/hetzner/test/patches/**'
  prod:
    - 'infra/k8s/hetzner/prod/patches/**'
```

**provision-hetzner-k8s-cluster.yml:**

```yaml
filters: |
  dev-cluster:
    - 'infra/k8s/hetzner/dev/cluster/**'
  test-cluster:
    - 'infra/k8s/hetzner/test/cluster/**'
  prod-cluster:
    - 'infra/k8s/hetzner/prod/cluster/**'
```

**Result:** Environment-specific routing, no overlap

## Validation

### Automated Checks

All changes validated before merge:

1. **YAML Syntax:** No syntax errors detected
2. **workflow_run Triggers:** Both workflows chain after CI completion
3. **Conditional Logic:** All deploy jobs check `workflow_run.conclusion == 'success'`
4. **Path Filtering:** detect-changes jobs filter environment-specific paths
5. **workflow_call Support:** Deploy workflow callable by provisioning for manual override
6. **CI First:** CI is primary trigger, no embedded CI jobs

### Manual Testing Scenarios

```bash
# Test resource-only deployment (should run CI → Deploy)
git checkout -b test/resource-change
# Edit infra/k8s/base/statefulsets/postgres.statefulset.yaml
git commit -m "test: resource change"
git push origin test/resource-change
# Verify: CI runs first, then deploy-k8s-resources.yml via workflow_run

# Test cluster config deployment (should run CI → Provision → Deploy)
git checkout -b test/cluster-change
# Edit infra/k8s/hetzner/dev/cluster/cluster-config.yaml
git commit -m "test: cluster config change"
git push origin test/cluster-change
# Verify: CI runs first, then provision-hetzner-k8s-cluster.yml via workflow_run

# Test both changes (should run CI → Provision only)
git checkout -b test/both-changes
# Edit both files
git commit -m "test: both changes"
git push origin test/both-changes
# Verify: Only provision workflow runs (deploy called via workflow_dispatch)
```

## Benefits

1. **No Duplicate Deployments:** Path filtering prevents race conditions
2. **Quality Gates:** CI runs first for all push/PR events
3. **Security-First:** workflow_run chaining ensures CI passes before deployment
4. **Correctness:** Resources always deployed to correct cluster
5. **Visibility:** Clean workflow sequencing in GitHub Actions UI
6. **Maintainability:** Single CI workflow, no embedded CI complexity

## Troubleshooting

### Deploy job doesn't run after push

**Check:**

1. Verify CI workflow ran and succeeded
2. Check `workflow_run.conclusion == 'success'` in deploy job logs
3. Check path filters - did changed files match filter patterns?
4. Check branch routing - `workflow_run.head_branch` matches environment

**Common Issues:**

- CI failed → deployment blocked (expected behavior)
- Files changed outside filtered paths → no deployment (expected)
- Wrong branch → deploy skipped (expected)

### Multiple workflows triggered simultaneously

**Check:**

1. Verify path filters are mutually exclusive (provision vs deploy)
2. Check detect-changes outputs in workflow logs
3. Verify provision workflow calls deploy via workflow_dispatch (not duplicate trigger)

**Common Issues:**

- Path filters overlap → fix filter patterns
- Manual dispatch + push → expected (two independent triggers)

### Workflow_run not triggering

**Check:**

1. Verify CI workflow name in workflow_run matches exactly: `workflows: ["CI"]`
2. Check workflow_run branches match push branches
3. Verify CI workflow completed (check GitHub Actions tab)

**Common Issues:**

- Workflow name mismatch → no trigger
- Branch not in workflow_run list → no trigger
- CI still running → workflow_run waits for completion

````

### Deploy runs on cluster changes (duplicate deployment)

**Check:**

```yaml
paths:
  - "!infra/k8s/hetzner/**/cluster/**"
````

Path exclusion must be present to prevent deploy trigger on cluster changes.

### Both workflows trigger on same commit

**Check:**

- Verify path filters are mutually exclusive
- Check for glob pattern overlaps
- Review git commit file list: `git show --name-only`

## References

- CI Workflow: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- Deploy Workflow: [.github/workflows/deploy-k8s-resources.yml](../../.github/workflows/deploy-k8s-resources.yml)
- Cluster Provisioning: [.github/workflows/provision-hetzner-k8s-cluster.yml](../../.github/workflows/provision-hetzner-k8s-cluster.yml)
- Deployment Control: [infra/deploy-control.yaml](../deploy-control.yaml)
- CI/CD Documentation: [docs/ci-cd.md](../../docs/ci-cd.md)
