# Python Tools Directory

This directory contains all the Python-related tooling for the Polyglot monorepo.

## Quick Start

📖 **For complete setup instructions, see [Python Setup Guide](./python-setup.md)**

## Directory Structure

- `python-setup.md` - **Main setup guide** (start here!)
- `python-dev-setup.js` - Unified Python environment management script
- `scripts/` - Implementation scripts for Python tasks
- `docs/` - Detailed documentation for Python tooling
- `requirements.txt` - Main Python requirements file
- `format-requirements.txt` - Python formatting tools requirements
- `python-dev-requirements.txt` - Python development requirements

## Quick Setup Guide

To set up everything (Python, virtual environment, dependencies, and NX Python integration):

```bash
npm run python:env
```

This single command will:

1. Check if Python is already installed
2. Install Python automatically if needed
3. Create a virtual environment (.venv)
4. Install all required dependencies
5. Set up NX Python integration

For a more detailed setup that includes installing packages for all Python services:

```bash
npm run python:env:full
```

## Available Scripts

All Python-related scripts have been simplified and consolidated:

### Python Environment Management

- `npm run py:install` - Check and install Python if needed
- `npm run py:setup` - Create virtual environment and install packages
- `npm run py:check` - Verify Python and virtual environment setup
- `npm run py:activate` - Show activation instructions
- `npm run py:create-venv` - Create virtual environment only
- `npm run python:deps:all` - Install all packages
- `npm run py:install-dev` - Install development packages
- `npm run hooks:setup` - Set up unified Git hooks for all languages
- `npm run python:help` - Show help for Python setup

### Code Quality

- `npm run python:format` - Format Python code using Black
- `npm run python:lint` - Lint Python code using Flake8 and mypy
- `npm run python:check` - Run both format and lint

### Nx Integration

- `npm run nx:python-dev` - Run all Python services
- `npm run nx:python-lint` - Lint all Python projects with Nx
- `npm run nx:python-test` - Test all Python projects
- `npm run nx:python-format` - Format all Python projects

## Integration with Git Hooks

This project uses a unified Git hooks system located in the `tools/hooks` directory. The hooks system will automatically:

1. Detect when Python files are being modified
2. Set up the Python environment as needed
3. Run appropriate linters and formatters

### Setup

The Python setup process automatically configures the Git hooks:

```bash
npm run py:setup
```

This runs the unified hooks setup which handles Python, JavaScript, C#, and other languages in one system.

If you need to manually set up the hooks:

```bash
npm run hooks:setup
```

### How it works:

1. When a commit is initiated, the pre-commit hook runs `hooks-runner.js`
2. The script checks if any Python-related files (`.py`, `.pyx`, `.pxd`, `.pxi`, `.pyi`, `.ipynb`) are staged
3. If Python files are staged, the script sets up the Python environment
4. It then runs the appropriate linters and formatters for all staged files

This system prevents unnecessary Python environment setup for JavaScript, C#, and other non-Python developers.

## Troubleshooting

### "pip is not recognized"

If you see "pip is not recognized" errors:

1. Make sure Python is installed: `npm run py:check`
2. Make sure the virtual environment exists: `npm run py:create-venv`
3. Use the `npm run py:setup` script to set up everything correctly

### Python Path Issues

If you're having issues with Python paths:

1. Run `npm run py:check` to verify your Python installation
2. Try running `npm run py:install` to reinstall Python
3. **Important**: Restart your terminal after installing Python
4. Run `npm run py:setup` to complete the setup

### Virtual Environment Issues

If the virtual environment isn't working:

1. Delete the `.venv` directory
2. Run `npm run py:create-venv` to create a fresh environment
3. Run `npm run python:deps:all` to reinstall dependencies

### Advanced Troubleshooting

If all else fails:

1. Ensure you've restarted your terminal after Python installation
2. Try manually running `where python` to verify Python is in your PATH
3. If all automated approaches fail, create the virtual environment manually:
   - `python -m venv .venv`
   - `.venv\Scripts\activate`
   - `pip install -r tools\python\requirements.txt`
