#!/bin/bash
# Type check Python files in the workspace

# Determine script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Python environment exists
if [ ! -d ".hooks-venv" ]; then
    echo "Hooks virtual environment not found. Creating it..."
    source "$SCRIPT_DIR/create-hooks-venv.sh"
fi

# Run mypy type checker on all Python files
echo "Running MyPy type checker on Python files..."
if [ -f ".hooks-venv/bin/mypy" ]; then
    .hooks-venv/bin/mypy .
    MYPY_EXIT_CODE=$?
    
    if [ $MYPY_EXIT_CODE -eq 0 ]; then
        echo "Python type checking completed successfully."
    else
        echo "Python type checking found issues that need to be fixed."
        exit $MYPY_EXIT_CODE
    fi
else
    echo "Error: MyPy type checker not found in hooks virtual environment."
    exit 1
fi
