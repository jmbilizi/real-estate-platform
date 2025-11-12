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

**Pre-Commit (Fast - ~5-15s)**

- Format + Lint + Type Check only
- Runs on affected projects
- Auto-creates Python venv only if Python projects affected
- Uses `--skip-reset` flag (no workspace file modifications)

**Pre-Push (Complete - ~30s-2min)**

- Format + Lint + Type + Test + Build
- Mimics CI behavior exactly
- Feature branches: affected projects | Base branches: all projects
- Uses `--skip-reset` flag (no workspace file modifications)

**Why `--skip-reset` in hooks**: Git operations must not modify workspace files (prevents unstaged changes after commit). Manual commands (`npm run pre-commit`, `npm run pre-push`) DO run reset for clean state validation.

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

# Create projects
npx nx generate @nx/express:app my-api --directory=apps
dotnet new webapi -n MyApi -o apps/my-api
npm run nx:reset             # After creating any project

# Development
npx nx serve my-api          # Run specific project
npm run nx:node-dev          # Run all Node.js projects
npm run nx:python-test       # Test all Python projects

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

## External Dependencies

- **Nx 22.0.1**: Monorepo orchestration
- **Node.js 20.19.5**: Runtime (LTS, pinned in `.nvmrc`)
- **Python 3.8+**: Runtime (auto-installed by `py-env` scripts)
- **.NET SDK 8.0**: Runtime (pinned in `tools/dotnet/configs/global.json`)
- **GitHub Actions**: CI/CD platform (`.github/workflows/ci.yml`)

**Version management**: `.nvmrc` (Node), `global.json` (.NET), `pyproject.toml` (Python 3.8+ in tool.poetry.dependencies)
