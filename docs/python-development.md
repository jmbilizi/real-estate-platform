# Python Development in the Polyglot Monorepo

## Quick Start

```bash
# 1. One-time setup (installs UV + creates .venv + installs all packages)
pnpm run python:env

# 2. Create a Python project
pnpm exec nx g @nxlv/python:uv-project my-service --directory=apps/services

# 3. Sync Nx projects and auto-tag
pnpm run nx:reset
```

That's it! UV auto-downloads the correct Python version from `.python-version` if it's not already
installed.

## Architecture

This monorepo uses **UV workspace mode** — identical to how pnpm workspaces work for Node.js:

- **Root `pyproject.toml`** defines the workspace members and shared dev tools
- **Each project's `pyproject.toml`** declares its own dependencies
- **Single `.venv/`** at workspace root holds all installed packages
- **Single `uv.lock`** is the deterministic lockfile for the entire workspace

### File Layout

```
/                               # Workspace root
├── pyproject.toml              # UV workspace config + shared dev deps
├── uv.toml                    # UV settings (native-tls, etc.)
├── uv.lock                    # Workspace-wide lockfile
├── .python-version            # Python version (UV auto-downloads)
├── .venv/                     # Shared venv (like node_modules/)
├── apps/services/
│   └── my-service/
│       ├── pyproject.toml     # Project deps (like package.json)
│       ├── my_service/        # Source package
│       │   ├── __init__.py
│       │   └── main.py
│       └── tests/
│           └── test_main.py
└── tools/python/              # Tool configs (.flake8, mypy.ini, etc.)
```

## Development Workflow

### Running Tools

Use `uv run` — no need to activate the venv manually:

```bash
uv run pytest                    # Run tests
uv run black .                   # Format code
uv run python my_script.py       # Run a script
uv run uvicorn app:app --reload  # Start a server
```

### Managing Dependencies

```bash
# Add a dependency to a specific project
uv add --project apps/services/my-service fastapi "uvicorn[standard]"

# Add a workspace-wide dev tool
uv add --dev ruff

# Remove a dependency
uv remove --project apps/services/my-service some-package

# Sync environment after manual pyproject.toml edits
uv sync
```

### Nx Commands

```bash
# All Python projects
pnpm run nx:python-dev            # Start all Python services
pnpm run nx:python-test           # Test all Python projects
pnpm run nx:python-lint           # Lint all Python projects
pnpm run nx:python-format         # Format all Python projects
pnpm run nx:python-build          # Build all Python projects

# Specific project
pnpm exec nx test my-service
pnpm exec nx serve my-service
pnpm exec nx lint my-service
```

### Code Quality

```bash
pnpm run python:format            # Format all Python code (Black)
pnpm run python:lint              # Lint all Python code (Flake8 + mypy)
pnpm run python:check             # Format + lint
```

## Creating Python Projects

Always use Nx generators:

```bash
# Application (API, service)
pnpm exec nx g @nxlv/python:uv-project my-api --directory=apps/services --projectType=application

# Library (shared code)
pnpm exec nx g @nxlv/python:uv-project my-utils --directory=libs --projectType=library

# After creating any project, sync Nx
pnpm run nx:reset
```

**Auto-tagging**: Projects are automatically tagged with `python`, enabling commands like
`pnpm run nx:python-test`.

## Environment Setup Details

### What `pnpm run python:env` Does

1. **Checks for UV** — installs it automatically if missing (Windows: PowerShell installer / winget,
   macOS: brew, Linux: curl)
2. **Runs `uv sync`** — creates `.venv`, downloads Python if needed (from `.python-version`),
   installs all packages from `uv.lock`
3. **Verifies tools** — confirms black, flake8, mypy, pytest, ruff are working

### Check Environment Status

```bash
pnpm run python:env -- --check
```

Shows UV version, Python version, venv status, and tool availability.

### CI/CD

In GitHub Actions, UV is installed via `astral-sh/setup-uv@v5`:

```yaml
- uses: astral-sh/setup-uv@v5
- run: uv sync
- run: uv run pytest
```

## Git Hooks

Hooks are automatic — no manual setup needed:

- **Pre-commit**: Runs Black, Flake8, mypy on staged `.py` files via `uv run`
- **Pre-push**: Runs full lint + test suite on affected Python projects
- **Auto-setup**: Hooks run `uv sync` if `.venv` doesn't exist

## Configuration Files

All tool configs live in `tools/python/`:

| File             | Tool     | Purpose             |
| ---------------- | -------- | ------------------- |
| `.flake8`        | Flake8   | Linter rules        |
| `mypy.ini`       | mypy     | Type checker config |
| `pyproject.toml` | Black    | Formatter settings  |
| `.sqlfluff`      | SQLFluff | SQL linter config   |
| `.yamllint`      | YAMLLint | YAML linter config  |

## Debugging

VS Code is configured for Python debugging:

1. Open any Python file
2. Press F5 or use the debug sidebar
3. Choose a debug configuration (e.g., "Python: FastAPI")

## Troubleshooting

### "uv is not recognized"

```bash
pnpm run python:env    # Auto-installs UV
```

Or install manually: `winget install astral-sh.uv` (Windows), `brew install uv` (macOS).

### SSL Certificate Errors

Already handled — `uv.toml` has `native-tls = true` (uses system certificates).

### .venv Broken

```bash
rm -rf .venv          # or: rmdir /s .venv (Windows)
pnpm run python:env    # Recreate
```

### Import Errors

UV workspace mode installs each project as an editable package. Imports should work automatically.
If not, run `uv sync` to re-link.

## Additional References

- [Python Tools README](../tools/python/README.md) — Directory structure and config files
- [Copilot Instructions](../.github/copilot-instructions.md) — Full architecture overview
