# CI/CD Pipeline Documentation

This document describes the Continuous Integration and Continuous Deployment pipeline for the
polyglot monorepo.

## Overview

The CI pipeline is implemented using GitHub Actions and supports builds for Node.js/TypeScript,
Python, and .NET projects. The workflow is optimized for efficiency with a shared setup phase and
parallel language-specific jobs.

## Workflow Architecture

### Build Flow Visualization

**Pull Request (Nx Affected - Optimized):**

```
PR trigger
    ↓
setup-base (15s) ──┐
    ↓              │
  [wait]           │ (cache node_modules)
    ↓              │
┌───┴────┬────────┴────┐
│ node   │ python      │ dotnet
│ (30s)  │ (40s)       │ (25s)  ← Only affected projects
└────────┴─────────────┴────────
         ↓
    Total: ~55s (setup + longest affected job)

Time savings: 50-90% vs full suite
```

**Push to Main (Full Suite - Complete Validation):**

````
Push to main
    ↓
setup-base (15s) ──┐
    ↓              │
  [wait]           │ (cache node_modules)
    ↓              │
┌───┴────┬────────┴────┐
│ node   │ python      │ dotnet
│ (90s)  │ (120s)      │ (100s)  ← All projects tested
└────────┴─────────────┴────────
         ↓
    Total: ~135s (setup + longest job)

vs. previous matrix: ~150s (with redundant pnpm install)
```### Job Breakdown

#### 1. `setup-base` (Sequential)

**Purpose:** Install shared Node.js dependencies once and cache them for all language jobs.

**Steps:**

- Checkout code with full git history (for Nx affected commands)
- Set up Node.js 20.19.5
- Install pnpm dependencies (`pnpm install --frozen-lockfile`)
- Save `node_modules` to cache

**Duration:** ~10-15 seconds

**Benefits:**

- Eliminates redundant `pnpm install --frozen-lockfile` across multiple jobs
- Reduces total CI time by 30-60 seconds per run
- Single source of truth for Node.js tooling

#### 2. `node` (Parallel)

**Purpose:** Build, test, and validate all Node.js/TypeScript projects.

**Steps:**

1. Checkout code
2. Set up Node.js 20.19.5
3. Restore cached `node_modules` from `setup-base`
4. Cache Nx computation cache
5. Run Nx repair and reset
6. Check code formatting (`nx format:check`)
7. Lint projects (`nx:node-lint`)
8. Run tests (`nx:node-test`)
9. Build projects (`nx:node-build`)
10. Upload artifacts (dist, coverage, test results)

**Dependencies:** Waits for `setup-base` to complete

#### 3. `python` (Parallel)

**Purpose:** Build, test, and validate all Python projects.

**Steps:**

1. Checkout code
2. Set up Python 3.10
3. Cache pip packages
4. Set up Node.js 20.19.5
5. Restore cached `node_modules` from `setup-base`
6. Cache Nx computation cache
7. Set up Python virtual environment (`python:env`)
8. Run Nx repair and reset
9. Check code formatting (`black --check`)
10. Lint projects (Flake8, mypy via `nx:python-lint`)
11. Run tests (`nx:python-test`)
12. Build projects (`nx:python-build`)
13. Upload artifacts (dist, coverage, test results)

**Dependencies:** Waits for `setup-base` to complete

#### 4. `dotnet` (Parallel)

**Purpose:** Build, test, and validate all .NET projects.

**Steps:**

1. Checkout code
2. Set up .NET SDK 8.0
3. Cache NuGet packages
4. Set up Node.js 20.19.5
5. Restore cached `node_modules` from `setup-base`
6. Cache Nx computation cache
7. Set up .NET environment (`dotnet:env`)
8. Run Nx repair and reset
9. Check code formatting (`dotnet format --verify-no-changes`)
10. Lint projects (`nx:dotnet-lint`)
11. Run tests (`nx:dotnet-test`)
12. Build projects (`nx:dotnet-build`)
13. Upload artifacts (dist, coverage, test results)

**Dependencies:** Waits for `setup-base` to complete

## Performance Optimizations

### 1. Concurrency Control

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
````

- Automatically cancels outdated workflow runs when new commits are pushed
- Prevents wasted CI minutes on superseded commits
- Provides faster feedback on latest changes

### 2. Dependency Caching

**Node.js:**

- `node_modules` cached and shared across all jobs
- pnpm cache automatically managed by `setup-node` action

**Python:**

- pip cache stored at `~/.cache/pip`
- Key includes requirements file hashes for proper invalidation

**.NET:**

- NuGet packages cached at `~/.nuget/packages`
- Key includes `.csproj` and central package management files

**Nx:**

- Computation cache stored at `.nx/cache`
- Unified cache key across all languages (composite hash of pnpm-lock.yaml, uv.lock, \*.csproj)
- Enables cross-language cache sharing (e.g., Python job reuses Node.js affected computations)
- Restore keys allow fallback to OS-level cache

### 3. Nx Affected Optimization (PR-Specific)

**Pull Requests** use intelligent change detection to run only affected projects:

```bash
# Dynamically compares against the target branch (dev, test, or main)
pnpm exec nx affected --base=origin/${{ github.base_ref }} --head=HEAD --target=test --projects=tag:runtime:node
```

**Push to main/dev/test** runs the full test suite for all projects:

```bash
# Test all projects
pnpm run nx:node-test
```

**How it works:**

1. Nx analyzes the dependency graph of your monorepo
2. For PRs: Compares PR branch (`HEAD`) against **target branch** (`github.base_ref` - could be dev,
   test, or main)
3. For pushes: Runs full suite on the pushed branch
4. Identifies which projects are affected by the changes
5. Runs targets (test/lint/build) only for affected projects (PRs) or all projects (pushes)

**Benefits:**

- **Faster PR feedback:** 50-90% time reduction when only a few projects change
- **Resource efficiency:** Avoids redundant computation on unchanged code
- **Maintains correctness:** Full suite still runs on main branch merges

**Example scenarios:**

| Change                   | Target Branch | Affected Projects       | PR Time | Push Time |
| ------------------------ | ------------- | ----------------------- | ------- | --------- |
| Edit single Node.js app  | dev           | 1 app + dependencies    | ~30s    | ~90s      |
| Update shared Python lib | test          | Multiple dependent apps | ~60s    | ~120s     |
| Change only docs         | main          | None (skip jobs)        | ~10s    | ~135s     |
| Major refactor           | any           | All projects            | ~135s   | ~135s     |

### 4. Parallel Execution

After the shared `setup-base` job completes:

- Node.js, Python, and .NET jobs run **simultaneously**
- Total workflow time = setup time + longest individual job
- No blocking dependencies between language jobs

### 5. Format Checking (Not Formatting)

All language jobs run format **checks** rather than automatic formatting:

- **Node.js:** `nx format:check` (fails if formatting needed)
- **Python:** `black --check` (fails if formatting needed)
- **.NET:** `dotnet format --verify-no-changes` (fails if formatting needed)

This enforces code style discipline and prevents masking formatting issues.

## Continuous Deployment

### CD Architecture

**CI-driven selective triggering system** ensures workflows only appear when they have relevant work
to do:

```
ci.yml (quality checks + change detection)
    ↓ (gh workflow run - explicit triggering)
    ├─→ provision-hetzner-k8s-cluster.yml (if cluster files changed)
    │       ↓ (workflow_call)
    │   deploy-k8s-resources.yml (after cluster ready)
    │
    └─→ deploy-k8s-resources.yml (if deploy files changed, cluster files unchanged)
```

### Workflow Orchestration

**Three workflows with clear separation of concerns:**

1. `ci.yml` - Quality checks + change detection + workflow triggering
2. `provision-hetzner-k8s-cluster.yml` - Cluster creation (triggered by CI)
3. `deploy-k8s-resources.yml` - Resource deployment (triggered by CI or Provision)

**Key Principle:** CI detects which workflows need to run AFTER quality checks pass, then explicitly
triggers ONLY those workflows via GitHub CLI.

### deploy-k8s-resources.yml (Primary Deployment)

**Triggers:**

1. **workflow_dispatch** (manual deployment with environment selection)
2. **workflow_call** (called by cluster provisioning after cluster creation)
3. **Explicit from CI** (via `gh workflow run` after quality checks pass)

**Job Flow:**

```yaml
on:
  workflow_dispatch:
    inputs:
      environment: { required: true, type: choice, options: [dev, test, prod] }
  workflow_call:
    inputs:
      environment: { required: true, type: string }

jobs:
  deploy-{dev,test,prod}:
    if: |
      (github.event_name == 'workflow_dispatch' && 
       github.event.inputs.environment == '{env}') ||
      (github.event_name == 'workflow_call' && 
       inputs.environment == '{env}')
```

### provision-hetzner-k8s-cluster.yml (Cluster Lifecycle)

**Triggers:**

1. **workflow_dispatch** (manual cluster provisioning)
2. **Explicit from CI** (via `gh workflow run` after quality checks pass)

**Job Flow:**

```yaml
on:
  workflow_dispatch:
    inputs:
      environment: { required: true, type: choice, options: [dev, test, prod] }

jobs:
  update-{dev,test,prod}-cluster:
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.environment == '{env}'
```

**Composite Action Sequence:**

1. Install kubectl, Helm, hetzner-k3s CLI
2. Setup SSH keys from GitHub Secrets
3. Substitute secrets in cluster-config.yaml
4. Create/update cluster (includes cert-manager v1.13.3 installation)
5. Wait for cluster readiness (nodes, CSI driver, StorageClass)
6. Verify cert-manager installation
7. Upload KUBECONFIG to GitHub environment secrets
8. **Trigger deploy-k8s-resources.yml** via workflow_dispatch

**Automatic cert-manager Installation:**

cert-manager v1.13.3 + `letsencrypt-prod` ClusterIssuer installed during cluster provisioning via
`additional_post_k3s_commands` in cluster-config.yaml:

- Runs on first master node only (prevents race conditions)
- Waits for deployment readiness (180s timeout)
- Creates ClusterIssuer inline (no separate manifest files)
- Certificates auto-provisioned when Ingress resources deployed (~2-5 min via ACME HTTP-01)

### ci.yml (Primary Entry Point)

**Triggers:**

1. **Push to dev/test/main**
2. **Pull requests** targeting dev/test/main

**Job Flow:**

```yaml
on:
  push:
    branches: [main, test, dev]
  pull_request:
    branches: [main, test, dev]

permissions:
  actions: write # Required to trigger workflows via gh workflow run
  contents: read

jobs:
  # 1. Quality checks (lint, test, build)
  node: ...
  python: ...
  dotnet: ...

  # 2. Detect infrastructure changes (only on push, after quality checks pass)
  detect-infra-changes:
    needs: [node, python, dotnet]
    if: github.event_name == 'push'
    outputs:
      cluster-changed: ${{ steps.detect.outputs.cluster-changed }}
      deploy-changed: ${{ steps.detect.outputs.deploy-changed }}
    steps:
      - name: Detect changes
        run: |
          # Cluster changes: infra/k8s/hetzner/*/cluster/, provision workflow/action
          git diff HEAD^ HEAD --name-only | grep -E "pattern" && echo "cluster-changed=true"

          # Deploy changes: infra/k8s/base/, deploy-control.yaml, patches/, deploy workflow/action
          git diff HEAD^ HEAD --name-only | grep -E "pattern" && echo "deploy-changed=true"

  # 3. Trigger provision ONLY if cluster files changed
  trigger-provision:
    needs: [detect-infra-changes]
    if: needs.detect-infra-changes.outputs.cluster-changed == 'true'
    steps:
      - name: Trigger provision workflow
        run: |
          gh workflow run provision-hetzner-k8s-cluster.yml \
            --repo ${{ github.repository }} \
            --ref ${{ github.ref_name }} \
            --field environment=${{ env.TARGET_ENV }}

  # 4. Trigger deploy ONLY if deploy files changed (and cluster didn't change)
  trigger-deploy:
    needs: [detect-infra-changes]
    if: |
      needs.detect-infra-changes.outputs.deploy-changed == 'true' &&
      needs.detect-infra-changes.outputs.cluster-changed != 'true'
    steps:
      - name: Trigger deploy workflow
        run: |
          gh workflow run deploy-k8s-resources.yml \
            --repo ${{ github.repository }} \
            --ref ${{ github.ref_name }} \
            --field environment=${{ env.TARGET_ENV }}
```

### Deployment Scenarios

**1. Cluster files change** (`infra/k8s/hetzner/*/cluster/`, provision workflow, provision action):

```
Push to dev branch
    ↓
CI runs (quality checks: lint, test, build)
    ↓
detect-infra-changes job (cluster-changed=true)
    ↓
trigger-provision job runs
    ↓
provision-hetzner-k8s-cluster.yml triggered via gh workflow run
    ↓
Cluster created/updated
    ↓
Provision triggers deploy-k8s-resources.yml via workflow_call
    ↓
Resources deployed to new cluster
```

**Result:** ONLY Provision workflow appears in Actions (then Deploy when Provision completes)

**2. Deploy files change** (`infra/k8s/base/`, `deploy-control.yaml`, `patches/`, deploy workflow,
deploy action):

```
Push to dev branch
    ↓
CI runs (quality checks)
    ↓
detect-infra-changes job (deploy-changed=true, cluster-changed=false)
    ↓
trigger-deploy job runs
    ↓
deploy-k8s-resources.yml triggered via gh workflow run
    ↓
Resources deployed
```

**Result:** ONLY Deploy workflow appears in Actions

**3. Both cluster + deploy files change**:

```
Push to dev branch
    ↓
CI runs (quality checks)
    ↓
detect-infra-changes job (cluster-changed=true, deploy-changed=true)
    ↓
trigger-provision job runs (trigger-deploy skipped due to cluster precedence)
    ↓
Provision workflow runs → triggers Deploy via workflow_call
```

**Result:** ONLY Provision workflow appears (then Deploy)  
**Why:** Cluster changes take precedence; trigger-deploy condition excludes when
cluster-changed=true

**4. Unrelated files change** (`README.md`, `src/`, `docs/`):

```
Push to dev branch
    ↓
CI runs (quality checks)
    ↓
detect-infra-changes job (cluster-changed=false, deploy-changed=false)
    ↓
No trigger jobs run
```

**Result:** ONLY CI workflow appears in Actions

**5. Provision workflow files change** (`.github/workflows/provision-hetzner-k8s-cluster.yml`,
`.github/actions/provision-hetzner-k8s-cluster/`):

```
Push to dev branch
    ↓
CI runs (quality checks)
    ↓
detect-infra-changes job (cluster-changed=true - workflow files match pattern)
    ↓
trigger-provision job runs
    ↓
Provision workflow runs (validates workflow changes)
```

**Result:** Provision workflow appears (validates workflow changes)

**6. Deploy workflow files change** (`.github/workflows/deploy-k8s-resources.yml`,
`.github/actions/deploy-k8s-resources/`):

```
Push to dev branch
    ↓
CI runs (quality checks)
    ↓
detect-infra-changes job (deploy-changed=true - workflow files match pattern)
    ↓
trigger-deploy job runs
    ↓
Deploy workflow runs (validates workflow changes)
```

**Result:** Deploy workflow appears (validates workflow changes)

### Key Design Decisions

- **Explicit triggering**: CI uses `gh workflow run` to trigger provision/deploy ONLY when needed
- **No unnecessary workflows**: Workflows only appear when they have work to do
- **CI always enforced**: Quality checks MUST pass before any infrastructure operations
- **Cluster takes precedence**: If both cluster and deploy change, only provision is triggered
  (provision will trigger deploy)
- **Security-first**: Prevents deploying untested code; CI gates all infrastructure workflows
- **Clean UI**: No workflow_run triggers that always appear regardless of relevance

### Deployment Control System

**Hierarchical flag system** (`infra/deploy-control.yaml`):

```yaml
global:
  auto_deploy: true # Master kill switch

environments:
  dev:
    enabled: true # Environment can deploy
    auto_deploy: true # Auto-deploy on push
    services:
      postgres:
        enabled: true
        auto_deploy: true
        rollback_on_failure: false

deployment_strategies:
  statefulset:
    timeout: '10m'
    rollback_on_failure: true
```

**10+ flags enforced:**

- `enabled` (environment + service)
- `auto_deploy` (environment + service)
- `deployment_windows` (time restrictions)
- `rollback_on_failure` (service OR strategy - combined OR logic)
- `statefulset_timeout`, `deployment_timeout`, `daemonset_timeout`

**Workflow integration:** Each deploy job parses flags and exits early if disabled (before loading
credentials).

### Workflow Orchestration Patterns

**Why cluster precedence matters:**

Without cluster-precedence logic in trigger-deploy condition:

```
User changes cluster config + base manifests
    ↓
Both workflows trigger simultaneously:
    ├── provision-hetzner (creates NEW cluster)
```

User changes cluster config + base manifests ↓ CI triggers BOTH provision and deploy workflows: ├──
provision-hetzner (creates NEW cluster) └── deploy-k8s-resources (deploys to OLD cluster - race
condition!) Result: Resources deployed to wrong cluster!

```

With cluster-precedence logic (`trigger-deploy` condition: `cluster-changed != 'true'`):

```

User changes cluster config + base manifests ↓ CI triggers ONLY provision: ├── Creates new cluster
└── Calls deploy-k8s-resources via workflow_call (deploys to NEW cluster) Result: Resources deployed
to correct cluster ✓

```

**Why CI gating matters:**

Before explicit CI triggering:

```

User pushes broken code ↓ deploy-k8s-resources triggers ↓ Broken code deployed to production

```

After CI gating (explicit triggering):

```

User pushes broken code ↓ CI runs → FAILS ↓ Provisioning/deployment never triggered (gh workflow run
never executes) Result: Broken code blocked ✓

````

**Why explicit triggering matters:**

With workflow_run (old approach):

```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: ["completed"]

# Problem: Workflows ALWAYS appear in Actions UI after EVERY CI run
# Even when no infrastructure changes exist (UI clutter)
````

With explicit triggering (current approach):

```yaml
# CI detects changes first
detect-infra-changes:
  outputs:
    cluster-changed: ${{ steps.detect.outputs.cluster-changed }}
    deploy-changed: ${{ steps.detect.outputs.deploy-changed }}

# Only trigger relevant workflows
trigger-provision:
  if: needs.detect-infra-changes.outputs.cluster-changed == 'true'
# Result: Workflows ONLY appear when they have work to do ✓
```

````

**Why it works:**

- **CI gating**: All infrastructure workflows triggered ONLY after quality checks pass
- **Change detection**: git diff patterns detect cluster/deploy file changes
- **Cluster precedence**: If both change, only provision triggers (deploy follows via workflow_call)
- **Clean UI**: Workflows only appear when relevant
- **Security**: Broken code blocked at CI, never reaches infrastructure workflows

### Manual Deployment

```bash
# Deploy resources only (requires existing cluster)
gh workflow run deploy-k8s-resources.yml -f environment=dev

# Provision cluster + deploy resources (recreates cluster)
gh workflow run provision-hetzner-k8s-cluster.yml -f environment=dev

# Via GitHub UI
# Actions → Select workflow → Run workflow → Select environment
````

**CRITICAL:** Manual cluster provisioning is destructive (recreates cluster). Use
deploy-k8s-resources.yml for updates.

## Triggers

### Supported Branches

The CI workflow runs on the following branches:

- **`main`** - Production branch (full validation required)
- **`test`** - Testing/staging branch (full validation before merging to main)
- **`dev`** - Development branch (continuous integration for active development)

To add or remove branches, update the workflow trigger configuration:

```yaml
on:
  push:
    branches:
      - main
      - dev
      - test
      # Add additional branches here
  pull_request:
    branches:
      - main
      - dev
      - test
      # Add additional branches here
```

### Push Events

- Runs on pushes to `main`, `dev`, or `test` branches
- Executes **full test suite** for all languages (all projects tested)
- Uploads build artifacts
- Ensures branch integrity before merges

### Pull Request Events

- Runs on PRs targeting `main`, `dev`, or `test` branches
- Uses **Nx affected** to test only changed projects (optimized)
- Dynamically compares against target branch (`github.base_ref`)
- Provides fast feedback on PR status page

**Examples:**

- PR from `feature/auth` → `dev`: Compares against `origin/dev`
- PR from `dev` → `test`: Compares against `origin/test`
- PR from `test` → `main`: Compares against `origin/main`

## Artifacts

Each language job uploads build artifacts with 7-day retention:

**Node.js artifacts** (`build-artifacts-node`):

- `dist/` - Compiled JavaScript/TypeScript output
- `coverage/` - Test coverage reports
- `test-results/` - Test output files

**Python artifacts** (`build-artifacts-python`):

- `dist/` - Built Python packages
- `coverage/` - Test coverage reports
- `test-results/` - pytest output files

**.NET artifacts** (`build-artifacts-dotnet`):

- `dist/` - Compiled assemblies
- `coverage/` - Test coverage reports
- `test-results/` - xUnit/MSTest output files

## Quality Gates

Current quality checks enforced by CI:

### Formatting

- ✅ Code must be properly formatted before merge
- ✅ Format checks fail if any files need formatting

### Linting

- ✅ All linter rules must pass (ESLint, Flake8, StyleCop)
- ⚠️ Currently allows "No X projects found" fallback (will be removed when sample projects are
  added)

### Testing

- ✅ All tests must pass
- ⚠️ No coverage thresholds enforced yet

### Building

- ✅ All projects must build successfully
- ✅ No compilation errors allowed

## Future Enhancements

### Planned Improvements

**Short-term (1-2 weeks):**

1. Test result reporting with JUnit/TRX parsers
2. Coverage thresholds and badge generation
3. Security scanning (pnpm audit, pip-audit, dotnet list package --vulnerable)
4. Remove "No projects found" fallback guards after adding sample projects

**Medium-term (1-3 months):**

5. ~~Nx affected commands for PR optimization (only test changed projects)~~ ✅ **IMPLEMENTED**
6. Code coverage reporting on PRs with coverage diff
7. CodeQL security scanning workflow
8. Release automation workflow with semantic versioning
9. Deployment workflows for staging/production

**Long-term (3+ months):**

10. Nx Cloud integration for distributed task execution
11. Performance benchmarking and regression detection
12. Automated dependency updates with Dependabot
13. SBOM (Software Bill of Materials) generation

## Troubleshooting

### Common Issues

**Issue:** Nx affected not detecting changes correctly

- **Solution:** Ensure `fetch-depth: 0` is set in checkout action for full git history
- **Solution:** Verify base branch reference is correct (should be `origin/dev`, `origin/test`, or
  `origin/main`)
- **Solution:** Check that Nx workspace is properly configured with project dependencies

**Issue:** PR shows "No affected projects" but changes were made

- **Solution:** Changes may be in non-project files (docs, configs)
- **Solution:** Verify project is registered in workspace and has proper tags
- **Solution:** Check if `.nxignore` is excluding changed paths
- **Solution:** Ensure target branch (`github.base_ref`) exists and is up to date

**Issue:** CI not running on my branch

- **Solution:** Verify your branch is listed in the workflow triggers (main, dev, test)
- **Solution:** Add your branch to `.github/workflows/ci.yml` under `on.push.branches` and
  `on.pull_request.branches`

**Issue:** `node_modules` cache not restoring

- **Solution:** Check that `pnpm-lock.yaml` exists and is committed
- **Solution:** Verify cache key matches between `setup-base` and language jobs

**Issue:** Python formatting check fails with "No such file"

- **Solution:** Ensure `.venv/bin/black` path is correct (may need `Scripts/black` on Windows
  runners)

**Issue:** Jobs stuck in "waiting" state

- **Solution:** Check `setup-base` job logs for failures
- **Solution:** Verify `needs: setup-base` dependency is correct

**Issue:** Nx cache not speeding up builds

- **Solution:** Ensure `.nx/cache` is not in `.gitignore`
- **Solution:** Check cache key includes correct file hashes

## Quality Checks

The repository uses a **two-tier validation system** to balance speed with safety:

### The Two-Tier System

**Tier 1: Pre-Commit Hook (Fast - Automatic)**

- **Trigger**: Runs automatically on `git commit`
- **Checks**: Format + Lint + Type Check
- **Scope**: Affected projects only
- **Time**: ~5-15 seconds
- **Purpose**: Catch obvious issues without slowing commit workflow
- **Auto-setup**: Creates Python virtual environment only if Python projects are affected

**Tier 2: Pre-Push Hook (Comprehensive - Automatic)**

- **Trigger**: Runs automatically on `git push`
- **Checks**: Format + Lint + Type + **Test** + **Build**
- **Scope**: Affected projects (feature branch) or All projects (base branch)
- **Time**: ~30s-2 minutes
- **Purpose**: Ensure code will pass CI before pushing to remote
- **Auto-setup**: Creates Python virtual environment only if Python projects are affected

### Manual Commands

```bash
# Full validation (same as pre-push hook)
pnpm run pre-push

# Quick validation (same as pre-commit hook)
pnpm run pre-commit

# Individual language checks (fast, uses cached nx state)
pnpm run nx:node-lint       # Lint Node.js projects
pnpm run nx:python-test     # Test Python projects
pnpm run nx:dotnet-build    # Build .NET projects

# Reset nx cache (run after structural changes)
pnpm run nx:reset
```

### Performance Optimization

The validation system is architected for optimal performance and to avoid file modifications during
git operations:

**Git Hooks (Automatic - Pre-Commit & Pre-Push):**

- **Skip `nx:reset`** to prevent modifying workspace files during commit/push
- Validate against current workspace state (fast, ~5-30s)
- No file modifications means no unstaged changes after commit
- Runs with `--skip-reset` flag

**Manual Validation (`pnpm run pre-commit` and `pnpm run pre-push`):**

- **Runs `nx:reset` once** at the start to ensure clean, accurate state
- Then executes all checks without redundant resets
- Total: 1 reset per session vs previous 20+ resets = **massive speed improvement**
- Use these before creating PRs or when you want guaranteed clean validation

**Individual Commands (`pnpm run nx:node-lint`, etc.):**

- **Skip reset** for instant execution during development
- Use cached nx state for faster iteration
- If structural changes made, run `pnpm run nx:reset` manually first

**Why this matters:**

- `nx:reset` runs repair, cache clearing, and auto-tagging (~5-10s overhead)
- Git hooks must not modify files (prevents unstaged changes during commits)
- Manual validation needs clean state for accurate results
- Individual commands need speed for tight feedback loops

**Example workflows:**

```bash
# During development - instant feedback
pnpm run nx:node-lint              # Fast, uses cache

# Committing code - automatic validation
git commit                        # Hook runs with --skip-reset, no file changes

# Before PR - thorough validation with clean state
pnpm run pre-push                  # Runs reset once, full clean validation

# After structural changes (new project, dependencies, etc.)
pnpm run nx:reset                  # Refresh project graph
pnpm run nx:node-lint              # Now has fresh state
```

### How It Works

**Intelligent Detection:**

Both the git hooks and manual commands automatically detect your current branch:

1. **On Feature Branches** (e.g., `feature/add-login`):
   - Runs checks on **affected projects only**
   - Compares against upstream branch (or auto-detects origin/dev, origin/test, origin/main)
   - Mimics what CI will check on a Pull Request
   - Fast feedback for iterative development

2. **On Base Branches** (`main`, `dev`, `test`):
   - Runs checks on **all projects**
   - Mimics what CI will check on push to base branch
   - Ensures complete validation before merging

### What Gets Checked

**Language-Specific Intelligence:**

The validation scripts only run checks for languages with affected projects:

- **Node.js**: Always runs (workspace configs, tooling)
- **Python**: Only runs if Python projects are affected
  - Auto-creates virtual environment if missing
  - Skips entirely if no Python projects affected
- **.NET**: Only runs if .NET projects are affected
  - Checks if .NET SDK is installed
  - Skips entirely if no .NET projects affected

This means if you only change Node.js files, you won't waste time setting up Python or checking .NET
projects.

**Pre-Commit Hook (Quick):**

- ✅ Format Check (Prettier, Black, dotnet format)
- ✅ Lint (ESLint, Flake8, StyleCop)
- ✅ Type Check (TypeScript, mypy)
- ⏭️ Tests (skipped for speed)
- ⏭️ Build (skipped for speed)

**Pre-Push Hook + `pnpm run pre-push` (Full):**

- ✅ Format Check (Prettier, Black, dotnet format)
- ✅ Lint (ESLint, Flake8, StyleCop)
- ✅ Type Check (TypeScript, mypy)
- ✅ Tests (Jest, pytest, xUnit)
- ✅ Build (tsc, Python packaging, dotnet build)

**CI/CD:**

- ✅ Same as Pre-Push Hook (identical validation)

### Example Workflow

```bash
# 1. Create feature branch
git checkout -b feature/new-feature

# 2. Make changes and commit
git add .
git commit -m "Add new feature"
# ⚡ Pre-commit hook runs automatically (fast checks ~5-15s)

# 3. Before pushing - optionally run full check manually
pnpm run pre-push
# 🔍 Same validation that pre-push hook will run

# 4. Push to remote
git push origin feature/new-feature
# 🛡️ Pre-push hook runs automatically (full checks ~30s-2min)
# If this passes, CI will pass too!
```

### When to Use Manual Commands

**Use `pnpm run pre-commit`:**

- Before committing if you bypassed the pre-commit hook (`git commit --no-verify`)
- Quick sanity check during development
- Faster feedback loop while iterating

**Use `pnpm run pre-push`:**

- Before creating a Pull Request
- To preview what pre-push hook will check
- After resolving merge conflicts
- When you want full validation without pushing

### Troubleshooting

**"Python environment not set up"**

```bash
pnpm run python:env
```

**".NET SDK not found"**

- Install .NET SDK 8.0 or higher from https://dotnet.microsoft.com/download

**"Could not detect base branch"**

- The script will default to origin/main
- For best results, set upstream when pushing:
  ```bash
  git push -u origin feature/my-feature
  ```

**Want to bypass a git hook temporarily?**

```bash
# Skip pre-commit hook (not recommended)
git commit --no-verify

# Skip pre-push hook (not recommended)
git push --no-verify
```

**Note:** Bypassing hooks means you skip validation. Use `pnpm run pre-commit` or
`pnpm run pre-push` manually instead.

**Format check fails**

- Run the appropriate format command:
  - **All files (workspace + projects):** `pnpm run nx:workspace-format`
  - **Node.js projects only:** `pnpm run nx:node-format`
  - **Python projects only:** `pnpm run nx:python-format`
  - **.NET projects only:** `pnpm run nx:dotnet-format`

> **Tip:** Use `nx:workspace-format` to format all files including repo-level files (scripts/,
> docs/, package.json, etc.). Use project-specific format commands when working on individual
> projects.

**Want to see what will be checked?**

```bash
# On feature branch - see affected projects
pnpm exec nx affected:graph

# On any branch - see all projects
pnpm exec nx graph
```

### Best Practices

1. **Let git hooks do their job** - Don't bypass with `--no-verify`
2. **Trust the automatic mode detection** - It matches CI behavior exactly
3. **Set upstream branches** for best auto-detection:
   ```bash
   git push -u origin feature/my-feature
   ```
4. **Run `pnpm run check` before creating PRs** - Preview full validation
5. **Fix issues immediately** - Don't accumulate technical debt
6. **Pre-push hook = CI preview** - If pre-push passes, CI passes

## Monitoring and Metrics

To view CI/CD metrics:

1. Navigate to **Actions** tab in GitHub repository
2. Select **CI** workflow
3. Review workflow run history and timing data

Key metrics to track:

- Average workflow duration
- Cache hit rates
- Failure rates by job type
- Artifact sizes
