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

### 1. Path-Based Routing with Exclusions

**deploy-k8s-resources.yml** now excludes cluster configs:

```yaml
on:
  push:
    paths:
      - "infra/k8s/base/**"
      - "infra/k8s/hetzner/**/patches/**"
      - "!infra/k8s/hetzner/**/cluster/**" # CRITICAL: Excludes cluster configs
```

**Why:** Prevents deploy workflow from triggering on cluster config changes, eliminating race conditions.

### 2. CI Always Enforced

**deploy-k8s-resources.yml** calls CI workflow for ALL deployments:

```yaml
jobs:
  ci:
    uses: ./.github/workflows/ci.yml # ALWAYS runs, no conditions

  deploy-dev:
    needs: [ci]
    if: |
      always() &&
      needs.ci.result == 'success' &&
      ...environment checks...
```

**Why:**

- Ensures quality checks pass before ALL deployments (no bypass)
- Prevents deploying broken manifests even during cluster provisioning
- Security-first approach: ~1-2 min additional time for guaranteed quality

### 3. workflow_call Integration

**ci.yml** now supports workflow_call:

```yaml
on:
  push:
    branches: [main, test, dev]
  pull_request:
    branches: [main, test, dev]
  workflow_call: # Allow other workflows to call CI
```

**Why:** Enables deploy-k8s-resources.yml to reuse CI workflow instead of duplicating checks.

## Deployment Scenarios

### Scenario 1: Resource-Only Changes

**Files changed:** `infra/k8s/base/statefulsets/postgres.statefulset.yaml`

**Flow:**

```
Push to dev branch
    ↓
deploy-k8s-resources.yml triggers (path matches base/**)
    ↓
ci job runs → CI workflow executes (lint, test, build)
    ↓
CI passes → needs.ci.result == 'success'
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
provision-hetzner-k8s-cluster.yml triggers (path matches cluster/**)
  ↓
STEP 1: ci job RUNS → CI workflow executes (lint, test, build - ~1-2 min)
  ↓
STEP 2: CI passes → needs.ci.result == 'success'
  ↓
STEP 3: provision workflow creates/updates cluster (~3-5 min)
  ↓
STEP 4: cluster ready → calls deploy-k8s-resources.yml via workflow_dispatch (environment=dev, ci_already_passed=true)
  ↓
STEP 5: deploy workflow SKIPS its CI (flag indicates CI already passed)
  ↓
STEP 6: deploy-dev job runs → resources deployed to NEW cluster
```

**Result:** ✅ CI runs ONCE, then provisioning and deployment execute in order  
**Trade-off:** Total time ~4-7 min (CI + provision + deploy). Efficient and secure  
**Security:** CI validation is mandatory and cannot be bypassed; deploy only skips CI when explicitly flagged by the provisioning workflow

### Scenario 3: Both Cluster + Resource Changes

**Files changed:**

- `infra/k8s/hetzner/dev/cluster/cluster-config.yaml`
- `infra/k8s/base/statefulsets/postgres.statefulset.yaml`

**Flow:**

```
Push to dev branch
    ↓
provision-hetzner-k8s-cluster.yml triggers (cluster/** matched)
deploy-k8s-resources.yml SKIPPED (path exclusion prevents trigger)
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
ci job RUNS → CI workflow executes
    ↓
CI passes → needs.ci.result == 'success'
    ↓
deploy-dev job runs if environment matches
```

**Result:** ✅ Manual deployments also validated by CI (no bypass)

## Technical Details

### Conditional Logic Breakdown

```yaml
deploy-dev:
  needs: [ci]
  if: |
    always() &&
    needs.ci.result == 'success' &&
    ((github.event_name == 'push' && github.ref == 'refs/heads/dev') ||
    (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'dev') ||
    (github.event_name == 'workflow_call' && inputs.environment == 'dev'))
```

**Explanation:**

1. `always()`: Run even if previous jobs failed (allows checking CI result)
2. `needs.ci.result == 'success'`: Only deploy if CI passed (no bypass)
3. Environment checks: Only run if branch/input matches environment

**Edge Cases Handled:**

- ✅ CI failed on push → deploy blocked
- ✅ CI failed on workflow_call → deploy blocked (cluster sits empty)
- ✅ CI failed on manual dispatch → deploy blocked
- ✅ Wrong environment selected → deploy skipped
- ✅ No skip bypass → all deployments validated

### Path Filter Patterns

**deploy-k8s-resources.yml:**

```yaml
paths:
  - "infra/k8s/base/**" # Matches all base manifests
  - "infra/k8s/hetzner/**/patches/**" # Matches environment patches
  - "!infra/k8s/hetzner/**/cluster/**" # EXCLUDES cluster configs
```

**provision-hetzner-k8s-cluster.yml:**

```yaml
paths:
  - "infra/k8s/hetzner/*/cluster/*.yaml" # Matches only cluster configs
  - ".github/actions/provision-hetzner-k8s-cluster/**" # Action changes
```

**Result:** Mutually exclusive triggers, no overlap

## Validation

### Automated Checks

All changes validated before merge:

1. **YAML Syntax:** No syntax errors detected
2. **Dependency Chain:** All 3 deploy jobs have `needs: [ci]`
3. **Conditional Logic:** All 3 deploy jobs only check `needs.ci.result == 'success'`
4. **Path Exclusion:** Cluster configs excluded from deploy triggers
5. **workflow_call Support:** CI workflow callable by other workflows
6. **No Skip Bypass:** CI always runs, no conditions on ci job

### Manual Testing Scenarios

```bash
# Test resource-only deployment (should run CI → Deploy)
git checkout -b test/resource-change
# Edit infra/k8s/base/statefulsets/postgres.statefulset.yaml
git commit -m "test: resource change"
git push origin test/resource-change

# Test cluster-only deployment (should skip CI, deploy after cluster ready)
git checkout -b test/cluster-change
# Edit infra/k8s/hetzner/dev/cluster/cluster-config.yaml
git commit -m "test: cluster change"
git push origin test/cluster-change

# Test both changes (should only trigger provision workflow)
git checkout -b test/both-changes
# Edit both files above
git commit -m "test: both changes"
git push origin test/both-changes
```

## Benefits

1. **No Duplicate Deployments:** Path exclusion prevents race conditions
2. **Quality Gates:** CI ALWAYS passes before deployment (no bypass allowed)
3. **Security-First:** Prevents deploying broken manifests to any environment
4. **Correctness:** Resources always deployed to correct cluster after CI validation
5. **Visibility:** Clear workflow dependencies in GitHub Actions UI
6. **Maintainability:** Single CI workflow reused by multiple consumers

## Troubleshooting

### Deploy job shows "skipped" but should run

**Check:**

1. Verify `needs.ci.result` - if CI failed, deploy won't run (expected behavior)
2. Check environment conditions - branch must match environment
3. Review deployment control flags in `infra/deploy-control.yaml`

### CI doesn't run (workflow shows no ci job)

**Problem:** CI job has conditional skip (OLD implementation - this was a security bug)

**Solution:** Verify ci job has NO conditions:

```yaml
ci:
  uses: ./.github/workflows/ci.yml # No 'if' condition - ALWAYS runs
```

### Deploy runs without CI validation

**Problem:** Deploy job checks for skipped state (OLD implementation - this was a security bug)

**Solution:** Verify deploy job only checks success:

```yaml
deploy-dev:
  needs: [ci]
  if: |
    always() &&
    needs.ci.result == 'success' &&  # Only 'success', NOT 'skipped'
    ...
```

### Deploy runs on cluster changes (duplicate deployment)

**Check:**

```yaml
paths:
  - "!infra/k8s/hetzner/**/cluster/**"
```

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
