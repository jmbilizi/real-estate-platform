# Python Development in the Monorepo - Improved Guide

This document outlines the improved Python development setup within this monorepo.

## Python Environment Structure

The monorepo uses a single Python environment for all purposes:

1. **Common Environment** (`.venv`):
   - Used for both development and git pre-commit hooks
   - Contains all required tools and dependencies
   - Installed via `npm run setup-hooks` or `tools/python/scripts/create-venv.bat`
   - Ensures consistent tooling across all tasks

This consolidated approach simplifies environment management while ensuring that formatting tools work consistently.

## Development Tools

| Tool                  | Purpose              | Environment |
| --------------------- | -------------------- | ----------- |
| **Black**             | Code formatter       | Both        |
| **Flake8**            | Linter               | Both        |
| **MyPy**              | Static type checker  | Both        |
| **Pylint**            | Advanced linter      | Dev only    |
| **Pytest/Pytest-cov** | Testing framework    | Dev only    |
| **SQLFluff**          | SQL formatter/linter | Both        |
| **YAMLLint**          | YAML linter          | Both        |

## Requirements Files

| File                          | Purpose              | Contains                                            |
| ----------------------------- | -------------------- | --------------------------------------------------- |
| `requirements.txt`            | Main requirements    | All Python dependencies with version constraints    |
| `format-requirements.txt`     | Git hooks tools      | References to formatting tools in main file         |
| `python-dev-requirements.txt` | Full dev environment | References main file for development dependencies   |
| Service-specific requirements | Service dependencies | References main file and adds service-specific deps |

## Setting Up Python

### 1. For All Developers (Hooks Setup)

```bash
# Run the setup script to create the hooks environment
npm run setup-hooks
```

### 2. For Python Developers

```bash
# Create a Python virtual environment
npm run py:create-venv

# Activate the virtual environment (run directly in terminal)
.venv\Scripts\activate

# Install development tools
npm run py:install-dev
```

### 3. For Service-specific Development

```bash
# Create and activate a virtual environment
npm run py:create-venv
.venv\Scripts\activate  # Run directly in terminal

# Install dependencies for a specific service
npm run py:install-service --service=fastapi-service
```

## Using Python Tools

### npm Scripts

```bash
# Format all Python code
npm run format-python

# Lint all Python code
npm run lint-python

# Format and lint (complete check)
npm run check-python

# Get help on available Python scripts
npm run py:help
```

### Nx Commands (for Nx-managed projects)

```bash
# Format specific project
nx run fastapi-service:format

# Lint specific project
nx run fastapi-service:lint

# Test specific project
nx run fastapi-service:test

# Run specific project
nx run fastapi-service:serve
```

## Creating New Python Projects

### Manual Creation

Follow the structure in the [Python Project Structure](./python-project-structure.md) document.

### Using Nx (Recommended)

```bash
# Generate a new Python application
npx nx g @nxlv/python:app my-app --directory=apps/my-app

# Generate a new Python library
npx nx g @nxlv/python:lib my-lib --directory=libs/my-lib
```

## Continuous Integration

Python code is checked automatically in CI:

1. Git pre-commit hooks format and lint Python files when they're staged
2. GitHub Actions run lint and test commands on all Python projects
3. Nx affected commands ensure only changed projects are checked

## Troubleshooting

### Python Path Issues

If you encounter import errors, ensure your Python path includes the workspace root:

```python
import sys
import os
from pathlib import Path

# Add workspace root to Python path
workspace_root = Path(__file__).parent.parent.parent
sys.path.append(str(workspace_root))
```

### Virtual Environment Problems

If your virtual environment isn't working correctly:

```bash
# Delete and recreate it
rm -rf .venv
npm run py:create-venv
```

### Pre-commit Hook Issues

If hooks aren't running or are failing:

```bash
# Reinstall hooks tools
npm run setup-hooks
```
