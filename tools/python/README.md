# Python Tools Directory

This directory contains all the Python-related tooling and configuration for the Polyglot monorepo.

## Quick Start

```bash
# One-time setup (installs UV if missing, creates .venv, installs all packages)
pnpm run python:env

# Create a Python project
pnpm exec nx g @nxlv/python:uv-project my-service --directory=apps/services

# Sync Nx and auto-tag
pnpm run nx:reset
```

## How It Works

This monorepo uses **UV workspace mode** — the same concept as npm workspaces for Node.js:

| Concept              | Node.js                     | Python (UV Workspace)                            |
| -------------------- | --------------------------- | ------------------------------------------------ |
| **Project manifest** | `apps/*/package.json`       | `apps/*/pyproject.toml`                          |
| **Project deps**     | `dependencies`              | `[project] dependencies`                         |
| **Workspace root**   | Root `package.json`         | Root `pyproject.toml` with `[tool.uv.workspace]` |
| **Shared dev tools** | Root `devDependencies`      | Root `[dependency-groups] dev`                   |
| **Single install**   | One `node_modules/` at root | One `.venv/` at root                             |
| **Lockfile**         | `pnpm-lock.yaml`            | `uv.lock`                                        |

### Key Files

| File              | Location       | Purpose                                                       |
| ----------------- | -------------- | ------------------------------------------------------------- |
| `pyproject.toml`  | Workspace root | UV workspace config, shared dev dependencies                  |
| `uv.toml`         | Workspace root | UV settings (e.g., `native-tls = true` for corporate proxies) |
| `uv.lock`         | Workspace root | Deterministic lockfile for all packages                       |
| `.python-version` | Workspace root | Python version (UV auto-downloads if missing)                 |
| `.venv/`          | Workspace root | Shared virtual environment (all packages installed here)      |
| `pyproject.toml`  | Each project   | Project-specific dependencies and tool config                 |

### Configuration Files (in this directory)

| File             | Purpose                  |
| ---------------- | ------------------------ |
| `.flake8`        | Flake8 linter rules      |
| `mypy.ini`       | mypy type checker config |
| `pyproject.toml` | Black/isort settings     |
| `.sqlfluff`      | SQL linter config        |
| `.yamllint`      | YAML linter config       |

## Available Commands

### Environment Setup

```bash
pnpm run python:env             # Install UV (if needed) + create .venv + install packages
pnpm run python:env:full        # Same as above, with all optional dependency groups
pnpm run python:env -- --check  # Check environment status without installing
```

### Code Quality

```bash
pnpm run python:format       # Format all Python code (Black)
pnpm run python:lint         # Lint all Python code (Flake8 + mypy)
pnpm run python:check        # Format + lint
```

### Nx Commands (per-project)

```bash
pnpm run nx:python-dev       # Start all Python services
pnpm run nx:python-test      # Test all Python projects
pnpm run nx:python-lint      # Lint all Python projects
pnpm run nx:python-format    # Format all Python projects
pnpm run nx:python-build     # Build all Python projects
```

### Adding Dependencies

```bash
# Add a dependency to a specific project
uv add --project apps/services/my-service fastapi "uvicorn[standard]"

# Add a workspace-wide dev tool
uv add --dev ruff

# Sync after changes
uv sync
```

## Development Workflow

### Running Tools in the Venv

Use `uv run` to execute any tool without manually activating the venv:

```bash
uv run pytest                    # Run tests
uv run black .                   # Format code
uv run python -c "print('hi')"  # Run Python
```

### Manual Venv Activation (optional)

If you prefer to activate the venv directly:

```bash
# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate
```

## Git Hooks Integration

Git hooks **automatically** handle Python:

- **Pre-commit**: Runs Black, Flake8, mypy on staged `.py` files via `uv run`
- **Pre-push**: Runs full lint + test suite on affected Python projects
- **Auto-setup**: Hooks run `uv sync` to create `.venv` if it doesn't exist

No manual setup required — hooks handle everything.

## Troubleshooting

### "uv is not recognized"

UV is not installed. The setup script installs it automatically:

```bash
pnpm run python:env
```

Or install manually: `winget install astral-sh.uv` (Windows), `brew install uv` (macOS), `curl -LsSf https://astral.sh/uv/install.sh | sh` (Linux).

### SSL Certificate Errors

The workspace has `uv.toml` with `native-tls = true` which uses system certificates. If you still see errors, check your corporate proxy settings.

### .venv Issues

```bash
# Delete and recreate
rm -rf .venv     # or: rmdir /s .venv (Windows)
pnpm run python:env
```

### Import Path Issues

UV workspace mode handles this automatically. Each project is installed as an editable package in the shared `.venv`, so imports work without path manipulation.
