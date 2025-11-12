# Python Development in the Polyglot Monorepo

This document provides guidelines for working with Python projects in this monorepo.

## Quick Start

```bash
# One-time setup: Install Python environment + UV + Poetry
npm run python:env:full

# Create a Python project using UV (recommended)
npx nx g @nxlv/python:uv-project my-service --directory=apps --projectType=application

# Or using Poetry
npx nx g @nxlv/python:poetry-project my-service --directory=apps --projectType=application

# After creating any project, sync and auto-tag
npm run nx:reset
```

**That's it!** UV and Poetry are immediately available without restarting VS Code or terminals.

## Python Environment Setup

### Automatic Setup (Recommended)

Run the full setup once to get everything configured:

```bash
npm run python:env:full
```

**What this does automatically:**

1. ✅ Creates `.venv` at workspace root with development tools (Black, Flake8, mypy, pytest)
2. ✅ Installs `pipx` into the venv (avoids SSL certificate issues)
3. ✅ Installs **UV** and **Poetry** globally via pipx at `~/.local/bin`
4. ✅ Updates Windows PATH registry permanently
5. ✅ Refreshes PATH in current process - **no restart needed!**

**Why UV and Poetry are installed globally:** Nx generators (`@nxlv/python:uv-project`, `@nxlv/python:poetry-project`) require these tools to be globally accessible. Installing via pipx isolates them while keeping them available system-wide.

### Alternative Setup Commands

```bash
# Basic setup (environment + common tools, no global UV/Poetry)
npm run python:env

# Just install dependencies
npm run python:deps

# Check environment status
py-env.bat check  # Windows
bash py-env.sh check  # Unix
```

### Verify Installation

After running `python:env:full`, verify tools are available:

```bash
uv --version        # Should show: uv 0.9.8
poetry --version    # Should show: Poetry (version 2.2.1)
pipx list          # Shows UV and Poetry installed globally
```

### Using VS Code Tasks

For a better IDE experience, use the provided VS Code tasks:

1. Press `Ctrl+Shift+P` and select "Tasks: Run Task"
2. Choose from Python-related tasks like:
   - Python: Create Virtual Environment
   - Python: Install All Dependencies
   - Python: Install Dev Dependencies
   - Python: Set Up Service Dependencies
   - FastAPI: Run Service
   - Python: Format All Code
   - Python: Lint All Code
   - Python: Check All Code

## Python Configuration Files

The repository uses multiple configuration files for Python tools, all located in `tools/python`:

- `.flake8` - Configuration for the Flake8 linter
- `mypy.ini` - Configuration for the MyPy type checker
- `pyproject.toml` - Configuration for Black formatter and other tools
- `.sqlfluff` - Configuration for SQLFluff SQL linter
- `.yamllint` - Configuration for YAMLLint YAML linter

The package.json scripts and lint-staged configuration have been updated to reference these files in their new location.

## Python Requirements Files

The repository uses multiple requirements files for different purposes:

- `tools/python/requirements.txt` - Main requirements file with all Python dependencies and version constraints
- `tools/python/format-requirements.txt` - Minimal set of formatting tools for Git hooks (references main file)
- `tools/python/python-dev-requirements.txt` - Development dependencies (references main file)
- `requirements.txt` - Root directory redirect to main requirements file (for backward compatibility)
- Service-specific requirements files (e.g., in FastAPI service directory)

The service-specific files reference the main requirements using `-r ../../../tools/python/requirements.txt` to ensure version consistency.

## Python Environment for Git Hooks

Git hooks automatically manage the Python environment:

**Pre-commit hook behavior:**

- When you commit Python files (`.py`, `.pyx`, `.pxd`, `.pxi`, `.pyi`, `.ipynb`): Python environment is automatically set up if needed, then linting/formatting is applied
- When you commit only JavaScript/TypeScript files: No Python environment setup occurs (faster commits)

**What gets installed automatically:**

- `.venv` with Black, Flake8, mypy for code quality checks
- No manual setup required - hooks handle everything

**Note:** UV and Poetry (for Nx generators) are only installed when you run `npm run python:env:full`. Git hooks don't need these tools since they only run formatters/linters.

## Creating Python Projects

**CRITICAL:** Always use Nx generators to create Python projects. UV and Poetry must be installed globally first.

### Using UV (Recommended - Fastest)

```bash
# Application (FastAPI, Flask, etc.)
npx nx g @nxlv/python:uv-project my-api --directory=apps --projectType=application --linter=flake8

# Library
npx nx g @nxlv/python:uv-project my-utils --directory=libs --projectType=library --linter=flake8
```

### Using Poetry (Traditional)

```bash
# Application
npx nx g @nxlv/python:poetry-project my-api --directory=apps --projectType=application --linter=flake8

# Library
npx nx g @nxlv/python:poetry-project my-utils --directory=libs --projectType=library --linter=flake8
```

### After Creating Projects

```bash
# Sync .NET solution files and auto-tag all projects
npm run nx:reset
```

**Auto-tagging:** Projects are automatically tagged with `python` and project type tags, enabling commands like `npm run nx:python-test` to run tests on all Python projects.

## Nx Commands for Python Projects

We use Nx to manage Python projects within the monorepo. All Python services have the `python` tag and can be managed collectively:

```bash
# Run all Python services
npm run nx:python-dev

# Format all Python projects
npm run nx:python-format

# Lint all Python projects
npm run nx:python-lint

# Run tests for all Python projects
npm run nx:python-test

# Build all Python projects
npm run nx:python-build
```

Or you can target specific services:

```bash
nx run fastapi-service:serve
nx run fastapi-service:lint
nx run fastapi-service:test
nx run fastapi-service:format
nx run fastapi-service:install-deps
```

## Debugging Python Code

We've configured VS Code for Python debugging:

1. Open any Python file in the FastAPI service
2. Press F5 or select the debug icon in the sidebar
3. Choose "Python: FastAPI" from the debug configuration dropdown
4. Start debugging with breakpoints

You can also debug:

- The current Python file with "Python: Current File"
- Test files with "Python: Debug Tests"

## Code Style and Quality

We use the following tools for Python code quality:

- **Black** - Code formatter (strict, opinionated)
- **Flake8** - Linter for style and error checking
- **mypy** - Static type checking
- **pytest** - Testing framework with coverage reporting

These tools are automatically run on staged Python files during Git commits.

## Additional Documentation

For more detailed information about Python in this monorepo, see:

- [Python Setup Guide](../tools/python/python-setup.md) - Complete setup instructions
- [Python Documentation](../tools/python/docs/README-PYTHON.md) - Comprehensive Python guides
- [Python Project Structure](../tools/python/docs/python-project-structure.md) - Standard structure for Python projects
