# Python Setup Guide

This comprehensive guide explains how to set up Python development in the real-estate-platform monorepo.

## Quick Setup

### Option 1: Complete Setup (Recommended)

For a complete one-step setup that handles Python installation, virtual environment creation, and package installation:

```bash
npm run py:setup-dev
```

This command will:

1. Install Python if not already installed
2. Create and activate a virtual environment (`.venv`)
3. Install all common development packages
4. Set up Nx Python integration for the monorepo

### Option 2: Setup for All Services

If you're working with multiple Python services:

```bash
npm run py:setup-dev-all
```

### Option 3: Service-Specific Setup

For specific services only:

```bash
npm run py:install-service apps/my-service1 apps/my-service2
```

## Python Environment Structure

The monorepo uses a **single Python environment** (`.venv`) for all purposes:

- **Development**: Code editing, testing, debugging
- **Git Hooks**: Pre-commit formatting and linting
- **Nx Integration**: Monorepo task orchestration

This consolidated approach simplifies environment management while ensuring consistent tooling.

## Development Tools

| Tool         | Purpose              | Usage                   |
| ------------ | -------------------- | ----------------------- |
| **Black**    | Code formatter       | `npm run format-python` |
| **Flake8**   | Linter               | `npm run lint-python`   |
| **MyPy**     | Static type checker  | `npm run lint-python`   |
| **Pytest**   | Testing framework    | `nx test <project>`     |
| **SQLFluff** | SQL formatter/linter | Pre-commit hooks        |
| **YAMLLint** | YAML linter          | Pre-commit hooks        |

## Requirements Files Structure

| File                                | Purpose              | Contains                                         |
| ----------------------------------- | -------------------- | ------------------------------------------------ |
| `requirements.txt`                  | Main dependencies    | All Python dependencies with version constraints |
| `format-requirements.txt`           | Git hooks tools      | Formatting tools for pre-commit hooks            |
| `python-dev-requirements.txt`       | Development tools    | Development and testing dependencies             |
| Service-specific `requirements.txt` | Service dependencies | Service-specific packages                        |

## Working with the Environment

### Activating the Virtual Environment

After setup, activate the virtual environment:

**Windows:**

```bash
.venv\Scripts\activate
```

**macOS/Linux:**

```bash
source .venv/bin/activate
```

### Available Commands

#### npm Scripts (Cross-platform)

```bash
# Python environment management
npm run py:setup-dev              # Complete setup
npm run py:setup-dev-all          # Setup for all services
npm run py:install-service        # Install for specific service

# Code quality
npm run format-python             # Format all Python code
npm run lint-python               # Lint all Python code
npm run check-python              # Format + lint

# Help
npm run py:help                   # Get help on Python scripts
```

#### Nx Commands (for Nx-managed projects)

```bash
# Project-specific commands
nx run <project>:format           # Format specific project
nx run <project>:lint             # Lint specific project
nx run <project>:test             # Test specific project
nx run <project>:serve            # Run specific project

# Cross-project commands
npm run nx:python-dev             # Start all Python services
npm run nx:python-test            # Test all Python projects
npm run nx:python-lint            # Lint all Python projects
npm run nx:python-format          # Format all Python projects
```

## Creating New Python Projects

### Using Nx (Recommended)

```bash
# Generate a new Python application
npx nx g @nxlv/python:app my-app --directory=apps/my-app

# Generate a new Python library
npx nx g @nxlv/python:lib my-lib --directory=libs/shared/my-lib
```

### Manual Creation

Follow the structure documented in the [Python Project Structure](./docs/python-project-structure.md) guide.

## Troubleshooting

### Common Issues and Solutions

#### "pip not recognized" Error

This happens when Python is freshly installed and PATH isn't updated:

**Solution:**

1. Restart your terminal or VS Code
2. Run: `npm run py:setup-dev`

#### Virtual Environment Issues

If your virtual environment isn't working:

```bash
# Delete and recreate
rmdir /s .venv          # Windows
rm -rf .venv            # macOS/Linux

# Recreate
npm run py:setup-dev
```

#### Import Path Issues

If you encounter import errors, ensure your Python path includes the workspace root:

```python
import sys
from pathlib import Path

# Add workspace root to Python path
workspace_root = Path(__file__).parent.parent.parent
sys.path.append(str(workspace_root))
```

#### Pre-commit Hook Issues

If Git hooks aren't working:

```bash
npm run setup-hooks     # Reinstall hooks
```

#### PATH Environment Issues

If Python commands aren't recognized after installation:

1. Verify Python installation: `python --version`
2. Check if Python is in PATH
3. Restart terminal/IDE
4. Re-run setup: `npm run py:setup-dev`

### Manual Setup (Fallback)

If automatic setup fails, install manually:

1. **Install Python 3.8+** from [python.org](https://www.python.org/downloads/)
   - ✅ Check "Add Python to PATH" during installation
2. **Restart** your terminal or VS Code
3. **Create virtual environment**: `python -m venv .venv`
4. **Activate environment**:
   - Windows: `.venv\Scripts\activate`
   - macOS/Linux: `source .venv/bin/activate`
5. **Install packages**: `pip install -r tools/python/requirements.txt`

## Integration with Monorepo

### Git Hooks

Python code is automatically checked when you commit:

- **Black** formats Python files
- **Flake8** and **MyPy** check for issues
- **SQLFluff** formats SQL files
- **YAMLLint** checks YAML files

### Continuous Integration

- GitHub Actions run Python tests and linting
- Nx affected commands only check changed projects
- Consistent Python version across all environments

### Cross-Language Integration

- Python services can be consumed by Node.js and .NET services
- Shared data models can be generated across languages
- Unified development and deployment workflows

## Best Practices

1. **Always use the virtual environment** when working with Python code
2. **Run format and lint commands** before committing
3. **Use Nx commands** for project-specific operations
4. **Keep requirements files updated** when adding dependencies
5. **Follow the monorepo project structure** for consistency
6. **Use type hints** and maintain good test coverage

## Getting Help

For additional help:

- Run `npm run py:help` for available Python commands
- Check the [Python Documentation](./docs/README-PYTHON.md) for detailed guides
- Review the [Python Project Structure](./docs/python-project-structure.md) for project organization
- See the [Cross-Platform Guide](./docs/PYTHON-CROSS-PLATFORM.md) for OS-specific considerations
