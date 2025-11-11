# Python Development in Polyglot monoprepo

This guide provides information on setting up and working with Python in this monorepo.

## Prerequisites

- Node.js and npm for running Nx commands
- Python 3.9+ (will be automatically installed when needed)

## Complete Python Setup

To set up Python and NX Python integration in one step:

```bash
npm run python:env
```

This will:

1. Check if Python is installed (and install it if needed)
2. Create a virtual environment
3. Install all required packages
4. Set up NX Python integration

## On-Demand Python Setup

Python will be automatically checked and installed only when:

1. You run a Python-specific command
2. You make changes to Python files that trigger pre-commit hooks

There's no need to set up Python upfront if you're not working with Python code.

## Python Environment Management

Several scripts help manage Python environments in this monorepo:

### Checking Python Installation

```bash
npm run py:check
```

This will check if Python is available in your PATH and display the version.

### Creating a Virtual Environment

```bash
npm run py:create-venv
```

This creates a `.venv` directory in the root of the repository.

### Activating the Virtual Environment

To activate the virtual environment:

- On Windows:

  ```
  .venv\Scripts\activate
  ```

- On macOS/Linux:
  ```
  source .venv/bin/activate
  ```

> Note: You can also run `npm run py:activate` to see activation instructions.

### Installing Dependencies

After activating the virtual environment:

```bash
# Install all dependencies
npm run py:install-all

# Install development dependencies
npm run py:install-dev
```

> Note: Python linting and formatting tools are now managed by the unified Git hooks system. See [Unified Git Hooks](../../hooks/docs/README.md) for more information.

### Working with Python Services

To install dependencies for a specific Python service:

```bash
npm run python:deps --service=your-service-name
```

## Python Commands with Nx

```bash
# Run development servers for all Python projects
npm run nx:python-dev

# Run linting on all Python projects
npm run nx:python-lint

# Run tests on all Python projects
npm run nx:python-test

# Format all Python projects
npm run nx:python-format
```

## Python CLI Tool

We provide a CLI tool that works across all platforms (Windows, macOS, Linux):

```bash
# Get help
npm run py:env help

# Check Python installation
npm run py:env check

# Create environment
npm run py:env create

# Install dependencies
npm run py:env install      # All dependencies
npm run py:env install dev  # Development dependencies

# Service-specific dependencies
npm run py:env service your-service-name

# Show activation instructions
npm run py:env activate

# Set up Git hooks (unified system for all languages)
npm run hooks:setup
```

## Formatting and Linting

Python code is automatically formatted and linted on commit using the unified Git hooks system. You can also run these commands manually:

```bash
# Format Python code
npm run python:format

# Lint Python code
npm run python:lint

# Both format and lint
npm run python:check
```

## Troubleshooting

### Python Not Found

If you see an error indicating Python is not installed:

1. Run any Python-related command, and the system will offer to install Python for you
2. Alternatively, install Python from [python.org](https://www.python.org/downloads/)
3. Make sure to check "Add Python to PATH" during installation
4. Run `npm run py:check` to verify the installation

### Virtual Environment Issues

If you encounter problems with the virtual environment:

1. Delete the `.venv` directory
2. Run `npm run py:create-venv` to create a new environment
3. Activate the environment and reinstall dependencies

### Dependency Conflicts

If you encounter dependency conflicts:

1. Make sure your virtual environment is activated
2. Update your Python version if needed
3. Run `pip install --upgrade pip` to ensure you have the latest pip version
4. Try installing dependencies one by one to identify the conflict

## Implementation Details

For more information about the cross-platform implementation, including file organization and script locations, see [PYTHON-CROSS-PLATFORM.md](tools/python/docs/PYTHON-CROSS-PLATFORM.md).
