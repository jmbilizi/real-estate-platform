# Polyglot Monorepo

This monorepo is set up to support .NET, Node/TypeScript, Python, Next.js, React Native (Expo), and FastAPI apps.

## Requirements

- **Node.js**: 20.19.5 or higher (LTS)
- **Nx**: 22.0.1 (automatically installed)
- **.NET SDK**: 8.0 or higher
- **Python**: 3.8 or higher

## Getting Started

- Install dependencies for each stack as needed
- Use Nx for orchestration and task running
- See individual app and lib folders for more details
- Run `npm install` to set up Node/TypeScript tooling
- For Python development, see the [Python Documentation](./tools/python/docs/README-PYTHON.md)
- Run `dotnet restore` to set up .NET tooling

### Quality Checks

The repository has a two-tier validation system to balance speed with safety:

**Automatic (Git Hooks):**

- **Pre-commit**: Fast checks (format + lint + type) on affected projects (~5-15s)
- **Pre-push**: Full checks (format + lint + type + test + build) on affected projects (~30s-2min)
- **Post-merge**: Auto-installs dependencies when package files change after pull/merge

**Manual:**

```bash
# Full validation (same as pre-push hook)
npm run check

# Quick validation (same as pre-commit hook)
npm run check:quick
```

The scripts automatically detect your branch:

- **On feature branches**: Checks affected projects only (fast)
- **On main/dev/test**: Checks all projects (comprehensive)

**Smart Language Detection:**

The scripts only run checks for affected languages:

- Only Node.js files changed? → Skips Python/NET setup and checks
- Only Python files changed? → Auto-creates venv if needed, skips .NET
- Mixed changes? → Runs only the necessary language checks

Both hooks and `npm run check` perfectly mirror what CI will verify, so if they pass locally, CI will pass too.

See the [CI/CD documentation](./docs/ci-cd.md#quality-checks) for more details.

## Root Tooling & Configuration

- **Nx**: Monorepo orchestration for all supported frameworks
- **Unified Git Hooks System**: Centralized pre-commit, post-merge, and pre-push hooks for all languages
- **Husky & lint-staged**: Pre-commit hooks for linting/formatting staged files
- **ESLint & Prettier**: Linting and formatting for JS/TS/React/Next/Node
- **Black, Flake8, mypy**: Formatting, linting, and type checking for Python
- **.editorconfig**: Consistent editor settings across all languages
- **.gitignore**: Comprehensive ignore rules for Node, Python, .NET, Nx, OS, and IDEs
- **GitHub Actions**: Production-ready CI pipeline with Format → Lint → Test → Build workflow for Node.js, Python, and .NET
- **Auto-Tagging**: Projects are automatically tagged based on their executors for seamless `--projects=tag:*` filtering

## Documentation

- [CI/CD Pipeline](./docs/ci-cd.md): Continuous Integration workflow architecture and optimizations
- [Migration Notes](./docs/MIGRATION-NOTES.md): Version updates and migration information
- [Unified Git Hooks](./tools/hooks/docs/README.md): Documentation for the unified Git hooks system
- [Python Documentation](./tools/python/docs/README-PYTHON.md): All Python-related documentation
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
