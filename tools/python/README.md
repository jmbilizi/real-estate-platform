# Python Tools Directory

This directory contains all the Python-related tooling for the Polyglot monorepo.

## Quick Start

```bash
# One-time setup: Install everything (venv + UV + Poetry)
npm run python:env:full

# Create a Python project immediately (no restart needed!)
npx nx g @nxlv/python:uv-project my-service --directory=apps

# Sync and auto-tag
npm run nx:reset
```

**That's it!** UV and Poetry are immediately available without restarting VS Code or terminals.

## Directory Structure

- `python-dev-setup.js` - **Main setup script** - Unified Python environment management
- `scripts/` - Implementation scripts for Python tasks
- `docs/` - Detailed documentation for Python tooling
- `requirements.txt` - Main Python requirements file (Black, Flake8, mypy, pytest)
- `format-requirements.txt` - Minimal formatting tools for Git hooks
- `python-dev-requirements.txt` - Development requirements
- Configuration files: `.flake8`, `mypy.ini`, `pyproject.toml`, `.sqlfluff`, `.yamllint`

## What Gets Installed?

### Development Tools (in `.venv`)

- **Black** - Code formatter
- **Flake8** - Linter
- **mypy** - Type checker
- **pytest** - Testing framework
- **SQLFluff** - SQL linter
- **YAMLLint** - YAML linter

### Global Tools (via pipx at `~/.local/bin`)

- **UV** (0.9.8) - Ultra-fast Python package installer
- **Poetry** (2.2.1) - Dependency management
- **pipx** - Python application installer

## Available Scripts

### Environment Setup

```bash
# Full setup (venv + UV + Poetry) - Run this once
npm run python:env:full

# Basic setup (venv only, no global tools)
npm run python:env

# Just install dependencies
npm run python:deps
```

### Verify Installation

```bash
# Check what's installed
uv --version         # Should show: uv 0.9.8
poetry --version     # Should show: Poetry (version 2.2.1)
pipx list           # Shows all global tools
```

### Nx Commands

```bash
# Run all Python services
npm run nx:python-dev

# Format all Python projects
npm run nx:python-format

# Lint all Python projects
npm run nx:python-lint

# Test all Python projects
npm run nx:python-test

# Build all Python projects
npm run nx:python-build
```

## How It Works

### Automatic Setup Process

When you run `npm run python:env:full`, the setup:

1. ✅ **Creates `.venv`** at workspace root with development tools
2. ✅ **Checks for pipx** - If not found as a Python module, installs it into the venv
3. ✅ **Runs `pipx ensurepath --force`** - Adds `~/.local/bin` to PATH
4. ✅ **Updates Windows PATH registry** - Makes change permanent
5. ✅ **Installs UV globally** - `C:\Users\<username>\.local\bin\uv.exe`
6. ✅ **Installs Poetry globally** - `C:\Users\<username>\.local\bin\poetry.exe`
7. ✅ **Refreshes `process.env.PATH`** - Tools immediately available (no restart!)

### Why Use Venv Python for Installation?

The setup uses the **venv Python** (not system Python) to install pipx/UV/Poetry because:

- **SSL Certificates**: Venv Python has certificates properly configured
- **Corporate Networks**: Avoids `[SSL: CERTIFICATE_VERIFY_FAILED]` errors
- **Reliability**: Works in environments where system Python might have SSL issues

### Zero-Restart Workflow

Just like the .NET setup in this monorepo, UV and Poetry are **immediately available** after running `python:env:full`:

```bash
# Run setup
npm run python:env:full

# Use immediately (no restart!)
uv --version
poetry --version
npx nx g @nxlv/python:uv-project my-service --directory=apps
```

The PATH registry update ensures tools remain available in new terminals/sessions.

## Integration with Git Hooks

Git hooks **automatically** set up the Python environment when needed:

**Pre-commit hook:**

- Detects Python files (`.py`, `.pyx`, `.pxd`, `.pxi`, `.pyi`, `.ipynb`) being committed
- Auto-creates `.venv` if it doesn't exist
- Runs Black (formatter), Flake8 (linter), and mypy (type checker)
- Skips setup entirely if only non-Python files are committed (faster!)

**Note:** Git hooks only need the `.venv` with formatters/linters. They **don't** need UV or Poetry (those are only for Nx generators).

## Troubleshooting

### "uv is not recognized" or "poetry is not recognized"

After running `python:env:full`, if commands aren't found:

1. **Check if installed**: `pipx list` (should show UV and Poetry)
2. **Verify PATH**: Ensure `C:\Users\<username>\.local\bin` is in your PATH
3. **New terminal**: Open a fresh terminal (PATH registry update persists)
4. **Re-run setup**: `npm run python:env:full` (idempotent - safe to run multiple times)

### Python Environment Issues

If `.venv` isn't working:

```bash
# Delete and recreate
rmdir /s .venv  # Windows
rm -rf .venv    # Linux/Mac

# Run basic setup
npm run python:env
```

### SSL Certificate Errors

If you see `[SSL: CERTIFICATE_VERIFY_FAILED]` errors:

✅ **Already handled!** The setup uses venv Python which has certificates configured properly. If you still see errors, ensure you're running `npm run python:env:full` (not manual pip commands).

### Advanced Troubleshooting

**Check venv Python works:**

```bash
.venv\Scripts\python.exe --version  # Windows
.venv/bin/python --version          # Linux/Mac
```

**Manually verify pipx:**

```bash
.venv\Scripts\python.exe -m pipx --version
```

**Check global tools location:**

```bash
where uv      # Windows
which uv      # Linux/Mac
```

Should show: `C:\Users\<username>\.local\bin\uv.exe`
