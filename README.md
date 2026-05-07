# Polyglot Monorepo

This monorepo is set up to support .NET, Node/TypeScript, Python, Next.js, React Native (Expo), and
FastAPI apps.

## Requirements

- **Node.js**: 20.19.5 or higher (LTS)
- **Nx**: 22.0.1 (automatically installed)
- **.NET SDK**: 8.0 or higher
- **Python**: 3.8 or higher
- **Kustomize**: Auto-installed via `pnpm run infra:setup` (for infrastructure work)

## Getting Started

```bash
# Install Node.js dependencies
pnpm install

# Setup git hooks
pnpm run hooks:setup

# Language-specific setup (as needed)
pnpm run python:env:full    # Python + UV + Poetry
pnpm run dotnet:env         # .NET development
pnpm run infra:setup        # Kubernetes/Kustomize (for infrastructure work)

# Local cluster setup (optional - for local K8s development)
pnpm run infra:local:cluster:setup    # Kind + Podman cluster
```

See individual stack documentation for details:

- [Python Documentation](./tools/python/docs/README-PYTHON.md)
- [.NET Documentation](./docs/dotnet-development.md)
- [Infrastructure Tools](./tools/infra/README.md)

### Quality Checks

The repository has a two-tier validation system to balance speed with safety:

**Automatic (Git Hooks):**

- **Pre-commit**: Fast checks (format + lint + type) on affected projects (~5-15s)

# Formatting commands

pnpm run nx:workspace-format # Format all files (workspace + projects) pnpm run nx:node-format #
Format Node.js projects only pnpm run nx:python-format # Format Python projects only pnpm run
nx:dotnet-format # Format .NET projects only

# Infrastructure validation

pnpm run infra:validate # Validate all providers and environments (auto-discovery) pnpm run
infra:validate:dev # Validate dev across all providers pnpm run infra:validate:test # Validate test
across all providers

# Full validation (same as pre-push hook)

pnpm run pre-push

# Quick validation (same as pre-commit hook)

pnpm run pre-commit

# Formatting commands

pnpm run nx:workspace-format # Format all files (workspace + projects) pnpm run nx:node-format #
Format Node.js projects only pnpm run nx:python-format # Format Python projects only pnpm run
nx:dotnet-format # Format .NET projects only

# Individual language checks (fast, uses cached nx state)

pnpm run nx:node-lint # Lint Node.js projects pnpm run nx:python-test # Test Python projects pnpm
run nx:dotnet-build # Build .NET projects

# Reset nx cache (run this after structural changes)

pnpm run nx:reset

```

> **Tip:** Use `nx:workspace-format` to format all files including repo-level files (scripts/, docs/, package.json, etc.). Use project-specific format commands when working on individual projects.

The scripts automatically detect your branch:

- **On feature branches**: Checks affected projects only (fast)
- **On main/dev/test**: Checks all projects (comprehensive)

**Smart Language Detection:**

The scripts only run checks for affected languages:

- Only Node.js files changed? → Skips Python/NET setup and checks
- Only Python files changed? → Auto-creates venv if needed, skips .NET
- Mixed changes? → Runs only the necessary language checks

**Performance Optimization:**

The validation system is optimized for both speed and accuracy:

- **Git hooks** (`pre-commit`, `pre-push`): Skip `nx:reset` to avoid modifying files during commit/push. Fast and non-invasive.
- **Manual validation** (`pnpm run pre-commit`, `pnpm run pre-push`): Runs `nx:reset` once at start for clean state, then all checks without redundant resets.
- **Individual commands** (`pnpm run nx:node-lint`, etc.): Skip reset for instant execution during development.

**When to use each:**

- **Git hooks**: Automatic validation during commit/push (fast, no file modifications)
- **`pnpm run pre-push`**: Before creating PRs or when you want full validation with clean workspace state
- **`pnpm run pre-commit`**: Quick manual validation with clean workspace state
- **Individual scripts**: During active development for instant feedback

Both hooks and `pnpm run pre-push` perfectly mirror what CI will verify, so if they pass locally, CI will pass too.

See the [CI/CD documentation](./docs/ci-cd.md#quality-checks) for more details.

## Root Tooling & Configuration

- **Nx**: Monorepo orchestration for all supported frameworks
- **Unified Git Hooks System**: Centralized pre-commit and pre-push hooks for all languages
- **Husky & lint-staged**: Pre-commit hooks for linting/formatting staged files
- **ESLint & Prettier**: Linting and formatting for JS/TS/React/Next/Node
- **Black, Flake8, mypy**: Formatting, linting, and type checking for Python
- **.editorconfig**: Consistent editor settings across all languages
## Documentation

### Core Workflows
- [CI/CD Pipeline](./docs/ci-cd.md): Continuous Integration workflow architecture
- [Unified Git Hooks](./tools/hooks/docs/README.md): Pre-commit/pre-push validation system

### Language-Specific
- [Python Documentation](./tools/python/docs/README-PYTHON.md): Python development guide
- [.NET Documentation](./docs/dotnet-development.md): .NET setup and workflows
- [Node.js Documentation](./docs/node-development.md): Node.js development guide
- [TypeScript Documentation](./docs/typescript-development.md): TypeScript standards

### Infrastructure
- [Infrastructure Tools](./tools/infra/README.md): Kustomize setup and validation
- [Kubernetes Infrastructure](./infra/k8s/readme.md): K8s deployment documentation

### Other
- [Migration Notes](./docs/MIGRATION-NOTES.md): Version updates and migration
- [Project Templates](./docs/project-templates.md): Creating new projects
- [.NET Documentation](./docs/dotnet-development.md): Setting up and working with .NET in this repo
- [Node.js Documentation](./docs/node-development.md): Node.js development guide
- [Project Templates](./docs/project-templates.md): Creating new projects using templates
- [TypeScript Documentation](./docs/typescript-development.md): TypeScript standards and practices

## Environment Variables

- Use `.env` files for environment-specific configuration
- See `.env.example` for required variables

## Ignore Rules

- The `.gitignore` file covers:
  - Nx build and cache folders
  - Node modules, dist, coverage, and debug logs
  - Python caches, virtual environments, and lock files
  - .NET build output and user-specific files
  - OS and IDE-specific files
  - Environment variable files

## Contributing

- Please follow code style and commit guidelines enforced by pre-commit hooks
- Run lint, format, and type-check commands before submitting a PR

# Local Kubernetes Resource Operations (Kind+Podman)

All local resource scripts (apply, delete, build) automatically enforce the correct kubectl context for your local Kind cluster. This prevents accidental changes to the wrong cluster, even if you have multiple clusters or cloud contexts configured.

- Deploy resources the same way as production: apply the full Kustomize overlay via Skaffold.

- Scripts: `skaffold`, `skaffold:deploy`, `skaffold:delete`
- Implementation: Uses `tools/infra/run-skaffold.js` and enforces the correct `kubectl` context before touching the cluster.
- If the context cannot be switched, the script aborts with a clear error.

Default registry repo:

- Local dev defaults to `localhost:5001`.
- Override with `DEFAULT_REPO` or `SKAFFOLD_DEFAULT_REPO` (e.g., `ghcr.io/<org-or-user>/<repo>` for CI/CD).

The target cluster name comes from `infra/k8s/podman/local/cluster/cluster-config.yaml` (`cluster_name`), and the context is typically `kind-<cluster_name>`.
```
