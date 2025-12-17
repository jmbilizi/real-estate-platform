# Copilot Instructions - Polyglot Monorepo

## Architecture Overview

This is an **Nx-powered polyglot monorepo** supporting Node.js/TypeScript, Python, and .NET projects with unified workflows, Git hooks, and CI/CD. The workspace uses **plugin-based inference** where Nx automatically detects projects and generates targets without manual configuration.

**Key Structural Decisions:**

- **Empty `apps/` and `libs/`**: Projects are created on-demand using Nx generators or standard tooling
- **Auto-tagging system**: All projects automatically tagged by language (`node`, `python`, `dotnet`) and type (`api`, `service`, `lib`) based on their executors
- **Unified Git hooks**: Two-tier validation (pre-commit: fast checks, pre-push: full suite) with intelligent language detection
- **Centralized configs**: All language-specific configurations in `tools/{language}/configs/`

## Critical Workflows

### Creating New Projects

**NEVER create projects manually**. Use Nx generators or standard tooling:

```bash
# Node.js/TypeScript - Use Nx generators
npx nx generate @nx/express:app my-api --directory=apps
npx nx generate @nx/next:app my-web --directory=apps
npx nx generate @nx/node:lib shared-utils --directory=libs

# Python - Use Nx generators (requires Poetry or UV installed)
npx nx generate @nxlv/python:poetry-project my-service --directory=apps
npx nx generate @nxlv/python:uv-project my-service --directory=apps
npx nx generate @nxlv/python:poetry-project utils --directory=libs --projectType=library

# .NET - Use standard dotnet CLI (auto-detected by @nx/dotnet)
dotnet new webapi -n MyApi -o apps/my-api
dotnet new classlib -n MyLib -o libs/my-lib

# After creating ANY project, run this to sync solution files and auto-tag
npm run nx:reset
```

**Why**: `nx:reset` runs three critical operations:

1. `nx:repair` - Validates Nx configuration
2. `nx reset` - Clears computation cache
3. `dotnet:setup-projects` - Syncs .NET solution files
4. `auto-tag-projects.js` - Auto-tags projects for `--projects=tag:*` filtering

### Running Commands

**Pattern**: Use `npm run nx:{language}-{target}` for language-specific bulk operations:

```bash
# Language-specific commands (all projects of that type)
npm run nx:node-lint          # Lint all Node.js projects
npm run nx:python-test        # Test all Python projects
npm run nx:dotnet-build       # Build all .NET projects

# Individual project
npx nx test my-api            # Test specific project
npx nx build my-service       # Build specific project

# Affected projects (automatically uses correct base branch)
npx nx affected --target=test
```

**CRITICAL**: The `safe-run-many.js` wrapper handles "no projects found" gracefully. Commands won't fail in CI if no projects of that type exist yet.

### Nx Reset vs Repair

**Use `npm run nx:reset` when:**

- After creating/deleting projects (syncs solution files + auto-tags)
- Before running affected commands in CI
- Build behavior is inconsistent (clears cache)
- After major dependency updates

**Skip reset for:**

- Git hooks (uses `--skip-reset` flag to avoid file modifications during commit)
- Individual development commands (`nx build`, `nx test`) - Nx manages cache automatically
- Rapid iteration - reset adds ~5-10s overhead

**Pattern in scripts**: Manual validation commands (`npm run pre-commit`, `npm run pre-push`) run reset once at start; git hooks skip it entirely.

## Git Hooks & Validation

### Two-Tier System

**Pre-Commit (Fast - ~5-15s with projects, <1s empty workspace)**

- Format + Lint + Type Check only
- Runs on affected projects
- Auto-creates Python venv only if Python projects affected
- **Kustomize validation**: Full build validation if `infra/k8s/**/*.yaml` files changed
- Uses `--skip-reset` flag (no workspace file modifications)
- **Performance**: Exits immediately if no projects exist (avoids expensive nx operations)

**Pre-Push (Complete - ~30s-2min with projects, <1s empty workspace)**

- Format + Lint + Type + Test + Build
- Mimics CI behavior exactly
- Feature branches: affected projects | Base branches: all projects
- **Kustomize validation**: Full build test for all environments (dev, test, prod)
- Uses `--skip-reset` flag (no workspace file modifications)
- **Performance**: Exits immediately if no projects exist (avoids expensive nx operations)

**Why `--skip-reset` in hooks**: Git operations must not modify workspace files (prevents unstaged changes after commit). Manual commands (`npm run pre-commit`, `npm run pre-push`) DO run reset for clean state validation.

**Performance Optimization**: Both hooks check if any projects exist before running expensive operations. On empty workspaces (no projects in `apps/` or `libs/`), they exit in <1 second instead of running nx:reset and empty checks.

### Infrastructure Validation

**Kustomize checks run automatically when:**

- Any `infra/k8s/**/*.yaml` files are modified
- **Pre-commit**: Full build validation for all environments (fast feedback before commit)
- **Pre-push**: Full build validation for all environments (safety net before push)

**If Kustomize not installed:**

- Pre-commit/pre-push will skip validation with a warning
- Install: `npm run infra:setup` (one-time setup)
- Optional tool - won't block commits if not installed

**Why both hooks?**

- Pre-commit catches errors immediately (before commit is created)
- Pre-push provides safety net if pre-commit was bypassed (`git commit --no-verify`)
- Same validation logic in both = consistent behavior

### Intelligent Language Detection

Both hooks automatically detect affected languages and skip setup/checks for unaffected ones:

```javascript
// Example from pre-commit.js
if (hasPythonProjectsAffected(isAffected, base)) {
  setupPythonEnvironment();
  checkPythonProjects(isAffected, base);
} else {
  log("No Python projects affected - skipping Python checks");
}
```

**Pattern**: Check for affected projects first, setup environment only if needed, run checks conditionally.

## Python Environment Management

**Consolidated approach**: Single `.venv` at workspace root for development tools (Black, Flake8, mypy, pytest). Global package managers (UV, Poetry) installed via pipx for Nx generators. Project-specific dependencies managed by Nx `@nxlv/python` plugin.

```bash
# Full setup (environment + Nx integration + UV + Poetry)
npm run python:env:full

# Basic setup (environment + common tools)
npm run python:env

# Just dependencies
npm run python:deps

# Check environment
py-env.bat check  # Windows
bash py-env.sh check  # Unix
```

**Automatic global tool installation**: When you run `python:env:full`, the setup automatically:

1. Creates/verifies `.venv` with development tools
2. Installs `pipx` into the venv (uses venv Python to avoid SSL cert issues)
3. Uses pipx to install **UV** and **Poetry** globally at `~/.local/bin`
4. Updates Windows PATH registry permanently
5. Refreshes `process.env.PATH` so tools are **immediately available** (no restart required)

**Why global installation?** Nx generators (`@nxlv/python:uv-project`, `@nxlv/python:poetry-project`) require UV and Poetry to be globally accessible. Installing via pipx isolates them from the venv while keeping them available system-wide.

**Zero-restart workflow**: Just like .NET setup, UV and Poetry are immediately available after running `python:env:full` - no need to restart VS Code or terminals.

**CRITICAL**: Python venv is auto-created by git hooks if Python projects are affected. Don't force users to set it up manually unless they're actively developing Python code.

## .NET Project Management

**.NET is inference-based** - no Nx generators. The `@nx/dotnet` plugin automatically:

1. Detects `.csproj` files
2. Generates Nx targets based on project type
3. Infers dependencies from `<ProjectReference>`

**After creating .NET projects, ALWAYS run:**

```bash
npm run nx:reset
```

**Why**: This runs `dotnet:setup-projects.js` which syncs `real-estate-platform.sln` with all `.csproj` files and creates/updates `project.json` files.

**Available targets auto-generated:**

- `build` - All projects
- `serve` - Executable projects (web apps, console apps)
- `test` - Test projects (xunit, nunit, mstest)
- `pack` - Libraries
- `format`/`format-check` - All projects (dotnet format)
- `lint` - All projects (StyleCop via Directory.Build.props)

## Auto-Tagging System

**How it works**: `tools/nx/auto-tag-projects.js` scans all projects and tags them based on executors:

```javascript
// Detection logic
if (executorString.includes("@nx/express")) {
  tags.push("node", "express", "api");
}
if (executorString.includes("@nxlv/python")) {
  tags.push("python");
}
if (executorString.includes("@nx/dotnet") || file.endsWith(".csproj")) {
  tags.push("dotnet");
}
```

**Usage in commands:**

```bash
npm run nx:node-test      # Runs: nx run-many --target=test --projects=tag:node
npm run nx:python-lint    # Runs: nx run-many --target=lint --projects=tag:python
```

**CRITICAL**: If `--projects=tag:*` commands don't find your new project, run `npm run nx:tag-projects` (or `npm run nx:reset` which includes it).

## CI/CD Pipeline

**Architecture**: Shared `setup-base` job installs Node.js dependencies once; three parallel jobs (node, python, dotnet) restore cached `node_modules` and run checks.

**Affected vs Full Suite:**

- **Pull Requests**: Uses `nx affected --base=origin/${{ github.base_ref }}` (50-90% faster)
- **Push to main/dev/test**: Runs full suite on all projects

**Why this matters**: PRs targeting different branches (dev/test/main) automatically compare against the correct base. Local `pre-push` hook mimics this behavior.

**Concurrency control:**

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

Automatically cancels outdated runs when new commits pushed.

## Project-Specific Conventions

### Centralized Configurations

**Node.js** (`tools/node/configs/`):

- `eslint.config.js` - ESLint v9 flat config
- `prettier-config.js` - Prettier settings
- `tsconfig.*.json` - TypeScript configs (app, lib, base)
- `jest.config.js` - Jest testing setup

**Python** (`tools/python/`):

- `pyproject.toml` - Black/isort settings
- `.flake8` - Flake8 rules
- `mypy.ini` - Type checking config
- `.sqlfluff`, `.yamllint` - Additional tools

**.NET** (`tools/dotnet/configs/`):

- `Directory.Build.props` - MSBuild properties for all projects
- `Directory.Packages.props` - Central package management (CPM)
- `global.json` - .NET SDK version pinning
- `.editorconfig` - Code style (StyleCop)

### Line Endings & Encoding

**.gitattributes enforces LF** for cross-platform compatibility:

```
* text=auto eol=lf
```

**CRITICAL**: `auto-tag-projects.js` and `setup-dotnet-projects.js` preserve original BOM and line endings when modifying JSON files. If you modify these scripts, maintain this behavior.

### Formatting Commands

**Workspace-level** (includes repo files like `package.json`, `docs/`, `scripts/`):

```bash
npm run nx:workspace-format        # Format all files
npm run nx:workspace-format-check  # Check all files
```

**Project-level** (only project source code):

```bash
npm run nx:node-format      # Format Node.js projects
npm run nx:python-format    # Format Python projects
npm run nx:dotnet-format    # Format .NET projects
```

**When to use which**: Use workspace format for repo-wide changes (pre-commit/pre-push). Use project format during development of specific projects.

## Common Pitfalls & Solutions

**"No projects found for tag:python"**
→ Run `npm run nx:reset` to auto-tag projects

**".NET project not detected by Nx"**  
→ Run `npm run nx:reset` to sync solution file and generate project.json

**"Python environment not set up" in git hooks**
→ Hooks auto-create it. If manual setup needed: `py-env.bat create`

**"Git hook modifying files during commit"**
→ By design, hooks use `--skip-reset`. Manual commands (`npm run pre-commit`) DO reset for clean validation

**"Affected commands not working"**
→ Ensure `fetch-depth: 0` in CI checkout. Locally, set upstream: `git push -u origin feature-branch`

**"NU1604 warning in .NET restore"**
→ Add explicit `<PackageReference>` with version to .csproj (transitive dependency conflict)

## Integration Patterns

**Cross-language communication**: Not yet implemented (apps/ and libs/ are empty). When implemented, expect:

- Node.js/TypeScript services exposing REST APIs
- Python FastAPI services for ML/data processing
- .NET services for enterprise integrations
- Shared libraries in `libs/` consumed across languages

**Dependency graph**: Nx automatically infers from:

- `package.json` dependencies (Node.js)
- `requirements.txt` references (Python: `-r ../../../requirements.txt`)
- `<ProjectReference>` elements (.NET)

**Testing integration points**: Not applicable yet (no projects). When implemented, use contract testing (Pact) or integration tests in dedicated test projects.

## Quick Reference

```bash
# First-time setup
npm install                   # Install Node.js dependencies
npm run hooks:setup          # Configure Git hooks
npm run python:env           # Setup Python (if working with Python)
npm run dotnet:env           # Setup .NET (if working with .NET)
npm run infra:setup          # Setup infrastructure tools (Kustomize)

# Create projects
npx nx generate @nx/express:app my-api --directory=apps
dotnet new webapi -n MyApi -o apps/my-api
npm run nx:reset             # After creating any project

# Development
npx nx serve my-api          # Run specific project
npm run nx:node-dev          # Run all Node.js projects
npm run nx:python-test       # Test all Python projects

# Infrastructure
npm run infra:validate       # Validate all Kustomize manifests (all providers)
npm run infra:validate:dev   # Validate dev environment (all providers)
kustomize build infra/k8s/{provider}/{env} --enable-alpha-plugins  # Build manifests
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins       # Example: Hetzner dev

# Validation
npm run pre-commit           # Quick checks (manual)
npm run pre-push             # Full validation (manual)
git commit                   # Triggers pre-commit hook (automatic)
git push                     # Triggers pre-push hook (automatic)

# Troubleshooting
npm run nx:reset             # Fix project detection, sync .NET, auto-tag
npm run nx:workspace-format  # Format all files (fix format check failures)
npx nx graph                 # Visualize project dependencies
```

## Kubernetes & Infrastructure

### Architecture Overview

**Kustomize-based GitOps deployment** with hierarchical control flags and in-memory secret substitution. Infrastructure code in `infra/`:

- `k8s/base/` - Cloud-agnostic resource definitions (PostgreSQL, Redis/Valkey, Jaeger)
- `k8s/hetzner/{env}/` - Provider-specific overlays (dev/test/prod)
- `deploy-control.yaml` - Centralized deployment flags (master kill switch, time windows, rollback policies)

**Deployed Services**:

- **PostgreSQL 18 + PostGIS**: Multi-tenant databases (account_db, messaging_db, property_db)
- **Redis/Valkey 9.0**: ACL-based authentication, 5 users (admin, pubsub, cache, ratelimit, monitor)
- **Jaeger + OpenTelemetry**: Distributed tracing for microservices observability (optional sidecar)

**Critical Pattern**: **NO secretGenerator, NO secrets.env files**. Secrets use placeholder values (`StrongBase64Password`) in Git, substituted in-memory during CI/CD using `yq`.

### Secret Management

**Template-based approach** (same pattern as `hetzner-k8s` cluster provisioning):

```yaml
# infra/k8s/base/secrets/postgres.secret.yaml
stringData:
  POSTGRES_SA_PASSWORD: StrongBase64Password # Unquoted placeholder
  ACCOUNT_SERVICE_DB_USER_PASSWORD: StrongBase64Password
  # ... more secrets
```

**Workflow substitution** (`.github/workflows/deploy-k8s-resources.yml`):

```bash
# In-memory substitution using yq pipeline
yq eval '.stringData.POSTGRES_SA_PASSWORD = "${{ secrets.POSTGRES_SA_PASSWORD }}"' postgres.secret.yaml | \
  yq eval '.stringData.ACCOUNT_SERVICE_DB_USER_PASSWORD = "${{ secrets.ACCOUNT_SERVICE_DB_USER_PASSWORD }}"' - | \
  yq eval '.stringData.MESSAGING_SERVICE_DB_USER_PASSWORD = "${{ secrets.MESSAGING_SERVICE_DB_USER_PASSWORD }}"' - | \
  yq eval '.stringData.PROPERTY_SERVICE_DB_USER_PASSWORD = "${{ secrets.PROPERTY_SERVICE_DB_USER_PASSWORD }}"' - \
  > /tmp/postgres.secret.processed.yaml

# Replace original with processed (in runner only, never committed)
mv /tmp/postgres.secret.processed.yaml infra/k8s/base/secrets/postgres.secret.yaml
```

**Why this pattern:**

- ✅ Secrets stay in GitHub Secrets, never in Git
- ✅ Local testing works with placeholder values
- ✅ No `.gitignore` complexity or accidental commits
- ✅ Same pattern as Hetzner cluster provisioning (consistency)

**CRITICAL**: All 3 deployment jobs (dev/test/prod) must use **identical secret field names** and **identical temp file naming** (`/tmp/postgres.secret.processed.yaml`). This was a source of bugs - always verify consistency across all environments.

### Deployment Control System

**Hierarchical flag system** in `infra/deploy-control.yaml`:

```yaml
# Master kill switch (disables ALL automated deployments)
global:
  auto_deploy: true

# Environment-level controls
environments:
  dev:
    enabled: true # Environment can deploy
    auto_deploy: true # Auto-deploy on push
    deployment_windows:
      enabled: false # Time-based restrictions
      allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri"]
      allowed_hours: "09:00-17:00"

    services:
      postgres:
        enabled: true
        auto_deploy: true
        rollback_on_failure: false # Service-level rollback

# Deployment strategies (resource-type level)
deployment_strategies:
  statefulset:
    timeout: "10m" # Configurable rollout timeout
    rollback_on_failure: true # Strategy-level rollback
```

**Control flag enforcement** (10+ flags active):

- `enabled` (environment + service level)
- `auto_deploy` (environment + service level)
- `deployment_windows` (time restrictions)
- `rollback_on_failure` (combined OR: service-level OR strategy-level)
- `statefulset_timeout` (overrides hardcoded timeouts)
- `require_manual_approval` (parsed but not yet enforced - GitHub Environments handle this)

**Workflow integration**: Each deployment job parses `deploy-control.yaml` and exits early if any check fails (before credentials are loaded).

### Kustomize Structure

**Minimal Base Architecture**: Base contains ONLY configuration identical across all environments. Environment-specific resources are defined entirely in patches.

**What goes in base:**

- Container images, health probes, env vars, volume mounts, security context
- Service definitions, ConfigMaps, Secrets (templates with placeholders)

**What goes in patches (NEVER in base):**

- Resources (requests/limits)
- Storage (size/StorageClass)
- Replicas, affinity rules

```
infra/k8s/
├── base/
│   ├── secrets/postgres.secret.yaml           # Template with placeholders
│   ├── configmaps/postgres.configmap.yaml
│   ├── configmaps/redis.configmap.yaml
│   ├── configmaps/jaeger.configmap.yaml       # Sampling strategies
│   ├── services/postgres.service.yaml         # Headless + regular service
│   └── statefulsets/postgres.statefulset.yaml # NO resources, NO storage
└── hetzner/
    ├── dev/
    │   ├── kustomization.yaml                 # References base + patches
    │   ├── patches/
    │   │   └── statefulsets/
    │   │       └── postgres.statefulset.yaml  # ADD resources + volumeClaimTemplates (combined)
    │   └── cluster/
    │       └── cluster-config.yaml            # hetzner-k8s provisioning config
    ├── test/                                  # Higher resources than dev
    └── prod/                                  # Production-grade resources, replicas, HA
```

**File naming convention**: `{service}.{kind}.yaml` (e.g., `postgres.statefulset.yaml`, `postgres.configmap.yaml`, `redis.configmap.yaml`)

**Resource ordering** in kustomization.yaml (CRITICAL):

1. Secrets (processed first)
2. ConfigMaps
3. Services (must exist before StatefulSet for stable DNS)
4. StatefulSets

**Strategic merge behavior**: When base omits resources/storage, patches ADD complete sections (not merge/replace fields).

**CRITICAL - Environment Variable Pattern**: Kustomize replaces the entire `env:` array when patches define it. To preserve base variables:

- **Base**: Define all common environment variables (OTLP settings, sampling config, storage type)
- **Patches**: Define ONLY environment-specific variables (retention periods, resource limits)
- Example: Jaeger base defines SAMPLING_STRATEGIES_FILE, patches only define BADGER_SPAN_STORE_TTL

**Benefits of minimal base:**

- Base changes only affect features/bugs, never resource tuning
- Each environment explicitly declares resource requirements
- No accidental inheritance or override confusion
- Easy to add new providers (podman/local, aws, azure)

**Kustomize commands**:

```bash
# Build manifests (local validation)
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins

# Preview changes (requires kubectl access)
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl diff -f -
```

**CRITICAL**: Always use `--enable-alpha-plugins` flag (required for certain Kustomize features).

### Deployment Workflows

**Three deployment jobs** (dev/test/prod) in `.github/workflows/deploy-k8s-resources.yml`:

**Triggers**:

- `push` to branches (dev/test/main) + path filters (excludes cluster configs)
- `pull_request` (validation only - no deployment)
- `workflow_dispatch` (manual deployment with environment selection)
- `workflow_call` (invoked by hetzner-k8s.yml after cluster creation)

**Job structure** (identical for all 3 environments):

1. Load deployment control flags (parse `deploy-control.yaml`)
2. Check flags in order (global → environment → service → auto-deploy)
3. Set up kubeconfig (from GitHub Secrets)
4. **Substitute secrets** in postgres.secret.yaml and redis.secret.yaml (in-memory)
5. Build Kustomize manifests
6. **Error-driven apply**: Try `kubectl apply` → On immutable field error → Extract failed resource names → Delete with `--cascade=orphan` → Retry
7. **Wait for workload rollout** with configurable timeout:
   - Dynamically discovers all workloads: StatefulSets, Deployments, DaemonSets
   - Uses manifest-based discovery: `yq -N e 'select(.kind == "StatefulSet") | .metadata.name' manifests.yaml`
   - Checks rollout status for each: `kubectl rollout status {type}/{name}`
   - Fail-but-continue pattern: checks ALL workload types even if earlier ones fail (better diagnostics)
8. **Rollback on failure** (if enabled):
   - Attempts rollback for ALL workload types (StatefulSets, Deployments, DaemonSets)
   - Continues rollback attempts even if individual rollbacks fail
   - Reports any failures requiring manual intervention

**Kubernetes Immutable Field Handling**: Uses error-driven pattern to handle immutable fields across **5 resource types** (StatefulSet, Deployment, Service, DaemonSet, Job). Instead of preemptive checks, lets kubectl fail first, then parses stderr to identify resource type and extract specific resource names, deletes only those affected resources. Uses `--cascade=orphan` for stateful resources (preserves PVCs/Pods). This eliminates false positives and scales to any number of resources. Applied to all deployment targets: GitHub Actions (dev L312, test L636, prod L983) and local (kubectl-local-context.js).

**Workload Discovery Pattern**: All workload operations use manifest-based discovery:

```bash
STATEFULSETS=$(yq -N e 'select(.kind == "StatefulSet") | .metadata.name' manifests.yaml 2>/dev/null | grep -v '^---$' | tr '\n' ' ' || echo "")
DEPLOYMENTS=$(yq -N e 'select(.kind == "Deployment") | .metadata.name' manifests.yaml 2>/dev/null | grep -v '^---$' | tr '\n' ' ' || echo "")
DAEMONSETS=$(yq -N e 'select(.kind == "DaemonSet") | .metadata.name' manifests.yaml 2>/dev/null | grep -v '^---$' | tr '\n' ' ' || echo "")
```

This pattern ensures the workflow uses a single source of truth (manifests.yaml), eliminating kubectl API calls and improving consistency across rollout/rollback operations.

**Rollback logic** (combined OR):

```yaml
if: |
  always() &&
  steps.deploy-control.outputs.enabled == 'true' &&
  (steps.deploy-control.outputs.rollback_on_failure == 'true' || 
   steps.deploy-control.outputs.statefulset_rollback == 'true') &&
  steps.rollout.outputs.rollout_success != 'true'
```

**Why OR logic**: Allows flexible control (disable at service level for manual investigation, or disable at strategy level to prevent all automatic rollbacks).

### Cluster Provisioning Workflow

**hetzner-k8s.yml** provisions K3s clusters on Hetzner Cloud:

**Workflow sequence**:

1. Detect cluster config changes using dorny/paths-filter
2. Check `auto_deploy: true` flag in cluster-config.yaml
3. Create/update cluster using hetzner-k3s CLI
4. Wait for cluster readiness (nodes, CSI driver, StorageClass)
5. **Upload KUBECONFIG** to GitHub environment secrets using GitHub CLI with PAT
6. **Trigger deploy-k8s-resources.yml** via workflow_dispatch (passes environment parameter)

**CRITICAL**: Path filters prevent race conditions:

- `hetzner-k8s.yml` triggers on `infra/k8s/hetzner/*/cluster/*.yaml` changes
- `deploy-k8s-resources.yml` **excludes** cluster configs via `!infra/k8s/hetzner/**/cluster/**`
- This ensures cluster creation completes BEFORE resource deployment starts

**KUBECONFIG Upload Strategy**: Uses environment-scoped secrets with Personal Access Token (PAT). The default `github.token` has limited permissions:

- **Read-only** access to the secrets API (cannot write secrets)
- **No** `actions:write` permission (cannot trigger workflows)

Both operations return `HTTP 403: Resource not accessible by integration`. Solution requires `INFRA_DEPLOY_TOKEN` (PAT with `repo` scope) stored as repository secret. Implementation: `gh secret set KUBECONFIG --env {env}` and `gh workflow run deploy-k8s-resources.yml` both use PAT authentication. Environment secrets provide better security (scoped access, protection rules, audit trail) compared to repository secrets with prefixes. GitHub CLI handles libsodium encryption automatically.

### Validation Workflows

**PR validation job** (`validate-pr`):

- Runs on pull requests targeting dev/test/main
- Detects which environments changed (path filter)
- Validates Kustomize builds WITHOUT secret substitution
- **Uses placeholder values** - local builds will show `StrongBase64Password`
- Fast feedback (~30 seconds)

**CRITICAL**: Validation uses templates directly (no secret substitution). This is intentional - validates YAML structure, not secret values.

### Resource References

**StatefulSet → Secret** (via `secretKeyRef`):

```yaml
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: postgres-secret
        key: POSTGRES_SA_PASSWORD
```

**StatefulSet → ConfigMap** (via `volumeMount`):

```yaml
volumes:
  - name: init-scripts
    configMap:
      name: postgres-config # Must match ConfigMap metadata.name
```

**StatefulSet → Service** (via `serviceName`):

```yaml
spec:
  serviceName: postgres-hl # Must match headless Service metadata.name
```

**CRITICAL**: All references must be exact matches. Use grep to verify consistency:

```bash
# Verify ConfigMap name consistency
grep -r "postgres-config" infra/k8s/base/

# Verify secret field names across workflow and StatefulSet
grep -r "ACCOUNT_SERVICE_DB_USER_PASSWORD" .github/workflows/ infra/k8s/base/
```

### Common Infrastructure Pitfalls

**"Prod deployment fails with 'field does not exist' error"**
→ Secret field names mismatch between workflow and secret template. All 3 jobs must use identical field names.

**"Secret shows StrongBase64Password in deployed pods"**
→ Workflow secret substitution failed. Check GitHub Secrets are configured for the environment. Verify yq pipeline completed successfully.

**"StatefulSet stuck in pending - PVC not binding"**
→ StorageClass `hcloud-volumes` not available. Hetzner CSI driver creates this automatically. Verify CSI driver is running: `kubectl get pods -n kube-system -l app=hcloud-csi-controller`

**"Kustomize build fails with 'resource not found'"**
→ Check resource ordering in kustomization.yaml. Secrets must come before resources that reference them.

**"Deployment control flags not working"**
→ Workflow reads flags but may not enforce all (see `deploy-control.yaml` metadata section for enforcement status).

**"Rollback not triggering on failure"**
→ Check BOTH `rollback_on_failure` (service level) AND `statefulset_rollback` (strategy level). Either can trigger rollback (OR logic).

**"Resource updates failing with immutable field errors"**
→ Immutable fields changed on StatefulSet/Deployment/Service/DaemonSet/Job. Workflow automatically detects error type, extracts resource names, deletes with appropriate flags (`--cascade=orphan` for stateful resources), and retries. Supports 5 resource types. For local testing, use `npm run infra:local:k8s-resources:apply` which has the same error-driven logic.

### Infrastructure Documentation

**Primary docs** (in `infra/k8s/`):

- `readme.md` - Quick start, architecture overview, FAQ navigation
- `operations.md` - Daily operations, deployment commands, troubleshooting
- `testing.md` - Local testing, validation procedures, dry-run commands
- `implementation-summary.md` - Architecture decisions, what changed, benefits

**Documentation pattern**: README acts as navigation hub; specialized docs for specific tasks.

### Observability Strategy

**Jaeger + OpenTelemetry** (fully open source, Apache 2.0 license):

**Design Principles:**

- **Optional Sidecar**: Services function normally if Jaeger unavailable (zero hard dependency)
- **Auto-Instrumentation**: Zero code changes using OpenTelemetry auto-instrumentation libraries
- **Performance**: <1% overhead with proper sampling (100% dev, 1-5% prod)
- **Retention**: 7 days dev (in-memory), 30 days prod (persistent storage)

**Deployment Pattern:**

- StatefulSet for persistent trace storage
- Multi-environment patches (different retention policies per env)
- Exposed ports: 16686 (UI), 4317 (OTLP gRPC), 4318 (OTLP HTTP), 14250 (Jaeger gRPC)

**Service Integration:**

```typescript
// Auto-instrumentation (Node.js) - runs before app starts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://jaeger-svc:4318/v1/traces",
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

**What Gets Traced Automatically:**

- HTTP requests (Express, FastAPI, .NET)
- Database queries (PostgreSQL, Redis via connection libraries)
- WebSocket connections
- Service-to-service calls
- Error stack traces

**Benefits:**

- Debug cross-service issues (e.g., "Why is property search slow?")
- Identify slow database queries with real usage patterns
- Visualize service dependency graph automatically
- Monitor 95th percentile latency for SLA compliance

### Kubernetes Quick Reference

```bash
# Local testing (generic pattern)
kustomize build infra/k8s/{provider}/{env} --enable-alpha-plugins
kustomize build infra/k8s/{provider}/{env} --enable-alpha-plugins | kubectl diff -f -

# Examples
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins | kubectl diff -f -

# Manual deployment (requires GitHub CLI)
gh workflow run deploy-k8s-resources.yml -f environment=dev

# Check deployment status
kubectl get statefulset postgres redis jaeger
kubectl get pods -l app=postgres
kubectl get pvc -l app=postgres
kubectl logs postgres-0

# Jaeger UI (port-forward)
kubectl port-forward svc/jaeger-svc 16686:16686
# Open: http://localhost:16686

# Rollback (manual)
kubectl rollout undo statefulset/postgres
kubectl rollout status statefulset/postgres -w
```

### Infrastructure File Locations

| What                   | Where                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| Deployment flags       | `infra/deploy-control.yaml`                                      |
| PostgreSQL secret      | `infra/k8s/base/secrets/postgres.secret.yaml`                    |
| Redis secret           | `infra/k8s/base/secrets/redis.secret.yaml`                       |
| PostgreSQL StatefulSet | `infra/k8s/base/statefulsets/postgres.statefulset.yaml`          |
| Redis StatefulSet      | `infra/k8s/base/statefulsets/redis.statefulset.yaml`             |
| Jaeger StatefulSet     | `infra/k8s/base/statefulsets/jaeger.statefulset.yaml`            |
| Init scripts           | `infra/k8s/base/configmaps/*.configmap.yaml`                     |
| Dev config (combined)  | `infra/k8s/hetzner/dev/patches/statefulsets/*.statefulset.yaml`  |
| Prod config (combined) | `infra/k8s/hetzner/prod/patches/statefulsets/*.statefulset.yaml` |
| Cluster config         | `infra/k8s/hetzner/{env}/cluster/cluster-config.yaml`            |
| Deployment workflow    | `.github/workflows/deploy-k8s-resources.yml`                     |
| Cluster provisioning   | `.github/workflows/hetzner-k8s.yml`                              |

## External Dependencies

- **Nx 22.0.1**: Monorepo orchestration
- **Node.js 20.19.5**: Runtime (LTS, pinned in `.nvmrc`)
- **Python 3.8+**: Runtime (auto-installed by `py-env` scripts)
- **.NET SDK 8.0**: Runtime (pinned in `tools/dotnet/configs/global.json`)
- **GitHub Actions**: CI/CD platform (`.github/workflows/ci.yml`, `.github/workflows/deploy-k8s-resources.yml`)
- **Kustomize**: Kubernetes manifest templating (required for local testing and workflows)
- **kubectl**: Kubernetes CLI (workflows use version from GitHub Actions runner)
- **yq**: YAML processor for secret substitution and config parsing (installed in workflows)
- **hetzner-k8s**: K3s cluster provisioning on Hetzner Cloud (`.github/workflows/hetzner-k8s.yml`)

**Version management**: `.nvmrc` (Node), `global.json` (.NET), `pyproject.toml` (Python 3.8+ in tool.poetry.dependencies)
