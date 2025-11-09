# Python Development in the Polyglot Monorepo

This document provides guidelines for working with Python projects in this monorepo.

## Python Environment Setup

We've added several tools to make Python environment management easier through a unified setup script:

### Two-Phase Setup Process

Setting up Python follows a simple two-phase process:

```bash
# Phase 1: Install Python (if needed)
npm run py:install

# Phase 2: Set up environment (after restarting terminal if Python was newly installed)
npm run py:setup
```

### Using npm Scripts

You can use npm scripts for all Python-related tasks:

```bash
# Check Python and environment setup
npm run py:check

# Create a Python virtual environment only
npm run py:create-venv

# Install all packages
npm run py:install-packages

# Install development packages
npm run py:install-dev

# Set up pre-commit hooks
npm run py:setup-hooks

# Show activation instructions
npm run py:activate

# Activate the virtual environment (run directly in terminal)
.venv\Scripts\activate
```

These scripts all use the unified setup script at `tools/python/setup.js`.

# Install all development dependencies

npm run py:install-dev

# Install dependencies for a specific service

npm run py:install-service --service=fastapi-service

# Get help on available scripts

npm run py:help

````

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

The pre-commit hook is optimized to only set up the Python environment when Python-related files are staged for commit. This improves performance for developers who don't modify Python files.

For pre-commit hooks to work correctly when Python files are staged, Python tools like `black`, `flake8`, and `mypy` must be installed:

1. **Option A - Use our scripts**:
   - Run `npm run setup-hooks` which will install the necessary tools in a dedicated virtual environment

2. **Option B - Manual installation**:
   - Run `pip install -r tools/python/format-requirements.txt` using your Python environment
   - Make sure this environment is accessible when Git hooks run

### Smart Pre-commit Hook Behavior

- When you commit JavaScript/TypeScript files only: No Python environment setup occurs
- When you commit Python files (`.py`, `.pyx`, `.pxd`, `.pxi`, `.pyi`, `.ipynb`): Python environment is set up and linting/formatting is applied
- This optimization significantly speeds up commits for non-Python developers

## Creating Python Projects

Use Nx generators directly to create Python projects:

```bash
# FastAPI application
npx nx generate @nxlv/python:fastapi-app my-api --directory=apps

# Python library
npx nx generate @nxlv/python:lib my-lib --directory=libs

# Python application
npx nx generate @nxlv/python:app my-app --directory=apps
```

Projects are automatically tagged with `python` and additional tags when you run `npm run nx:reset` or any nx command.

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
````

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
