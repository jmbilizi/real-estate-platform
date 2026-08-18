# Real Estate Platform (Cribstop) — Agent Guide

Airbnb-inspired real estate marketplace — **Homes** (buy/sell/rent), **Services** (professional
marketplace), **Connect** (community). Consumer brand Cribstop.com, brokered by Real Broker, LLC
(MD/DC/VA). Nx polyglot monorepo: Node/TypeScript, .NET, Python.

**This file is the canonical repo guide for ALL AI coding agents** (Claude Code, GitHub Copilot,
Codex, and any future provider that reads the [AGENTS.md](https://agents.md/) standard). `CLAUDE.md`
files are one-line `@AGENTS.md` import stubs for Claude Code; `.github/copilot-instructions.md` is a
pointer stub. Canonical skills, subagents, and hooks live in `.agents/` — see
[Agent Automation Conventions](#agent-automation-conventions).

## Project Guides (nested AGENTS.md, auto-loaded per directory)

- `apps/clients/cribstop/AGENTS.md` — Next.js consumer web app
- `apps/api-gateway/AGENTS.md` — Ocelot (.NET) API gateway
- `apps/services/account-service/AGENTS.md` — .NET identity/auth service
- `apps/services/property-service/AGENTS.md` — Node property/listings domain service
- `apps/services/multi-model-inference/AGENTS.md` — Python inference service
- `libs/property-contracts/AGENTS.md` — shared listings wire-contract library

## Key Docs (read before deep work)

- `PRD.md` — product spec (living doc): domain model, services, compliance.
- `infra/k8s/readme.md` — infrastructure quick start and ops.

## Repo-Wide Rules

1. **Never run raw tool commands** (`npx eslint`, `dotnet build`, `pytest`, `kubectl apply`). Always
   use `pnpm run ...` / `pnpm exec nx ...` wrappers.
2. **Cross-platform first** — Windows/macOS/Linux. Node scripts in `tools/`, never bash-only or
   `.bat`-only solutions.
3. **After creating/deleting any project**: `pnpm run nx:reset` (syncs .NET solution, generates
   targets, auto-tags).
4. **Never bypass git hooks** (`--no-verify`), never force-push.
5. **Compliance in all user-facing copy/mock data**: Fair Housing, Real Broker LLC brand prominence,
   no fabricated data — see PRD.md §6 and the cribstop project guide.
6. **The whole local infra lifecycle is scripted — manage it yourself, never ask.** Cluster,
   registry, images, and deploys all have `pnpm run` scripts (see Commands below and `package.json`
   → "Local Cluster Lifecycle" / "Local Container Registry"). If the cluster isn't up, create it; if
   it's wedged or out of disk, reset it. Never ask whether the environment is available — that's a
   question you answer with a command. Only genuine external dependencies (secrets, paid accounts,
   sign-offs) need a human.
7. **A new deployable isn't done until it deploys.** Creating an Nx service/app means the full
   `new-service` skill checklist — Dockerfile, `infra/k8s/` manifests, skaffold artifact, env/secret
   wiring — verified with `pnpm run skaffold:services:deploy`, not just a green `nx build`. A ticket
   that scopes infra out is a defective ticket; flag it and build it correctly.
8. **Always shut down anything you started in the background.** Dev servers, `skaffold` watches,
   `kubectl port-forward`, test runners in watch mode — they outlive the command that launched them.
   Left running they squat on ports (3000/3002/5432/8080) so the next run fails or, worse, silently
   answers from a stale process and a later check "passes" against nothing. Stop background shells
   when the task that needed them is done — before reporting or committing — and confirm none
   survive (`ps -W | grep -E 'skaffold|kubectl|node'`). **On Windows `pkill` silently does nothing**
   — use `taskkill //F //IM kubectl.exe` (or `skaffold.exe`, `node.exe`).

## Commands (repo level)

```bash
pnpm run skaffold:services             # Backend services in local K8s
pnpm exec nx lint <project>            # Single project: lint | test | type-check
pnpm run nx:node-lint                  # Bulk by language: nx:{node|dotnet|python}-{target}
pnpm run nx:workspace-format           # Fix formatting repo-wide
pnpm run pre-commit                    # Fast validation (format+lint+type-check)
pnpm run pre-push                      # Full validation (+ test + build)
pnpm install && pnpm run hooks:setup   # First-time setup
pnpm run infra:local:cluster:setup     # Local cluster: also :delete | :reset:disk | :images:list
pnpm run infra:local:registry:ensure   # Local registry: also :status | :delete
pnpm run skaffold:services:deploy      # One-shot deploy (vs. skaffold:services watch loop)
pnpm run infra:validate:dev            # Kustomize validation per env
```

## Layout

- `apps/` — deployable projects (gateway, services, clients); `libs/` — shared libraries (created on
  demand via Nx generators).
- `infra/k8s/` — ALL K8s manifests (Kustomize base + per-env overlays).
- `tools/` — cross-platform Node automation scripts (source of truth).
- `.agents/` — canonical, provider-neutral agentic assets (skills, subagents, hooks).

## Agent Automation Conventions

- **`.agents/` is the single source of truth** for agentic assets, consumed as follows:
  - `.agents/skills/<name>/SKILL.md` — skills per the [agentskills.io](https://agentskills.io/) open
    standard. VS Code Copilot discovers this folder natively; Claude Code reads generated pointer
    files in `.claude/skills/`.
  - `.agents/agents/<name>.md` — subagent definitions (Claude sub-agent frontmatter format, which VS
    Code also understands). VS Code discovers them via `chat.agentFilesLocations` in
    `.vscode/settings.json`; Claude Code reads generated copies in `.claude/agents/`.
  - `.agents/hooks/*.js` — provider-neutral hook scripts. Claude Code registers them in
    `.claude/settings.json`; other providers adopt them as their hook systems stabilize. Git hooks
    (husky) remain the universal enforcement backstop.
- **Generated pointers are committed.** After editing anything under `.agents/`, run
  `pnpm run agents:sync` to regenerate the `.claude/` pointers; `pnpm run agents:check` (wired into
  pre-commit) fails on drift. Never hand-edit generated files in `.claude/skills/` or
  `.claude/agents/`.
- **Project-specific skills**: nest them in the project (`apps/<...>/.agents/skills/`) and add the
  location per provider as needed. **Project-specific hooks and subagents** (root-only discovery):
  name them with the project prefix, e.g. `cribstop-compliance-reviewer`.

## Repo-Wide Gotchas

- Test a changed project directly by name (`pnpm exec nx test <project>`); `nx affected` needs a
  committed base and misses uncommitted work.
- `tag:runtime:*` commands miss new projects until `pnpm run nx:reset`.
- Accounts are multi-role platform-wide (owner+renter+buyer+agent+provider simultaneously); never
  introduce a single-value `user_type` (PRD §11.2).
- **Deployment is gated in two registries, and omission is silent**: `skaffold.yaml` (local) and
  `infra/deploy-control.yaml` (CI/CD, enumerated by `yq` key lookup). A service missing from either
  never deploys, with no error. The CI image-build matrix is auto-derived from the `container-build`
  target — don't hardcode it.
- **The inverse is just as silent: a gateway can advertise a service that is gated off.**
  `apps/api-gateway/Startup.cs` loads every `Configuration/Routes/*.json` unconditionally, so a
  route file ships routes _and_ a `SwaggerEndPoints` entry regardless of whether
  `infra/deploy-control.yaml` will deploy that service to the target environment. Nothing
  cross-checks the two. The failure mode is not "never deploys" but **"advertised but never
  deployed"**: SwaggerForOcelot cannot fetch the downstream document, so
  `/swagger/docs/v1/<Service>` returns **500** (taking out the whole aggregation endpoint, not just
  that one document) and the service's routes return **502** — discovered by a human in a browser,
  never by CI. Cost a dev outage on #22/#71. When adding a gateway route, check the service's
  `enabled`/`auto_deploy` in **every** environment block, not just the one you're testing.
  Guard-rail check tracked in #72.
- **An image is rebuilt only when its own Dockerfile inputs change.** Nx marks _every_ project
  affected when `pnpm-lock.yaml`, `nx.json` or the root `package.json` changes, which any
  service-adding branch does — so `tools/ci/affected-images.js` narrows the matrix using each
  Dockerfile's `COPY`/`ADD`/`--mount=type=bind` sources as the source of truth. Consequence: **if a
  Dockerfile depends on a path it never copies, its image will not rebuild when that path changes.**
  Declare the dependency in the Dockerfile rather than special-casing the script. The script only
  ever removes projects and fails open, so a parse it cannot handle costs a rebuild, not a stale
  image.
- **`pnpm-lock.yaml` is Prettier-ignored** — pnpm owns its formatting, so never reformat it. After
  any dependency change the gate is correctness, not style: `pnpm install --frozen-lockfile` must
  exit 0 (CI runs it in six places). Reconcile a failure with an install, never by hand-editing.
- **No Alpine base images for anything doing in-cluster DNS.** musl fails Kubernetes service
  resolution with `EAI_AGAIN`; use a Debian `-slim` base. (`cribstop-next` is still on Alpine and
  has this latent bug.)
- **Any Dockerfile that runs Nx must set `ENV NX_DAEMON=false`.** Nx turns its daemon off in CI and
  in Docker, but does not detect podman/buildah or BuildKit (`isDocker()` checks only `/.dockerenv`
  and cgroup `"docker"`; podman writes `/run/.containerenv`, and no build engine propagates `CI`).
  So a daemon — with a file watcher — starts inside the build layer, recomputes the project graph
  while the build is mutating files, trips over a transient generated tsconfig, and persists the
  graph with an `errors[]` entry; every later `readCachedProjectGraph()` then reports **"No cached
  ProjectGraph is available"** for a file that is present and fine. Cost a red `dev` build at 50%
  reproducibility (#69). `property-service` is currently the only such Dockerfile.
- Jest `<rootDir>` inside `testMatch` / `testPathIgnorePatterns` silently matches nothing on Windows
  (native backslashes read as escapes). Write the patterns without it.

---

# Deep Reference

Everything below is the detailed conventions reference (formerly `.github/copilot-instructions.md`).

## Architecture Overview

This is an **Nx-powered polyglot monorepo** supporting Node.js/TypeScript, Python, and .NET projects
with unified workflows, Git hooks, and CI/CD. The workspace uses **plugin-based inference** where Nx
automatically detects projects and generates targets without manual configuration.

**Key Structural Decisions:**

- **Empty `apps/` and `libs/`**: Projects are created on-demand using Nx generators or standard
  tooling
- **Auto-tagging system**: All projects tagged with namespaced dimensions (`runtime:node`,
  `type:service`, `platform:web`, `scope:`, `framework:`, `devteam:`) — auto-detected and manual
  placeholders
- **Unified Git hooks**: Two-tier validation (pre-commit: fast checks, pre-push: full suite) with
  intelligent language detection
- **Centralized configs**: All language-specific configurations in `tools/{language}/configs/`

## Cross-Platform First (CRITICAL)

This repo must remain usable on **Windows, macOS, and Linux**.

- Prefer **Node.js scripts** (in `tools/`) for automation over OS-specific shell/batch scripts.
- Avoid Windows-only constructs (e.g., `.bat`-only workflows) unless there is an equivalent
  cross-platform path.
- Do not assume `bash`, `sed`, `grep`, or GNU tool availability.
- If a workflow behaves differently on Windows due to `pnpm.cmd` Ctrl+C behavior, provide a
  **cross-platform Node launcher** that can be run directly via `node`.

## Always Use Project Scripts (CRITICAL)

**NEVER run raw tool commands directly.** Always use the project's `pnpm run` or `pnpm exec nx`
wrappers. These scripts handle project detection, configuration paths, error handling, and
cross-platform compatibility automatically.

**Lint, type-check, format, test, build:**

```bash
# ✅ CORRECT — uses project scripts
pnpm run nx:node-lint            # Lint all Node.js projects
pnpm run nx:node-type-check     # Type-check all Node.js projects
pnpm run nx:dotnet-build        # Build all .NET projects
pnpm run nx:python-test         # Test all Python projects
pnpm exec nx lint cribstop-next        # Lint a specific project
pnpm exec nx type-check cribstop-next  # Type-check a specific project
pnpm exec nx build api-gateway         # Build a specific project

# ❌ WRONG — never run these directly
npx eslint ...
npx tsc --noEmit ...
dotnet build ...
pytest ...
```

**Infrastructure:**

```bash
# ✅ CORRECT — uses infra scripts with context safety
pnpm run skaffold:deploy
pnpm run skaffold
pnpm run infra:validate

# ❌ WRONG — no context safety, no immutable field handling
skaffold run
kubectl apply -f ...
kustomize build ...
```

**Why**: The wrappers provide centralized config paths (`tools/node/configs/eslint.config.js`,
`tsconfig.json` references), safe-run-many error handling, correct Nx project targeting via tags,
and cross-platform behavior. Running tools directly bypasses all of this and produces inconsistent
results.

## Critical Workflows

### Creating New Projects

**NEVER create projects manually**. Use Nx generators or standard tooling:

```bash
# Node.js/TypeScript - Use Nx generators
pnpm exec nx generate @nx/express:app my-api --directory=apps
pnpm exec nx generate @nx/next:app my-web --directory=apps
pnpm exec nx generate @nx/node:lib shared-utils --directory=libs

# Python - Use Nx generators (requires Poetry or UV installed)
pnpm exec nx generate @nxlv/python:poetry-project my-service --directory=apps
pnpm exec nx generate @nxlv/python:uv-project my-service --directory=apps
pnpm exec nx generate @nxlv/python:poetry-project utils --directory=libs --projectType=library

# .NET - Use standard dotnet CLI (auto-detected by @nx/dotnet)
dotnet new webapi -n MyApi -o apps/my-api
dotnet new classlib -n MyLib -o libs/my-lib

# After creating ANY project, run this to sync solution files and auto-tag
pnpm run nx:reset
```

**Why**: `nx:reset` runs four critical operations:

1. `nx:repair` - Validates Nx configuration
2. `nx reset` - Clears computation cache
3. `setup-workspace-targets.js` - Ensures all projects have correct targets:
   - .NET: build, serve, test, lint, format, format-check, container-build
   - Node: lint, type-check, format, format-check, test, container-build
   - Syncs .NET solution file (.sln)
4. `auto-tag-projects.js` - Auto-tags projects for `--projects=tag:*` filtering

### Running Commands

**Pattern**: Use `pnpm run nx:{language}-{target}` for language-specific bulk operations:

```bash
# Language-specific commands (all projects of that type)
pnpm run nx:node-lint          # Lint all Node.js projects
pnpm run nx:python-test        # Test all Python projects
pnpm run nx:dotnet-build       # Build all .NET projects

# Individual project
pnpm exec nx test my-api            # Test specific project
pnpm exec nx build my-service       # Build specific project

# Affected projects (automatically uses correct base branch)
pnpm exec nx affected --target=test
```

**CRITICAL**: The `safe-run-many.js` wrapper handles "no projects found" gracefully. Commands won't
fail in CI if no projects of that type exist yet.

### Nx Reset vs Repair

**Use `pnpm run nx:reset` when:**

- After creating/deleting projects (syncs solution files + auto-tags)
- Before running affected commands in CI
- Build behavior is inconsistent (clears cache)
- After major dependency updates

**Skip reset for:**

- Git hooks (uses `--skip-reset` flag to avoid file modifications during commit)
- Individual development commands (`nx build`, `nx test`) - Nx manages cache automatically
- Rapid iteration - reset adds ~5-10s overhead

**Pattern in scripts**: Manual validation commands (`pnpm run pre-commit`, `pnpm run pre-push`) run
reset once at start; git hooks skip it entirely.

## Git Hooks & Validation

### Two-Tier System

**Branch gating**: The automatic hooks enforce checks only on protected branches (`dev`, `test`,
`main`). On feature branches both hooks exit immediately (<1s) — **intentionally, to speed up
feature-branch development**: run `pnpm run pre-commit` once over a body of work and then make
multiple separate commits without waiting for the full sweep again, or skip it for a small/obvious
change and run targeted checks instead (`pnpm run nx:workspace-format`,
`pnpm exec nx lint|type-check <project>`). The expectation that remains: `pnpm run pre-push` before
pushing; CI on the PR is the backstop. Manual runs of those commands always execute in full
regardless of branch (the gate only applies to the `--hook` flag the husky scripts pass).

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

**Why `--skip-reset` in hooks**: Git operations must not modify workspace files (prevents unstaged
changes after commit). Manual commands (`pnpm run pre-commit`, `pnpm run pre-push`) DO run reset for
clean state validation.

**Performance Optimization**: Both hooks check if any projects exist before running expensive
operations. On empty workspaces (no projects in `apps/` or `libs/`), they exit in <1 second instead
of running nx:reset and empty checks.

### Infrastructure Validation

**Kustomize checks run automatically when:**

- Any `infra/k8s/**/*.yaml` files are modified
- **Pre-commit**: Full build validation for all environments (fast feedback before commit)
- **Pre-push**: Full build validation for all environments (safety net before push)

**If Kustomize not installed:**

- Pre-commit/pre-push will skip validation with a warning
- Install: `pnpm run infra:setup` (one-time setup)
- Optional tool - won't block commits if not installed

**Why both hooks?**

- Pre-commit catches errors immediately (before commit is created)
- Pre-push provides safety net if pre-commit was bypassed (`git commit --no-verify`)
- Same validation logic in both = consistent behavior
- Both auto-enforce on protected branches only (see **Branch gating** above); on feature branches
  the same protection comes from running the commands manually + CI on the PR

### Intelligent Language Detection

Both hooks detect affected languages based on **file extensions of staged/changed files** — not what
projects exist in the repo. A developer committing only `.tsx` files will never trigger Python or
.NET setup.

```javascript
// pre-commit.js: checks staged files
const staged = getStagedFiles(); // git diff --cached --name-only
const hasPythonFiles = staged.some((f) => /\.(py|pyx|ipynb)$/.test(f));
if (hasPythonFiles) {
  setupPythonEnvironment();
  checkPythonProjects(isAffected, base);
} else {
  log('No Python projects affected - skipping Python checks');
}
```

**Pattern**: Check file extensions of staged/changed files first, setup environment only if needed,
run checks conditionally. This means:

- Python devs don't need .NET SDK installed
- .NET devs don't need Python/UV installed
- Node/Next.js devs only need Node.js

## Python Environment Management

**UV workspace mode**: Single `.venv` at workspace root, managed by UV. Each project has its own
`pyproject.toml` (like `package.json`), but all packages install into the shared `.venv` (like
`node_modules/`). Single `uv.lock` lockfile at root.

```bash
# One-time setup (installs UV if missing + creates .venv + installs all packages)
pnpm run python:env

# With all optional dependency groups
pnpm run python:env:full

# Check environment status
pnpm run python:env -- --check
```

**What `python:env` does automatically:**

1. Checks for UV installation — installs it if missing (cross-platform: PowerShell/winget/brew/curl)
2. Runs `uv sync` — creates `.venv`, auto-downloads Python from `.python-version` if needed,
   installs all packages from `uv.lock`
3. Verifies key tools are available (black, flake8, mypy, pytest, ruff)

**UV handles Python installation**: No need to pre-install Python. UV reads `.python-version`
(pinned to 3.11) and auto-downloads the correct version.

**Running tools**: Use `uv run` instead of activating the venv:

```bash
uv run pytest              # Run tests
uv run black .             # Format code
uv run python script.py    # Run a script
```

**Adding dependencies**:

```bash
# To a specific project
uv add --project apps/services/my-service fastapi "uvicorn[standard]"

# Workspace-wide dev tool
uv add --dev ruff
```

**CRITICAL**: Python venv is auto-created by git hooks if Python projects are affected. Don't force
users to set it up manually unless they're actively developing Python code.

## .NET Project Management

**.NET uses explicit project.json configuration** - no Nx generators or auto-inference. The
`@nx/dotnet` plugin provides:

1. Dependency graph analysis for `.csproj` files
2. Detects `<ProjectReference>` relationships
3. **Does NOT auto-generate targets** (graph support only)

**After creating .NET projects, ALWAYS run:**

```bash
pnpm run nx:reset
```

**Why**: This runs `setup-workspace-targets.js` which:

- Syncs `real-estate-platform.sln` with all `.csproj` files
- Creates/updates `project.json` files with explicit targets for both .NET and Node projects
- Intelligently adds missing targets based on project type and language

**Targets created by setup script:**

.NET projects:

- `build` - All projects
- `serve` - Application projects only (not libraries or tests)
- `test` - Test projects only (xunit, nunit, mstest) **or** non-test projects with a companion
  `Tests/` subfolder
- `lint` - All projects (dotnet format analyzers)
- `format` - All projects (dotnet format)
- `format-check` - All projects (dotnet format --verify-no-changes)
- `type-check` - All projects (dotnet build --nologo --no-restore)

Node projects:

- `lint` - All projects (eslint)
- `type-check` - All projects with tsconfig.json (tsc --noEmit)
- `format` - All projects (prettier --write)
- `format-check` - All projects (prettier --check)
- `test` - All projects (jest --passWithNoTests)

### .NET Companion Test Convention

.NET test projects use a **companion `Tests/` subfolder** inside the parent project directory:

```
apps/my-api/
├── my-api.csproj          # Main project
├── project.json           # Nx project config (test target delegates here ↓)
└── Tests/
    └── my-api.Tests.csproj  # Test project (PascalCase folder, .Tests.csproj suffix)
```

**How it works:**

- `setup-workspace-targets.js` detects `Tests/*.Tests.csproj` inside .NET project directories
- Adds a `test` target to the parent project with `cwd` pointing to the `Tests/` subfolder
- The companion `.csproj` is NOT registered as a separate Nx project (skipped during setup)
- `@nx/dotnet` still discovers it for dependency graph analysis
- Solution file includes both `.csproj` files

**Creating a companion test project:**

```bash
# Create the Tests/ subfolder and .csproj manually
mkdir apps/my-api/Tests
# Use dotnet CLI to create the test project
dotnet new xunit -o apps/my-api/Tests -n my-api.Tests
# Remove version attributes from PackageReference (CPM manages versions)
# Ensure TargetFramework matches the parent project
# Then sync everything
pnpm run nx:reset
```

**CRITICAL**: The `.Tests.csproj` must:

- Use versionless `<PackageReference>` (Central Package Management in `Directory.Packages.props`)
- Have `<IsTestProject>true</IsTestProject>`
- Include a `<ProjectReference>` to the parent `.csproj`
- Match the parent's `<TargetFramework>`

## Auto-Tagging System

**Namespaced tag taxonomy** with 6 dimensions. `tools/nx/auto-tag-projects.js` runs on every
`nx:reset`.

**Auto-detected dimensions** (set or corrected on every run):

| Dimension   | Values                                | Detection                                |
| ----------- | ------------------------------------- | ---------------------------------------- |
| `runtime:`  | `node`, `dotnet`, `python`            | Executors, commands, project files       |
| `type:`     | `service`, `client`, `lib`, `gateway` | Project location, executors, name        |
| `platform:` | `web`, `server`, `mobile`             | Framework executors; omitted if agnostic |

**Manual dimensions** (placeholder `unassigned` added if missing, never overwritten):

| Dimension    | Purpose                                          |
| ------------ | ------------------------------------------------ |
| `scope:`     | Business domain (`accounts`, `shared`, `client`) |
| `framework:` | Tech stack (`next`, `expo`, `fastapi`, `ocelot`) |
| `devteam:`   | Owning team                                      |

**Usage in commands:**

```bash
pnpm run nx:node-test      # Runs: nx run-many --target=test --projects=tag:runtime:node
pnpm run nx:python-lint    # Runs: nx run-many --target=lint --projects=tag:runtime:python
pnpm exec nx run-many --target=test --projects=tag:type:client   # All client apps
pnpm exec nx run-many --target=lint --projects=tag:scope:shared   # All shared-scope projects
```

**CRITICAL**: If `--projects=tag:runtime:*` commands don't find your new project, run
`pnpm run nx:tag-projects` (or `pnpm run nx:reset` which includes it).

## CI/CD Pipeline

**Architecture**: CI-first workflow with explicit change detection and selective workflow
triggering.

**Workflow Orchestration:**

```yaml
# Three workflows with clear separation of concerns:
1. ci.yml                            # Quality checks + change detection + workflow triggering
2. provision-hetzner-k8s-cluster.yml # Cluster creation (triggered by CI)
3. deploy-k8s-resources.yml          # Resource deployment (triggered by CI or Provision)
```

**CI Workflow Flow (Selective Triggering):**

```yaml
on:
  push:
    branches: [main, test, dev]
  pull_request:
    branches: [main, test, dev]

permissions:
  actions: write # Required to trigger provision/deploy workflows
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
    # Detects cluster-changed and deploy-changed flags

  # 3. Trigger provision ONLY if cluster files changed
  trigger-provision:
    needs: [detect-infra-changes]
    if: needs.detect-infra-changes.outputs.cluster-changed == 'true'
    # Uses gh workflow run to trigger provision-hetzner-k8s-cluster.yml

  # 4. Trigger deploy ONLY if deploy files changed (and cluster didn't change)
  trigger-deploy:
    needs: [detect-infra-changes]
    if:
      needs.detect-infra-changes.outputs.deploy-changed == 'true' &&
      needs.detect-infra-changes.outputs.cluster-changed != 'true'
    # Uses gh workflow run to trigger deploy-k8s-resources.yml
```

**Deployment Scenarios:**

1. **Cluster files change** (infra/k8s/hetzner/\*/cluster/, provision workflow, provision action):
   - Flow: CI (quality checks) → detect-infra-changes (cluster=true) → trigger-provision → Provision
     runs → Provision triggers Deploy
   - Result: ONLY Provision workflow appears in Actions (then Deploy when Provision completes)
   - Why: CI detects cluster changes and ONLY triggers provision workflow

2. **Deploy files change** (infra/k8s/base/, deploy-control.yaml, patches/, deploy workflow, deploy
   action):
   - Flow: CI (quality checks) → detect-infra-changes (deploy=true, cluster=false) → trigger-deploy
     → Deploy runs
   - Result: ONLY Deploy workflow appears in Actions
   - Why: CI detects deploy changes and ONLY triggers deploy workflow

3. **Both cluster + deploy files change**:
   - Flow: CI → detect-infra-changes (cluster=true, deploy=true) → trigger-provision ONLY →
     Provision → Deploy
   - Result: ONLY Provision workflow appears (then Deploy)
   - Why: Cluster changes take precedence; trigger-deploy condition excludes when
     cluster-changed=true

4. **Unrelated files change** (README.md, src/, docs/):
   - Flow: CI (quality checks) → detect-infra-changes (cluster=false, deploy=false) → NO triggers
   - Result: ONLY CI workflow appears in Actions
   - Why: No infrastructure changes detected, no workflows triggered

5. **Provision workflow files change**:
   - Flow: CI → detect-infra-changes (cluster=true) → trigger-provision → Provision runs
   - Result: Provision workflow appears (validates workflow changes)

6. **Deploy workflow files change**:
   - Flow: CI → detect-infra-changes (deploy=true) → trigger-deploy → Deploy runs
   - Result: Deploy workflow appears (validates workflow changes)

**CRITICAL Design Decisions:**

- **Explicit triggering**: CI uses `gh workflow run` to trigger provision/deploy ONLY when needed
- **No unnecessary workflows**: Workflows only appear when they have work to do
- **CI always enforced**: Quality checks MUST pass before any infrastructure operations
- **Cluster takes precedence**: If both cluster and deploy change, only provision is triggered
  (provision will trigger deploy)
- **Security-first**: Prevents deploying untested code; CI gates all infrastructure workflows

**Affected vs Full Suite:**

- **Pull Requests**: Uses `nx affected --base=origin/${{ github.base_ref }}` (50-90% faster)
- **Push to main/dev/test**: Runs full suite on all projects

**Why this matters**: PRs targeting different branches (dev/test/main) automatically compare against
the correct base. Local `pre-push` hook mimics this behavior.

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

**.NET** (workspace root, auto-discovered):

- `Directory.Build.props` - MSBuild properties and code analysis
- `Directory.Build.targets` - Post-build targets
- `Directory.Packages.props` - Central package management (CPM)
- `global.json` - .NET SDK version pinning
- `nuget.config` - NuGet sources and restore settings
- `.editorconfig` - Multi-language code style (includes C# StyleCop rules)
  - Root config (`root = true`) applies to all projects automatically
  - Project-specific configs (`root = false`) are optional overrides
  - Changes to root config take effect immediately for all projects without local overrides

### Line Endings & Encoding

**.gitattributes enforces LF** for cross-platform compatibility:

```
* text=auto eol=lf
```

**CRITICAL**: `auto-tag-projects.js` and `setup-dotnet-projects.js` preserve original BOM and line
endings when modifying JSON files. If you modify these scripts, maintain this behavior.

### Formatting Commands

**Workspace-level** (uses Prettier directly via `.prettierrc.js` — no .NET SDK required):

```bash
pnpm run nx:workspace-format        # Format all files
pnpm run nx:workspace-format-check  # Check all files
```

**Project-level** (only project source code):

```bash
pnpm run nx:node-format      # Format Node.js projects
pnpm run nx:python-format    # Format Python projects
pnpm run nx:dotnet-format    # Format .NET projects
```

**Prettier config**: Root `.prettierrc.js` re-exports `tools/node/configs/prettier-config.js`. All
tools (IDEs, lint-staged, workspace format scripts, CI) use the same config automatically.

**When to use which**: Use workspace format for repo-wide changes (pre-commit/pre-push). Use project
format during development of specific projects.

## Common Pitfalls & Solutions

**"No projects found for tag:runtime:python"** → Run `pnpm run nx:reset` to auto-tag projects

**".NET project not detected by Nx"**  
→ Run `pnpm run nx:reset` to sync solution file and generate project.json

**"Python environment not set up" in git hooks** → Hooks auto-create it via `uv sync`. If manual
setup needed: `pnpm run python:env`

**"Git hook modifying files during commit"** → By design, hooks use `--skip-reset`. Manual commands
(`pnpm run pre-commit`) DO reset for clean validation

**"Affected commands not working"** → Ensure `fetch-depth: 0` in CI checkout. Locally, set upstream:
`git push -u origin feature-branch`

**"NU1604 warning in .NET restore"** → Add explicit `<PackageReference>` with version to .csproj
(transitive dependency conflict)

## Integration Patterns

**Cross-language communication**: Not yet implemented (apps/ and libs/ are empty). When implemented,
expect:

- Node.js/TypeScript services exposing REST APIs
- Python FastAPI services for ML/data processing
- .NET services for enterprise integrations
- Shared libraries in `libs/` consumed across languages

**Dependency graph**: Nx automatically infers from:

- `package.json` dependencies (Node.js)
- `pyproject.toml` dependencies (Python: UV workspace members)
- `<ProjectReference>` elements (.NET)

**Testing integration points**: Not applicable yet (no projects). When implemented, use contract
testing (Pact) or integration tests in dedicated test projects.

## Quick Reference

```bash
# First-time setup
pnpm install                   # Install Node.js dependencies
pnpm run hooks:setup          # Configure Git hooks
pnpm run python:env           # Setup Python (if working with Python)
pnpm run dotnet:env           # Setup .NET (if working with .NET)
pnpm run infra:setup          # Setup infrastructure tools (Kustomize)

# Create projects
pnpm exec nx generate @nx/express:app my-api --directory=apps
dotnet new webapi -n MyApi -o apps/my-api
pnpm run nx:reset             # After creating any project

# Development
pnpm exec nx serve my-api          # Run specific project
pnpm run nx:node-dev          # Run all Node.js projects
pnpm run nx:python-test       # Test all Python projects

# Infrastructure
pnpm run infra:validate       # Validate all Kustomize manifests (all providers)
pnpm run infra:validate:dev   # Validate dev environment (all providers)
kustomize build infra/k8s/{provider}/{env} --enable-alpha-plugins  # Build manifests
kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins       # Example: Hetzner dev

# Validation
pnpm run pre-commit           # Quick checks (manual — required on feature branches)
pnpm run pre-push             # Full validation (manual — required on feature branches)
git commit                   # Triggers pre-commit hook (automatic on dev/test/main only)
git push                     # Triggers pre-push hook (automatic on dev/test/main only)

# Troubleshooting
pnpm run nx:reset             # Fix project detection, sync .NET, auto-tag
pnpm run nx:workspace-format  # Format all files (fix format check failures)
pnpm exec nx graph                 # Visualize project dependencies
```

## Kubernetes & Infrastructure

### Architecture Overview

**Centralized k8s management** - ALL Kubernetes manifests (infrastructure + applications) live in
`infra/k8s/` for consistent environment management. No scattered k8s folders in `apps/`.

**Kustomize-based GitOps deployment** with hierarchical control flags and in-memory secret
substitution. Infrastructure code in `infra/`:

- `k8s/base/` - Cloud-agnostic definitions for:
  - **Infrastructure**: PostgreSQL, Redis/Valkey, Jaeger (StatefulSets)
  - **Ingress**: Nginx Ingress Controller + routing rules (Ingresses)
  - **Applications**: API Gateway (future), microservices (future), webapp (future)
- `k8s/hetzner/{env}/` - Provider-specific overlays (dev/test/prod)
- `k8s/podman/local/` - Local development overlays
- `deploy-control.yaml` - Centralized deployment flags (master kill switch, time windows, rollback
  policies)

**Key Principle**: Infrastructure and applications deploy together via single workflow
(`deploy-k8s-resources.yml`). No separate app deployment workflows.

**Deployed Infrastructure**:

- **Nginx Ingress Controller**: External routing, TLS termination, WebSocket support
- **PostgreSQL 18 + PostGIS**: Multi-tenant databases (account_db, messaging_db, property_db)
- **Redis/Valkey 9.0**: ACL-based authentication, 5 users (admin, pubsub, cache, ratelimit, monitor)
- **Jaeger + OpenTelemetry**: Distributed tracing for microservices observability (optional sidecar)

**Planned Architecture** (applications not yet deployed):

- **API Gateway** (Ocelot .NET 9.0): Centralized entry point for microservices
  - Responsibilities: Request routing, authentication (JWT), rate limiting, circuit breaking
  - Routes external requests to internal microservices
  - Provides unified API surface with versioning support
- **Microservices** (Node.js/Python/.NET): Domain-specific services
  - account-service, messaging-service, property-service, social-service (future)
- **Web App** (Next.js): Frontend application (future)

**External Access** (via Ingress):

- api.yoursite.com → API Gateway (future) → Microservices (internal routing)
- yoursite.com → Web App (future)
- jaeger.yoursite.com → Jaeger UI (monitoring)

**Critical Pattern**: **NO secretGenerator, NO secrets.env files**. Secrets use placeholder values
(`StrongBase64Password`) in Git, substituted in-memory during CI/CD using `yq`.

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

**CRITICAL**: All 3 deployment jobs (dev/test/prod) must use **identical secret field names** and
**identical temp file naming** (`/tmp/postgres.secret.processed.yaml`). This was a source of bugs -
always verify consistency across all environments.

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
      allowed_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
      allowed_hours: '09:00-17:00'

    services:
      postgres:
        enabled: true
        auto_deploy: true
        rollback_on_failure: false # Service-level rollback

# Deployment strategies (resource-type level)
deployment_strategies:
  statefulset:
    timeout: '10m' # Configurable rollout timeout
    rollback_on_failure: true # Strategy-level rollback
```

**Control flag enforcement** (10+ flags active):

- `enabled` (environment + service level)
- `auto_deploy` (environment + service level)
- `deployment_windows` (time restrictions)
- `rollback_on_failure` (combined OR: service-level OR strategy-level)
- `statefulset_timeout` (overrides hardcoded timeouts)
- `require_manual_approval` (parsed but not yet enforced - GitHub Environments handle this)

**Workflow integration**: Each deployment job parses `deploy-control.yaml` and exits early if any
check fails (before credentials are loaded).

### Kustomize Structure

**Minimal Base Architecture**: Base contains ONLY configuration identical across all environments.
Environment-specific resources are defined entirely in patches.

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

**File naming convention**: `{service}.{kind}.yaml` (e.g., `postgres.statefulset.yaml`,
`postgres.configmap.yaml`, `redis.configmap.yaml`)

**Resource ordering** in kustomization.yaml (CRITICAL):

1. Secrets (processed first)
2. ConfigMaps
3. Services (must exist before StatefulSet for stable DNS)
4. StatefulSets

**Strategic merge behavior**: When base omits resources/storage, patches ADD complete sections (not
merge/replace fields).

**Environment Variable Pattern**: a strategic-merge patch **merges** `env:` entry by entry, keyed on
`name` — it does **not** replace the array. So a patch lists only what it changes:

- **Base**: Define all common environment variables (OTLP settings, sampling config, storage type)
- **Patches**: Define ONLY environment-specific variables (retention periods, resource limits)
- Example: Jaeger base defines SAMPLING_STRATEGIES_FILE, patches only define BADGER_SPAN_STORE_TTL

Never re-list the base variables in a patch "to be safe". Copying `DATABASE_URL` and its
`secretKeyRef` into four overlays gives four copies to drift, and the next person to change the base
has no signal that the overlays silently override it.

Verified on the running cluster: `property-service`'s local patch defines only `NODE_ENV`, and the
rendered Deployment carries all nine variables (`PORT`, `HOST`, `PROPERTY_DB_*`, `DATABASE_URL`).
This paragraph previously claimed the opposite — that the array is replaced — which contradicted the
very prescription beneath it and made automated reviewers flag every correct patch in the repo.

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
- `workflow_dispatch` (manual deployment with environment selection; also invoked by provisioning
  after CI completes)
- `workflow_call` (available for reuse by other workflows if needed)

**Job structure** (identical for all 3 environments):

1. Load deployment control flags (parse `deploy-control.yaml`)
2. Check flags in order (global → environment → service → auto-deploy)
3. Set up kubeconfig (from GitHub Secrets)
4. **Substitute secrets** in postgres.secret.yaml and redis.secret.yaml (in-memory)
5. Build Kustomize manifests
6. **Error-driven apply**: Try `kubectl apply` → On immutable field error → Extract failed resource
   names → Delete with `--cascade=orphan` → Retry
7. **Wait for workload rollout** with configurable timeout:
   - Dynamically discovers all workloads: StatefulSets, Deployments, DaemonSets
   - Uses manifest-based discovery:
     `yq -N e 'select(.kind == "StatefulSet") | .metadata.name' manifests.yaml`
   - Checks rollout status for each: `kubectl rollout status {type}/{name}`
   - Fail-but-continue pattern: checks ALL workload types even if earlier ones fail (better
     diagnostics)
8. **Rollback on failure** (if enabled):
   - Attempts rollback for ALL workload types (StatefulSets, Deployments, DaemonSets)
   - Continues rollback attempts even if individual rollbacks fail
   - Reports any failures requiring manual intervention

**Kubernetes Immutable Field Handling**: Uses error-driven pattern to handle immutable fields across
**5 resource types** (StatefulSet, Deployment, Service, DaemonSet, Job). Instead of preemptive
checks, lets kubectl fail first, then parses stderr to identify resource type and extract specific
resource names, deletes only those affected resources. Uses `--cascade=orphan` for stateful
resources (preserves PVCs/Pods). This eliminates false positives and scales to any number of
resources. Applied to all deployment targets: GitHub Actions (dev L312, test L636, prod L983) and
local (Skaffold + scripts in tools/infra).

**Workload Discovery Pattern**: All workload operations use manifest-based discovery:

```bash
STATEFULSETS=$(yq -N e 'select(.kind == "StatefulSet") | .metadata.name' manifests.yaml 2>/dev/null | grep -v '^---$' | tr '\n' ' ' || echo "")
DEPLOYMENTS=$(yq -N e 'select(.kind == "Deployment") | .metadata.name' manifests.yaml 2>/dev/null | grep -v '^---$' | tr '\n' ' ' || echo "")
DAEMONSETS=$(yq -N e 'select(.kind == "DaemonSet") | .metadata.name' manifests.yaml 2>/dev/null | grep -v '^---$' | tr '\n' ' ' || echo "")
```

This pattern ensures the workflow uses a single source of truth (manifests.yaml), eliminating
kubectl API calls and improving consistency across rollout/rollback operations.

**Rollback logic** (combined OR):

```yaml
if: |
  always() &&
  steps.deploy-control.outputs.enabled == 'true' &&
  (steps.deploy-control.outputs.rollback_on_failure == 'true' || 
   steps.deploy-control.outputs.statefulset_rollback == 'true') &&
  steps.rollout.outputs.rollout_success != 'true'
```

**Why OR logic**: Allows flexible control (disable at service level for manual investigation, or
disable at strategy level to prevent all automatic rollbacks).

### Cluster Provisioning Workflow

**provision-hetzner-k8s-cluster.yml** provisions K3s clusters on Hetzner Cloud using the
**provision-hetzner-k8s-cluster** composite action:

**Architecture:** 3 deployment jobs (update-dev-cluster, update-test-cluster, update-prod-cluster)
call a shared composite action (`.github/actions/provision-hetzner-k8s-cluster`) with
environment-specific parameters. This eliminates ~295 lines of duplication across the 3 jobs.

**Workflow sequence**:

1. Detect cluster config changes using dorny/paths-filter
2. Route to appropriate job (dev/test/prod) based on branch and changes
3. **Composite action performs**:
   - Check `auto_deploy: true` flag in cluster-config.yaml
   - Install kubectl, Helm, hetzner-k3s CLI
   - Setup SSH keys from GitHub Secrets
   - Substitute secrets in config
   - Create/update cluster using hetzner-k3s CLI (includes **automatic cert-manager installation**)
   - Wait for cluster readiness (nodes, CSI driver, StorageClass) with configurable timeout
   - **Verify cert-manager installation** (check pods in cert-manager namespace)
   - **Upload KUBECONFIG** to GitHub environment secrets using GitHub CLI with PAT
   - **Trigger deploy-k8s-resources.yml** via workflow_dispatch (passes environment parameter)

**TLS Certificate Management**: cert-manager v1.13.3 + `letsencrypt-prod` ClusterIssuer installed
automatically during cluster provisioning via `additional_post_k3s_commands` in cluster-config.yaml.
Installation runs on first master node only (prevents race conditions), waits for deployment
readiness (180s timeout), creates ClusterIssuer inline using heredoc (no separate manifest files).
Certificates automatically provisioned when Ingress resources deployed (~2-5 min via ACME HTTP-01
challenge).

**CRITICAL**: Path filters prevent race conditions:

- `provision-hetzner-k8s-cluster.yml` triggers on `infra/k8s/hetzner/*/cluster/*.yaml` AND
  `.github/actions/provision-hetzner-k8s-cluster/**` changes
- `deploy-k8s-resources.yml` **excludes** cluster configs via `!infra/k8s/hetzner/**/cluster/**`
- This ensures cluster creation completes BEFORE resource deployment starts

**KUBECONFIG Upload Strategy**: Uses environment-scoped secrets with Personal Access Token (PAT).
The default `github.token` has limited permissions:

- **Read-only** access to the secrets API (cannot write secrets)
- **No** `actions:write` permission (cannot trigger workflows)

Both operations return `HTTP 403: Resource not accessible by integration`. Solution requires
`INFRA_DEPLOY_TOKEN` (PAT with `repo` scope) stored as repository secret. Implementation:
`gh secret set KUBECONFIG --env {env}` and `gh workflow run deploy-k8s-resources.yml` both use PAT
authentication. Environment secrets provide better security (scoped access, protection rules, audit
trail) compared to repository secrets with prefixes. GitHub CLI handles libsodium encryption
automatically.

### Validation Workflows

**PR validation job** (`validate-pr`):

- Runs on pull requests targeting dev/test/main
- Detects which environments changed (path filter)
- Validates Kustomize builds WITHOUT secret substitution
- **Uses placeholder values** - local builds will show `StrongBase64Password`
- Fast feedback (~30 seconds)

**CRITICAL**: Validation uses templates directly (no secret substitution). This is intentional -
validates YAML structure, not secret values.

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

**"Prod deployment fails with 'field does not exist' error"** → Secret field names mismatch between
workflow and secret template. All 3 jobs must use identical field names.

**"Secret shows StrongBase64Password in deployed pods"** → Workflow secret substitution failed.
Check GitHub Secrets are configured for the environment. Verify yq pipeline completed successfully.

**"StatefulSet stuck in pending - PVC not binding"** → StorageClass `hcloud-volumes` not available.
Hetzner CSI driver creates this automatically. Verify CSI driver is running:
`kubectl get pods -n kube-system -l app=hcloud-csi-controller`

**"Kustomize build fails with 'resource not found'"** → Check resource ordering in
kustomization.yaml. Secrets must come before resources that reference them.

**"Deployment control flags not working"** → Workflow reads flags but may not enforce all (see
`deploy-control.yaml` metadata section for enforcement status).

**"Rollback not triggering on failure"** → Check BOTH `rollback_on_failure` (service level) AND
`statefulset_rollback` (strategy level). Either can trigger rollback (OR logic).

**"Resource updates failing with immutable field errors"** → Immutable fields changed on
StatefulSet/Deployment/Service/DaemonSet/Job. Workflow automatically detects error type, extracts
resource names, deletes with appropriate flags (`--cascade=orphan` for stateful resources), and
retries. Supports 5 resource types. For local testing, use `pnpm run skaffold:deploy`.

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
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://jaeger-svc:4318/v1/traces',
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

### Infrastructure Scripts (ALWAYS USE THESE)

**CRITICAL**: The Node scripts under `tools/infra/` are the source of truth for infrastructure
operations. `pnpm run ...` scripts are convenience aliases.

**Local Cluster Management**:

```bash
# First-time setup or cluster recreation
pnpm run infra:local:cluster:setup   # Creates Kind/Podman cluster with proper context

# Delete cluster (cleanup)
pnpm run infra:local:cluster:delete   # Removes cluster and context
```

**Local Kubernetes Resources**:

```bash
# Watch loop — full stack (all services + clients)
pnpm run skaffold

# Watch loop — services only (use when running a frontend app locally for HMR)
pnpm run skaffold:services
pnpm run skaffold:deploy

# Apply resources — services only
pnpm run skaffold:services:deploy

# Delete resources (safe context)
pnpm run skaffold:delete
```

**Frontend development workflow** (recommended for frontend app changes):

```bash
# Terminal 1 — services only in K8s (no frontend rebuilds on client-side changes)
pnpm run skaffold:services

# Terminal 2 — frontend app dev server with full HMR (instant ~100ms feedback)
pnpm run cribstop:web   # or whichever frontend app you're working on
```

**Skaffold multi-module structure** (`skaffold.yaml`):

| Module     | Contains                                                   | Run with                        |
| ---------- | ---------------------------------------------------------- | ------------------------------- |
| `services` | API gateway, microservices, infra manifests, port-forwards | `pnpm run skaffold:services`    |
| `clients`  | Frontend apps and their port-forwards                      | `pnpm run skaffold` (runs both) |

`clients` declares `requires: [services]` so it always brings up the services layer. When adding a
new frontend app, add its artifact and port-forward to the `clients` module only. Frontend dev
servers talk to the gateway via the `localhost:8080` port-forward from the `services` module.

**Services-only auto-exclusion**: When `--module services` is detected, `run-skaffold.js`
auto-generates a Kustomize overlay at `infra/k8s/podman/.generated/services-only/` that removes
client-app resources (Deployments, Services, Ingresses) from the manifests. The exclusion list is
derived from the `clients` module's artifact image names in `skaffold.yaml` — zero manual
maintenance. The `services-only` Skaffold profile is activated automatically.

**Validation**:

```bash
# Validate all environments
pnpm run infra:validate

# Validate specific environment
pnpm run infra:validate:dev
pnpm run infra:validate:test
pnpm run infra:validate:prod
```

**Setup Tools** (one-time):

```bash
# Install Kustomize, kubectl, yq, etc.
pnpm run infra:setup
```

**Why use scripts instead of kubectl directly?**

- ✅ Automatic context validation (prevents deploying to wrong cluster)
- ✅ Immutable field error handling (auto-deletes and retries)
- ✅ Secret substitution for local testing
- ✅ Consistent behavior with CI/CD workflows
- ✅ Better error messages and logging

### Kubernetes Quick Reference (Manual Commands - Use Only for Inspection)

```bash
# Check deployment status
kubectl get statefulset postgres redis jaeger
kubectl get pods -l app=postgres
kubectl get pvc -l app=postgres
kubectl logs postgres-0

# Jaeger UI (port-forward)
kubectl port-forward svc/jaeger-svc 16686:16686
# Open: http://localhost:16686

# Ingress access (if configured)
kubectl get ingress
kubectl describe ingress jaeger

# Manual deployment (Hetzner - requires GitHub CLI)
gh workflow run deploy-k8s-resources.yml -f environment=dev

# Manual rollback (use only if automated rollback fails)
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
| Deployment action      | `.github/actions/deploy-k8s-resources/action.yml`                |
| Cluster provisioning   | `.github/workflows/provision-hetzner-k8s-cluster.yml`            |
| Provisioning action    | `.github/actions/provision-hetzner-k8s-cluster/action.yml`       |

## Product Backlog (GitHub Issues & Projects)

Product/planning work lives on a single shared GitHub Projects v2 board ("Cribstop Platform
Backlog"), not in a separate PM tool. Two agents run the loop: a `cribstop-product-owner` agent
(`.agents/agents/cribstop-product-owner.md`) authors, prioritizes, and grooms tickets; a
`principal-engineer` agent (`.agents/agents/principal-engineer.md`) autonomously picks the top Ready
ticket, decomposes it, orchestrates specialized subagents for parallel domain work
(frontend/backend/database/infra) while personally verifying everything they produce, and opens a PR
titled `#<issue> type(scope): ...` with `Closes #<issue>` in the body — In Review is its terminal
state; a human merges. Interactive sessions can do the same via the `pick-next-ticket` and
`close-ticket` skills. None of them talk to `git`/`gh` directly for board operations — everything
goes through the wrapper scripts below (per the "Always Use Project Scripts" rule).

**Board**: [Cribstop Platform Backlog](https://github.com/users/jmbilizi/projects/7) (user-level
project — Projects v2 permissions for a user-owned board are granted per-user, not per-org).

**Board model:**

- **Issues** are the ticket unit (Problem / Acceptance Criteria / Technical Notes).
- **Fields**: `Status` (Backlog → Ready → In Progress → In Review → Done, single-select) — "ready to
  work" is `Status: Ready`, not a separate field, so a ticket can't be simultaneously Backlog and
  ready-for-dev. `Priority` (P0–P2 — three levels on purpose; low-value work gets declined by the
  product owner, not parked at a P3 that never ships). `Size` (XS/S/M/L/XL, optional estimate).
  Field _option_ matching in the wrapper scripts is case-insensitive ("In progress" on the board ==
  "In Progress" in docs/commands), so board-UI casing edits can't break automation.
- **Labels** carry scope tagging (`scope:cribstop-web`, `scope:api-gateway`,
  `scope:account-service`, `scope:multi-model-inference`, `scope:shared` for cross-cutting work) and
  type (`type:bug`/`type:feature`/`type:chore`). Scope values use each component's **canonical
  platform name** — today that equals the Nx project name for everything except the web app, whose
  Nx project is currently `cribstop-next` (a framework-detail name expected to eventually be renamed
  to match `cribstop-web`; the build→deploy name mapping already lives in
  `tools/docker/image-name-map.json`). These labels are unrelated to the Nx _tag_ dimensions despite
  the shared prefixes: an Nx `scope:` tag is a business-domain classifier and an Nx `type:` tag a
  project-kind classifier — different vocabulary, different system. Prefix convention: prefixed
  labels (`type:`, `scope:`) are dimensions picked from the taxonomy; unprefixed labels (`blocked`,
  `human-action`) are orthogonal overlays that combine with any Status or dimension. Labels are
  multi-valued (a ticket touching web + gateway gets both scope labels), which Projects v2 fields
  cannot do — there's no multi-select field type. `blocked` marks anything stuck regardless of its
  current Status (Status's linear progression has no room for a branch state). `human-action` marks
  tickets only a human can complete (provision a secret/API key per environment, PAT scopes, DNS,
  paid accounts, legal/broker sign-off) — authored as a runbook (what / where / how / by when) with
  `Blocks #<n>` referencing the work waiting on it; the engineer agent files these whenever it hits
  such a dependency, adds `blocked` to the dependent ticket, and moves on to unblocked work. All
  taxonomy labels are provisioned on the repo (labels must pre-exist — `gh:ticket:create` passes
  them through to `gh issue create`, which rejects unknown labels).
- **Milestones are epics** — an outcome-scoped body of work, not a point in time. The work hierarchy
  has three levels, each with one owner: **milestone = epic** (product owner creates via
  `gh:milestone`, decomposes into tickets, and owns membership) → **issue = story/deliverable** (the
  Kanban unit engineers pull) → **Implementation Plan item = task** (engineer-owned breakdown inside
  the ticket). A milestone is never a scheduler: the pull order stays `Status=Ready` sorted by
  Priority, and an at-risk epic gets its remaining stories' Priority raised, not "worked as a
  sprint". Scope rules are enforced in the wrapper: `gh:milestone -- close` refuses while stories
  are open (an epic closes when its scope is delivered — ship the stories or `--remove-milestone`
  what was descoped); due dates are optional context. Milestones live on the issue (one per issue,
  GitHub-enforced); the board's `Milestone` field reflects them automatically, and
  `gh:milestone -- list` reports delivered/total per epic. Engineers treat a ticket's milestone as
  read-only context.
- **Implementation Plan & branching**: one ticket = one branch (`<issue>-short-slug`, always cut
  from `dev`) = one PR (targeting `dev`). Before coding, the engineer writes an ordered checklist
  into a marker-delimited `## Implementation Plan` section of the ticket body
  (`gh:ticket:update-status -- --plan-file`) — each item independently testable, mapping to roughly
  one commit — and checks items off as they land, so any later session can resume mid-ticket by
  reconciling the checklist against the branch's commits. The plan section is the only part of the
  body the engineer script can touch; Problem / Acceptance Criteria / Technical Notes remain the
  product owner's. There is no parent/child ticket hierarchy: a ticket too big for one reviewable PR
  is bounced back with a proposed split, and the product owner cuts it into sequenced sibling
  tickets (ordering expressed with `blocked` + "Blocked by #n" in the body).

**Commands** (`tools/github/*.js`, wrapping `gh issue`/`gh project`/`gh api graphql`):

```bash
# One-time, and again whenever a field/option is added or renamed on the board:
pnpm run gh:project:sync-schema

# Create a ticket (issue + project item + fields + labels, atomically):
pnpm run gh:ticket:create -- --title "..." --priority P1 --size M --status Ready \
  --scope cribstop-web --label type:feature

# Find work (this is what pick-next-ticket queries):
pnpm run gh:ticket:list -- --status Ready --priority P0

# Product owner: reprioritize/groom (Status/Priority/Size — full field access):
pnpm run gh:ticket:update-fields -- --issue 42 --priority P0

# Product owner: correct a ticket's spec after creation. Replaces the whole body with the file's
# contents apart from the engineer's Implementation Plan block, carried over byte-for-byte; refuses
# (writing nothing) if the file itself contains a bare plan marker (one quoted in backticks/a fence
# is fine):
pnpm run gh:ticket:update-fields -- --issue 42 --body-file ./spec.md

# Product owner: labels on an existing ticket (both flags repeatable; unknown labels fail loudly):
pnpm run gh:ticket:update-fields -- --issue 42 --add-label blocked --remove-label type:chore

# Engineer: move through the workflow (Status + assignee/comment only, can't touch Priority/Size):
pnpm run gh:ticket:update-status -- --issue 42 --status "In Progress" --claim

# Engineer: write/refresh the Implementation Plan checklist (touches ONLY the marker-delimited section):
pnpm run gh:ticket:update-status -- --issue 42 --plan-file ./plan.md

# Full detail — body, fields, labels, comments:
pnpm run gh:ticket:view -- --issue 42

# Product owner: epics (milestone = epic, issue = story, plan item = task; list shows
# delivered/total per epic; assignment via gh:ticket:create/update-fields -- --milestone
# "<title>" / --remove-milestone; close refuses while stories are open):
pnpm run gh:milestone -- list
pnpm run gh:milestone -- create --title "Services MVP" --description "..."
pnpm run gh:milestone -- update --title "Services MVP" --description "..." [--new-title "..."]
```

`update-ticket-fields.js` vs `update-ticket-status.js` is a deliberate least-privilege split:
engineer-facing flows (`pick-next-ticket`, `close-ticket` skills) only ever get the script that
can't touch Priority/Size, enforced at the script level rather than by trusting an agent's prompt.
The split is symmetric on the body: `update-fields --body-file` rewrites everything but the plan
block and cannot touch it (it is carried over byte-for-byte, and a body file containing a bare plan
marker — one quoted in backticks or a fence is prose and is fine — is rejected outright, as it is at
creation time by `gh:ticket:create`), while `update-status --plan-file` rewrites only the plan block
and cannot touch the product owner's sections. Both directions first run the same legibility guard
over the issue's existing body: if it carries structural plan markers at all, there must be exactly
one legible pair — one bare `<!-- implementation-plan:start -->` line and one bare
`<!-- implementation-plan:end -->` line that can actually be read back as a block. Markers that are
duplicated, unbalanced, mentioned inline mid-line, or hidden by an unclosed code fence are refused
with `✗ … Nothing was written.` instead of guessed at, because a guess appends a second block or
silently drops the plan, and the run after that splices across the wrong span and eats a whole
section. Fix the markers on the issue by hand and re-run. Unit tests for both directions live in
`tools/github/lib/issue-body.test.js` — run them with `pnpm run tools:test`.

Unknown labels are validated by `gh` at write time rather than pre-checked locally, so a rejected
label can leave earlier edits in the same invocation already applied — e.g.
`--issue 42 --status Ready --add-label typo` writes Status first, then fails on the label, and the
Status change stays. That's the accepted trade-off of letting `gh` reject unknown labels, not a bug;
a failed call isn't necessarily an atomic no-op.

**Session brief**: a repo-scoped SessionStart hook (`.claude/settings.json` →
`tools/github/session-brief.js`, manual run: `pnpm run gh:session-brief`) primes every Claude Code
session with the board state — In Progress tickets to resume, top Ready tickets by priority, or the
exact setup step that's missing (gh install/auth/scopes/schema sync). It always exits 0 and fails
quiet on network errors so a broken board can never block a session; its output is injected into
session context, so keep it small if extending it.

**Config**: `tools/github/project.config.js` defaults to the board above (`owner: jmbilizi`,
`projectNumber: 7`), overridable via `GH_PROJECT_OWNER` / `GH_PROJECT_REPO` / `GH_PROJECT_NUMBER`
env vars. Field/option UUIDs are cached in `tools/github/project-schema.json` by
`gh:project:sync-schema` — the other scripts never re-query the board schema per call.

**Auth**: try a fine-grained PAT first, scoped to Issues (repo) + Projects (this user account) —
straightforward for a user-owned board like this one. Fine-grained PATs have historically had gaps
in Projects v2 GraphQL support for _org_-owned boards specifically; if `gh project field-list`/
`item-edit` fail with a permissions error, fall back to a classic PAT (`repo` + `project` scopes).
Either way, store it as `GH_AUTOMATION_TOKEN` for CI/unattended use — interactive Claude Code
sessions rely on the developer's own `gh auth login` session instead.

## External Dependencies

- **Nx 22.0.1**: Monorepo orchestration
- **Node.js 20.19.5**: Runtime (LTS, pinned in `.nvmrc`)
- **Python 3.11**: Runtime (pinned in `.python-version`, auto-downloaded by UV)
- **.NET SDK 8.0**: Runtime (pinned in `tools/dotnet/configs/global.json`)
- **GitHub Actions**: CI/CD platform (`.github/workflows/ci.yml`,
  `.github/workflows/deploy-k8s-resources.yml`,
  `.github/workflows/provision-hetzner-k8s-cluster.yml`)
- **Kustomize**: Kubernetes manifest templating (required for local testing and workflows)
- **kubectl**: Kubernetes CLI (workflows use version from GitHub Actions runner)
- **yq**: YAML processor for secret substitution and config parsing (installed in workflows)
- **hetzner-k3s**: K3s cluster provisioning CLI (v2.4.1, installed by provision-hetzner-k8s-cluster
  action)
- **gh (GitHub CLI)**: Issues/Projects automation for the product backlog (see
  [Product Backlog](#product-backlog-github-issues--projects) below) and manual workflow dispatch
  (`gh workflow run ...`). Installed by `pnpm run gh:setup` (kept separate from `infra:setup` — `gh`
  is unrelated to the Kubernetes/local-cluster tooling that script manages); preinstalled on GitHub
  Actions' `ubuntu-latest` runners, so no CI install step is needed.

- **UV**: Python package manager and workspace tool (auto-installed by `python:env` script)

**Version management**: `.nvmrc` (Node), `global.json` (.NET), `.python-version` (Python 3.11,
auto-downloaded by UV)
