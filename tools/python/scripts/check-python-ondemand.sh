#!/bin/bash
# This script checks if Python is already available
# It will only install Python if needed for a Python task

# Determine script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Get Python command (python3 or python)
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    # Python not found, run installer
    source "$SCRIPT_DIR/install-python.sh"
    exit $?
fi

# Check Python version meets requirements
MIN_PYTHON_VERSION="3.9"
PYTHON_VERSION=$($PYTHON_CMD -c "import sys; print(sys.version.split()[0])")

# Parse version numbers
IFS='.' read -ra PYTHON_VERSION_PARTS <<< "$PYTHON_VERSION"
IFS='.' read -ra MIN_VERSION_PARTS <<< "$MIN_PYTHON_VERSION"

MAJOR=${PYTHON_VERSION_PARTS[0]}
MINOR=${PYTHON_VERSION_PARTS[1]}
REQ_MAJOR=${MIN_VERSION_PARTS[0]}
REQ_MINOR=${MIN_VERSION_PARTS[1]}

# Check version is adequate (3.9+)
if [[ $MAJOR -gt $REQ_MAJOR || ($MAJOR -eq $REQ_MAJOR && $MINOR -ge $REQ_MINOR) ]]; then
    echo "Using Python $PYTHON_VERSION"
    exit 0
fi

echo "WARNING: Python version $PYTHON_VERSION is below the recommended version $MIN_PYTHON_VERSION."

# Ask if user wants to proceed anyway
read -p "Continue anyway? (y/n): " CONTINUE
if [[ "$CONTINUE" == "y" || "$CONTINUE" == "Y" ]]; then
    exit 0
else
    echo "Installation required. Running Python installer..."
    source "$SCRIPT_DIR/install-python.sh"
    exit $?
fi
