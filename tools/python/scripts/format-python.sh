#!/bin/bash
# Format Python files in the workspace

# Determine script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Python environment exists
if [ ! -d ".venv" ]; then
    echo "Python virtual environment not found. Creating it..."
    source "$SCRIPT_DIR/create-venv.sh"
fi

# Run black formatter on all Python files
echo "Running Black formatter on Python files..."
if [ -f ".venv/bin/black" ]; then
    .venv/bin/black .
    echo "Python formatting completed successfully."
else
    echo "Error: Black formatter not found in virtual environment."
    exit 1
fi
