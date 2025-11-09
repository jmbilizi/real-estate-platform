# CI/CD Pipeline Documentation

This document describes the Continuous Integration and Continuous Deployment pipeline for the polyglot monorepo.

## Overview

The CI pipeline is implemented using GitHub Actions and supports builds for Node.js/TypeScript, Python, and .NET projects. The workflow is optimized for efficiency with a shared setup phase and parallel language-specific jobs.

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

vs. previous matrix: ~150s (with redundant npm ci)
```### Job Breakdown

#### 1. `setup-base` (Sequential)

**Purpose:** Install shared Node.js dependencies once and cache them for all language jobs.

**Steps:**

- Checkout code with full git history (for Nx affected commands)
- Set up Node.js 20.19.5
- Install npm dependencies (`npm ci`)
- Save `node_modules` to cache

**Duration:** ~10-15 seconds

**Benefits:**

- Eliminates redundant `npm ci` across multiple jobs
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
7. Set up Python virtual environment (`py:setup-dev`)
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
7. Set up .NET environment (`dotnet:setup`)
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
- npm cache automatically managed by `setup-node` action

**Python:**

- pip cache stored at `~/.cache/pip`
- Key includes requirements file hashes for proper invalidation

**.NET:**

- NuGet packages cached at `~/.nuget/packages`
- Key includes `.csproj` and central package management files

**Nx:**

- Computation cache stored at `.nx/cache`
- Language-specific keys prevent cache pollution
- Restore keys allow fallback to OS-level cache

### 3. Nx Affected Optimization (PR-Specific)

**Pull Requests** use intelligent change detection to run only affected projects:

```bash
# Dynamically compares against the target branch (dev, test, or main)
npx nx affected --base=origin/${{ github.base_ref }} --head=HEAD --target=test --projects=tag:node
```

**Push to main/dev/test** runs the full test suite for all projects:

```bash
# Test all projects
npm run nx:node-test
```

**How it works:**

1. Nx analyzes the dependency graph of your monorepo
2. For PRs: Compares PR branch (`HEAD`) against **target branch** (`github.base_ref` - could be dev, test, or main)
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
- ⚠️ Currently allows "No X projects found" fallback (will be removed when sample projects are added)

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
3. Security scanning (npm audit, pip-audit, dotnet list package --vulnerable)
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
- **Solution:** Verify base branch reference is correct (should be `origin/dev`, `origin/test`, or `origin/main`)
- **Solution:** Check that Nx workspace is properly configured with project dependencies

**Issue:** PR shows "No affected projects" but changes were made

- **Solution:** Changes may be in non-project files (docs, configs)
- **Solution:** Verify project is registered in workspace and has proper tags
- **Solution:** Check if `.nxignore` is excluding changed paths
- **Solution:** Ensure target branch (`github.base_ref`) exists and is up to date

**Issue:** CI not running on my branch

- **Solution:** Verify your branch is listed in the workflow triggers (main, dev, test)
- **Solution:** Add your branch to `.github/workflows/ci.yml` under `on.push.branches` and `on.pull_request.branches`

**Issue:** `node_modules` cache not restoring

- **Solution:** Check that `package-lock.json` exists and is committed
- **Solution:** Verify cache key matches between `setup-base` and language jobs

**Issue:** Python formatting check fails with "No such file"

- **Solution:** Ensure `.venv/bin/black` path is correct (may need `Scripts/black` on Windows runners)

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
npm run check

# Quick validation (same as pre-commit hook)
npm run check:quick
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

This means if you only change Node.js files, you won't waste time setting up Python or checking .NET projects.

**Pre-Commit Hook (Quick):**

- ✅ Format Check (Prettier, Black, dotnet format)
- ✅ Lint (ESLint, Flake8, StyleCop)
- ✅ Type Check (TypeScript, mypy)
- ⏭️ Tests (skipped for speed)
- ⏭️ Build (skipped for speed)

**Pre-Push Hook + `npm run check` (Full):**

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
npm run check
# 🔍 Same validation that pre-push hook will run

# 4. Push to remote
git push origin feature/new-feature
# 🛡️ Pre-push hook runs automatically (full checks ~30s-2min)
# If this passes, CI will pass too!
```

### When to Use Manual Commands

**Use `npm run check:quick`:**

- Before committing if you bypassed the pre-commit hook (`git commit --no-verify`)
- Quick sanity check during development
- Faster feedback loop while iterating

**Use `npm run check`:**

- Before creating a Pull Request
- To preview what pre-push hook will check
- After resolving merge conflicts
- When you want full validation without pushing

### Troubleshooting

**"Python environment not set up"**

```bash
py-env.bat create
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

**Note:** Bypassing hooks means you skip validation. Use `npm run check:quick` or `npm run check` manually instead.

**Format check fails**

- Run the appropriate format command:
  - Node: `npm run nx:node-format`
  - Python: `npm run nx:python-format`
  - .NET: `npm run nx:dotnet-format`

**Want to see what will be checked?**

```bash
# On feature branch - see affected projects
npx nx affected:graph

# On any branch - see all projects
npx nx graph
```

### Best Practices

1. **Let git hooks do their job** - Don't bypass with `--no-verify`
2. **Trust the automatic mode detection** - It matches CI behavior exactly
3. **Set upstream branches** for best auto-detection:
   ```bash
   git push -u origin feature/my-feature
   ```
4. **Run `npm run check` before creating PRs** - Preview full validation
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
