#!/bin/bash
# Create a Python virtual environment

# Determine script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Python installation is adequate
source "$SCRIPT_DIR/check-python-ondemand.sh"
if [ $? -ne 0 ]; then
    echo "Failed to verify or install Python. Virtual environment creation aborted."
    exit 1
fi

# Create virtual environment
echo "Creating Python virtual environment at .venv..."
python3 -m venv .venv || python -m venv .venv

# Upgrade pip
echo "Upgrading pip..."
if [ -f ".venv/bin/python" ]; then
    .venv/bin/python -m pip install --upgrade pip
else
    echo "Warning: Failed to find Python in virtual environment."
fi

echo ""
echo "Virtual environment created successfully at .venv"
echo ""
echo "To activate, run: source .venv/bin/activate"
