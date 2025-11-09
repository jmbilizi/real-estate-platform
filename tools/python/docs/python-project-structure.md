# Python Project Structure Example

This document provides a template for structuring Python projects within the monorepo.

## Standard Python Project Structure

```
libs/my-python-lib/
├── README.md                 # Project documentation
├── pyproject.toml            # Project-specific configuration (if needed)
├── requirements.txt          # Project-specific dependencies
├── requirements-dev.txt      # Project-specific dev dependencies (optional)
├── setup.py                  # For making the package installable
├── src/                      # Source directory
│   └── my_python_lib/        # Package directory (underscores in name)
│       ├── __init__.py       # Package initialization
│       ├── module1.py        # Module files
│       └── subpackage/       # Subpackage
│           ├── __init__.py
│           └── module2.py
└── tests/                    # Test directory
    ├── __init__.py
    ├── conftest.py           # Pytest configuration
    ├── test_module1.py       # Test files (prefixed with test_)
    └── subpackage/
        ├── __init__.py
        └── test_module2.py
```

## Nx Project Structure

When using the `@nxlv/python` plugin, the structure is slightly different:

```
apps/my-python-app/
├── README.md
├── project.json             # Nx project configuration
├── requirements.txt         # References root requirements.txt
├── setup.py
├── my_python_app/           # Main package (no src/ directory)
│   ├── __init__.py
│   └── main.py
└── tests/
    └── test_main.py
```

## Making Libraries Installable in Development Mode

For Python libraries that need to be used by other Python projects:

1. Ensure you have a proper `setup.py`:

```python
from setuptools import setup, find_packages

setup(
    name="my-python-lib",
    version="0.1.0",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    install_requires=[
        # List dependencies from requirements.txt
    ],
)
```

2. Install in development mode:

```bash
# Activate your virtual environment
.venv\Scripts\activate

# Install the library in development mode
pip install -e libs/my-python-lib
```

## Example `requirements.txt`

```
# Reference the root requirements file for shared dependencies
-r ../../../requirements.txt

# Service-specific dependencies
some-specific-package>=1.0.0,<2.0.0
```

## Example `project.json` (for Nx)

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
        "cwd": "apps/my-python-app",
        "outputFile": "apps/my-python-app/flake8-output.txt"
      }
    },
    "test": {
      "executor": "@nxlv/python:pytest",
      "options": {
        "cwd": "apps/my-python-app",
        "testFile": "tests/"
      }
    },
    "serve": {
      "executor": "@nxlv/python:execute",
      "options": {
        "cwd": "apps/my-python-app",
        "commands": ["python -m my_python_app.main"]
      }
    }
  },
  "tags": ["python", "app"]
}
```
