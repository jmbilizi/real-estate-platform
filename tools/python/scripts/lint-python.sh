#!/bin/bash
# Lint Python files in the workspace

# Determine script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Python environment exists
if [ ! -d ".venv" ]; then
    echo "Python virtual environment not found. Creating it..."
    source "$SCRIPT_DIR/create-venv.sh"
fi

# Run flake8 linter on all Python files
echo "Running Flake8 linter on Python files..."
if [ -f ".venv/bin/flake8" ]; then
    .venv/bin/flake8 .
    FLAKE8_EXIT_CODE=$?
    
    if [ $FLAKE8_EXIT_CODE -eq 0 ]; then
        echo "Python linting completed successfully."
    else
        echo "Python linting found issues that need to be fixed."
        exit $FLAKE8_EXIT_CODE
    fi
else
    echo "Error: Flake8 linter not found in virtual environment."
    exit 1
fi
