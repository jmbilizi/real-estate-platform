# Python Development in Nx Monorepo

This guide explains how to work with Python projects in this Nx monorepo.

## Python Environment Structure

The monorepo uses a consolidated Python environment approach:

1. **Common Environment** (`.venv`):
   - Used for both development and git pre-commit hooks
   - Contains all required tools and dependencies
   - Installed via `npm run python:env` or `tools/python/scripts/create-venv.bat`
   - Ensures consistent tooling across all tasks

2. **Project-specific Environments**:
   - Each Python project manages its own dependencies
   - Managed by Nx when using `@nxlv/python` plugin

## Setting Up Nx for Python

The NX Python setup is automatically included when you run:

```bash
npm run python:env
```

This will set up both your Python environment and NX Python integration in one step.

If you need to run only the NX Python setup separately, you can use:

```bash
npm run nx:add-python
```

The setup is intelligent and will only install NX Python if it's not already set up, so you don't need to worry about running it multiple times.

## Creating a Python Project

### Using Nx Generator

```bash
# Create a Python application
nx g @nxlv/python:app my-python-app

# Create a Python library
nx g @nxlv/python:lib my-python-lib
```

### Sample Project Structure

A typical Nx Python application structure:

```
apps/my-python-app/
├── project.json              # Nx project configuration
├── README.md
├── requirements.txt          # Python dependencies
├── my_python_app/            # Python package
│   ├── __init__.py
│   └── main.py               # Main application code
└── tests/                    # Test directory
    ├── __init__.py
    └── test_main.py          # Tests for main.py
```

## Project Configuration

The key file is `project.json` which defines all the Nx targets:

```json
{
  "name": "my-python-app",
  "root": "apps/my-python-app",
  "sourceRoot": "apps/my-python-app",
  "projectType": "application",
  "targets": {
    "lint": {
      "executor": "@nxlv/python:flake8",
      "options": {
        "cwd": "apps/my-python-app"
      }
    },
    "test": {
      "executor": "@nxlv/python:pytest",
      "options": {
        "cwd": "apps/my-python-app"
      }
    },
    "format": {
      "executor": "@nxlv/python:black",
      "options": {
        "cwd": "apps/my-python-app"
      }
    },
    "serve": {
      "executor": "@nxlv/python:execute",
      "options": {
        "cwd": "apps/my-python-app",
        "commands": ["python -m my_python_app.main"]
      }
    },
    "build": {
      "executor": "@nxlv/python:build",
      "options": {
        "cwd": "apps/my-python-app",
        "outputPath": "dist/apps/my-python-app"
      }
    },
    "install-deps": {
      "executor": "@nxlv/python:ensure-dependencies",
      "options": {
        "cwd": "apps/my-python-app"
      }
    }
  },
  "tags": ["python", "app"]
}
```

## Using Nx Commands

### Installing Dependencies

```bash
# Install dependencies for a specific project
nx run my-python-app:install-deps

# Install dependencies for all Python projects
nx run-many --target=install-deps --projects=tag:python
```

### Running Commands

```bash
# Run the application
nx run my-python-app:serve

# Run tests
nx run my-python-app:test

# Format code
nx run my-python-app:format

# Lint code
nx run my-python-app:lint

# Build a package
nx run my-python-app:build
```

### Running Multiple Projects

```bash
# Run all Python projects
nx run-many --target=serve --projects=tag:python

# Run only affected projects
nx affected --target=test
```

## Dependency Management

### Requirements Files

Each Python project should have its own `requirements.txt`:

```
# Reference the root requirements for common dependencies
-r ../../../requirements.txt

# Project-specific dependencies
fastapi>=0.100.0,<0.101.0
uvicorn>=0.23.0,<0.24.0
```

### Python Virtual Environment

When working on a specific project:

```bash
# Create a project-specific virtual environment
cd apps/my-python-app
python -m venv .venv

# Activate it
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # Linux/macOS

# Install dependencies
pip install -r requirements.txt
```

## Best Practices

1. **Tagging**: Always add the `python` tag to Python projects
2. **Dependencies**: Keep shared dependencies in the root `requirements.txt`
3. **Testing**: Write tests for all functionality
4. **Type Hints**: Use type hints and run MyPy checks
5. **Formatting**: Use Black for consistent formatting

## Troubleshooting

### Nx Command Failures

If Nx commands fail, ensure:

1. The `@nxlv/python` plugin is properly installed
2. The `cwd` in project.json points to the correct directory
3. Python is available in your PATH
4. The Python package has correct imports
