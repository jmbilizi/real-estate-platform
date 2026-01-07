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

Additionally:

1. No CI validation before deployment - broken code could be deployed directly
2. Workflows always appeared in Actions UI after every CI run (even with no infrastructure changes)

## Solution Architecture

### 1. CI-Driven Explicit Triggering

**CI is the primary entry point for all push/PR events:**

```yaml
# ci.yml runs first
on:
  push:
    branches: [main, test, dev]
  pull_request:
    branches: [main, test, dev]

permissions:
  actions: write # Required for gh workflow run
  contents: read
```

**CI detects changes and explicitly triggers ONLY relevant workflows:**

```yaml
# After quality checks pass, detect infrastructure changes
detect-infra-changes:
  needs: [node, python, dotnet]
  if: github.event_name == 'push'
  outputs:
    cluster-changed: ${{ steps.detect.outputs.cluster-changed }}
    deploy-changed: ${{ steps.detect.outputs.deploy-changed }}

# Trigger provision ONLY if cluster files changed
trigger-provision:
  needs: [detect-infra-changes]
  if: needs.detect-infra-changes.outputs.cluster-changed == 'true'
  steps:
    - run: gh workflow run provision-hetzner-k8s-cluster.yml --field environment=dev

# Trigger deploy ONLY if deploy files changed (and cluster didn't change)
trigger-deploy:
  needs: [detect-infra-changes]
  if: |
    needs.detect-infra-changes.outputs.deploy-changed == 'true' &&
    needs.detect-infra-changes.outputs.cluster-changed != 'true'
  steps:
    - run: gh workflow run deploy-k8s-resources.yml --field environment=dev
```

**Why:** Single CI entry point, workflows ONLY appear when needed, no UI clutter.

### 2. Change Detection Patterns

**Change detection via git diff and grep patterns:**

```bash
# Cluster changes
git diff HEAD^ HEAD --name-only | grep -E \
  '^infra/k8s/hetzner/.*/cluster/|^\.github/workflows/provision-hetzner-k8s-cluster\.yml|^\.github/actions/provision-hetzner-k8s-cluster/'

# Deploy changes
git diff HEAD^ HEAD --name-only | grep -E \
  '^infra/k8s/base/|^infra/deploy-control\.yaml|^infra/k8s/hetzner/.*/patches/|^\.github/workflows/deploy-k8s-resources\.yml|^\.github/actions/deploy-k8s-resources/'
```

**Why:** Simple, reliable, no external dependencies, detects workflow changes too.

### 3. Cluster Precedence Logic

**If both cluster and deploy files change, only provision triggers:**

```yaml
trigger-deploy:
  if: |
    needs.detect-infra-changes.outputs.deploy-changed == 'true' &&
    needs.detect-infra-changes.outputs.cluster-changed != 'true'  # Excludes when cluster changed
```

**Why:** Prevents race conditions - provision workflow will trigger deploy via workflow_call after cluster is ready.

## Deployment Scenarios

### Scenario 1: Resource-Only Changes

**Files changed:** `infra/k8s/base/statefulsets/postgres.statefulset.yaml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (quality checks: lint, test, build)
    ↓
Quality checks PASS
    ↓
detect-infra-changes job (deploy-changed=true, cluster-changed=false)
    ↓
trigger-deploy job runs → gh workflow run deploy-k8s-resources.yml
    ↓
deploy-dev job runs → resources deployed to dev cluster
```

**Result:** ✅ ONLY Deploy workflow appears in Actions (after CI)  
**Why:** CI explicitly triggered deploy because deploy files changed

### Scenario 2: Cluster Config Changes

**Files changed:** `infra/k8s/hetzner/dev/cluster/cluster-config.yaml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (quality checks: ~1-2 min)
    ↓
Quality checks PASS
    ↓
detect-infra-changes job (cluster-changed=true, deploy-changed=false)
    ↓
trigger-provision job runs → gh workflow run provision-hetzner-k8s-cluster.yml
    ↓
update-dev-cluster job runs → creates/updates cluster (~3-5 min)
    ↓
cluster ready → calls deploy-k8s-resources.yml via workflow_call (environment=dev)
    ↓
deploy-dev job runs → resources deployed to NEW cluster
```

**Result:** ✅ ONLY Provision workflow appears in Actions (then Deploy when Provision completes)  
**Why:** CI explicitly triggered provision because cluster files changed  
**Trade-off:** Total time ~4-7 min (CI + provision + deploy). Efficient and secure  
**Security:** CI validation enforced before provision triggers

### Scenario 3: Both Cluster + Resource Changes

**Files changed:**

- `infra/k8s/hetzner/dev/cluster/cluster-config.yaml`
- `infra/k8s/base/statefulsets/postgres.statefulset.yaml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (quality checks)
    ↓
Quality checks PASS
    ↓
detect-infra-changes job (cluster-changed=true, deploy-changed=true)
    ↓
trigger-provision job runs (trigger-deploy SKIPPED due to cluster precedence)
    ↓
provision-hetzner-k8s-cluster.yml triggered
    ↓
provision workflow creates/updates cluster
    ↓
calls deploy-k8s-resources.yml via workflow_call (deploys both cluster + resource changes)
```

**Result:** ✅ ONLY Provision workflow appears (then Deploy)  
**Why:** Cluster changes take precedence - trigger-deploy condition excludes when cluster-changed=true

### Scenario 4: Unrelated Files Changed

**Files changed:** `README.md`, `src/app.ts`, `docs/architecture.md`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (quality checks)
    ↓
Quality checks PASS
    ↓
detect-infra-changes job (cluster-changed=false, deploy-changed=false)
    ↓
NO trigger jobs run (trigger-provision and trigger-deploy both skipped)
```

**Result:** ✅ ONLY CI workflow appears in Actions  
**Why:** No infrastructure changes detected, no workflows triggered

### Scenario 5: Provision Workflow Files Changed

**Files changed:** `.github/workflows/provision-hetzner-k8s-cluster.yml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (quality checks)
    ↓
Quality checks PASS
    ↓
detect-infra-changes job (cluster-changed=true - workflow files match pattern)
    ↓
trigger-provision job runs → gh workflow run provision-hetzner-k8s-cluster.yml
    ↓
Provision workflow runs (validates workflow changes)
```

**Result:** ✅ Provision workflow appears (validates workflow changes)  
**Why:** Workflow changes trigger the workflow itself to ensure it works

### Scenario 6: Deploy Workflow Files Changed

**Files changed:** `.github/actions/deploy-k8s-resources/action.yml`

**Flow:**

```
Push to dev branch
    ↓
CI workflow runs (quality checks)
    ↓
Quality checks PASS
    ↓
detect-infra-changes job (deploy-changed=true - action files match pattern)
    ↓
trigger-deploy job runs → gh workflow run deploy-k8s-resources.yml
    ↓
Deploy workflow runs (validates workflow changes)
```

**Result:** ✅ Deploy workflow appears (validates workflow changes)  
**Why:** Workflow changes trigger the workflow itself to ensure it works

### Scenario 7: Manual Resource Deployment

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

### CI Change Detection Logic

**Cluster changes pattern:**

```bash
git diff HEAD^ HEAD --name-only | grep -E \
  '^infra/k8s/hetzner/.*/cluster/|^\.github/workflows/provision-hetzner-k8s-cluster\.yml|^\.github/actions/provision-hetzner-k8s-cluster/'
```

**Deploy changes pattern:**

```bash
git diff HEAD^ HEAD --name-only | grep -E \
  '^infra/k8s/base/|^infra/deploy-control\.yaml|^infra/k8s/hetzner/.*/patches/|^\.github/workflows/deploy-k8s-resources\.yml|^\.github/actions/deploy-k8s-resources/'
```

**Environment mapping:**

- dev branch → dev environment
- test branch → test environment
- main branch → prod environment

### Conditional Logic Breakdown

**CI detect-infra-changes job:**

```yaml
detect-infra-changes:
  needs: [node, python, dotnet]
  if: github.event_name == 'push'
  outputs:
    cluster-changed: ${{ steps.detect.outputs.cluster-changed }}
    deploy-changed: ${{ steps.detect.outputs.deploy-changed }}
```

**CI trigger-provision job:**

```yaml
trigger-provision:
  needs: [detect-infra-changes]
  if: needs.detect-infra-changes.outputs.cluster-changed == 'true'
  steps:
    - run: |
        gh workflow run provision-hetzner-k8s-cluster.yml \
          --repo ${{ github.repository }} \
          --ref ${{ github.ref_name }} \
          --field environment=${{ env.TARGET_ENV }}
```

**CI trigger-deploy job:**

```yaml
trigger-deploy:
  needs: [detect-infra-changes]
  if: |
    needs.detect-infra-changes.outputs.deploy-changed == 'true' &&
    needs.detect-infra-changes.outputs.cluster-changed != 'true'
```

**Explanation:**

1. Quality checks (node, python, dotnet) run first
2. `detect-infra-changes` runs only on push (not PRs), after quality checks pass
3. `cluster-changed` triggers provision workflow explicitly
4. `deploy-changed` triggers deploy workflow ONLY if cluster didn't change (precedence logic)
5. Uses `gh workflow run` to trigger workflows explicitly (not workflow_run)

**Edge Cases Handled:**

- ✅ CI failed on push → triggers never execute (quality gates enforced)
- ✅ Wrong environment → branch-to-env mapping handles routing
- ✅ No changes → no workflows triggered (clean UI)
- ✅ Both cluster+deploy change → only provision triggers (cluster precedence)
- ✅ PR events → triggers skipped (validation only, no deployment)

### Deploy Workflow Conditions

**deploy-dev job (simplified):**

```yaml
deploy-dev:
  if: |
    (github.event_name == 'workflow_dispatch' && 
     github.event.inputs.environment == 'dev') ||
    (github.event_name == 'workflow_call' && 
     inputs.environment == 'dev')
```

**Why simplified:** No workflow_run conditions, no detect-changes dependency. Clean and maintainable.

## Validation

### Automated Checks

All changes validated before merge:

1. **YAML Syntax:** No syntax errors detected
2. **Explicit Triggering:** CI uses `gh workflow run` to trigger provision/deploy selectively
3. **Conditional Logic:** All trigger jobs check change detection outputs
4. **Cluster Precedence:** trigger-deploy excludes when cluster-changed=true
5. **workflow_call Support:** Deploy workflow callable by provisioning
6. **CI First:** CI is primary entry point, quality checks enforced

### Manual Testing Scenarios

```bash
# Test resource-only deployment (should run CI → ONLY Deploy appears)
git checkout -b test/resource-change
# Edit infra/k8s/base/statefulsets/postgres.statefulset.yaml
git commit -m "test: resource change"
git push origin test/resource-change
# Verify: CI runs, ONLY deploy-k8s-resources.yml appears in Actions

# Test cluster config deployment (should run CI → ONLY Provision appears, then Deploy)
git checkout -b test/cluster-change
# Edit infra/k8s/hetzner/dev/cluster/cluster-config.yaml
git commit -m "test: cluster config change"
git push origin test/cluster-change
# Verify: CI runs, ONLY provision-hetzner-k8s-cluster.yml appears (then Deploy)

# Test both changes (should run CI → ONLY Provision appears)
git checkout -b test/both-changes
# Edit both files
git commit -m "test: both changes"
git push origin test/both-changes
# Verify: CI runs, ONLY provision appears (deploy called via workflow_call)

# Test unrelated changes (should run ONLY CI)
git checkout -b test/docs-change
# Edit README.md
git commit -m "docs: update readme"
git push origin test/docs-change
# Verify: ONLY CI workflow appears, no provision/deploy workflows
```

## Benefits

1. **No Duplicate Workflows:** Explicit triggering prevents unnecessary workflow appearances
2. **Quality Gates:** CI runs first and gates all infrastructure operations
3. **Clean UI:** Workflows ONLY appear when they have work to do
4. **No Unnecessary Runs:** Change detection prevents workflows from running when irrelevant files change
5. **No Unnecessary Runs:** Change detection prevents workflows from running when irrelevant files change
6. **Security-First:** CI gating ensures untested code never reaches infrastructure
7. **Correctness:** Cluster precedence logic ensures resources deploy to correct cluster
8. **Visibility:** Clean workflow history in GitHub Actions UI
9. **Maintainability:** Simple conditions, no complex workflow_run logic, no detect-changes jobs in provision/deploy workflows

## Troubleshooting

### Provision/Deploy workflow doesn't trigger after push

**Check:**

1. Verify CI workflow ran and succeeded (check Actions tab)
2. Check `detect-infra-changes` job outputs in CI workflow logs
3. Verify changed files match detection patterns (cluster or deploy)
4. Check branch-to-environment mapping (dev→dev, test→test, main→prod)

**Common Issues:**

- CI failed → no triggers executed (expected behavior)
- Files changed outside detection patterns → no workflows triggered (expected)
- Wrong branch → workflow triggered with wrong environment parameter

**Debug Commands:**

```bash
# Check what files changed
git diff HEAD^ HEAD --name-only

# Test cluster pattern
git diff HEAD^ HEAD --name-only | grep -E '^infra/k8s/hetzner/.*/cluster/'

# Test deploy pattern
git diff HEAD^ HEAD --name-only | grep -E '^infra/k8s/base/|^infra/deploy-control\.yaml'
```

### Multiple workflows triggered simultaneously (both provision and deploy)

**This should NOT happen** due to cluster precedence logic.

**Check:**

1. Verify `trigger-deploy` job has condition: `cluster-changed != 'true'`
2. Check both `cluster-changed` and `deploy-changed` outputs in CI logs
3. If both are true, ONLY provision should trigger

**Expected behavior:**

- Cluster + deploy files change → ONLY provision triggers (then calls deploy)
- Deploy files only → ONLY deploy triggers
- Cluster files only → ONLY provision triggers (then calls deploy)

### Workflow appears when it shouldn't

**This should NOT happen with current architecture.** If provision/deploy workflows appear unnecessarily:

**Check:**

1. Verify CI workflow uses `gh workflow run` (not workflow_run)
2. Check `detect-infra-changes` job conditions (should be `if: github.event_name == 'push'`)
3. Verify trigger jobs have correct change detection conditions

**Expected behavior:**

- README.md change → ONLY CI appears
- src/ code change → ONLY CI appears
- infra/k8s/base/ change → CI + Deploy appear
- infra/k8s/hetzner/dev/cluster/ change → CI + Provision + Deploy appear

````

### Manual trigger doesn't work

**Check:**

```bash
# Ensure you have GITHUB_TOKEN or gh authenticated
gh auth status

# Try explicit trigger
gh workflow run deploy-k8s-resources.yml \
  --repo owner/repo \
  --ref dev \
  --field environment=dev

# Check workflow status
gh workflow list
```

**Common Issues:**

- Not authenticated → run `gh auth login`
- Wrong repository → use `--repo owner/repo`
- Wrong environment parameter → use `-f environment=dev` (not `-f env=dev`)

### CI triggers wrong environment

**Check branch-to-environment mapping:**

```yaml
# In ci.yml detect-infra-changes job
TARGET_ENV: ${{
  github.ref_name == 'main' && 'prod' ||
  github.ref_name == 'test' && 'test' ||
  'dev'
}}
```

**Expected mapping:**

- main branch → prod environment
- test branch → test environment
- dev branch (or any other) → dev environment

## References

- CI Workflow: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- Deploy Workflow: [.github/workflows/deploy-k8s-resources.yml](../../.github/workflows/deploy-k8s-resources.yml)
- Cluster Provisioning: [.github/workflows/provision-hetzner-k8s-cluster.yml](../../.github/workflows/provision-hetzner-k8s-cluster.yml)
- Deployment Control: [infra/deploy-control.yaml](../deploy-control.yaml)
- CI/CD Documentation: [docs/ci-cd.md](../../docs/ci-cd.md)
````
