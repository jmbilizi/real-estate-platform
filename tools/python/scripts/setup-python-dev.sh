#!/bin/bash
# Python Development Environment Setup Script
# This script creates a Python virtual environment for development

echo "===== Python Development Environment Setup ====="
echo ""

# Determine script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if Python installation is adequate
source "$SCRIPT_DIR/check-python-ondemand.sh"
if [ $? -ne 0 ]; then
    echo "Failed to verify or install Python. Development environment setup aborted."
    exit 1
fi

# Show which Python is being used
echo "Using Python:"
python3 --version || python --version
echo "Python executable path:"
python3 -c "import sys; print(sys.executable)" || python -c "import sys; print(sys.executable)"
echo ""

# Check if .venv already exists
if [ -d ".venv" ]; then
    echo "Python virtual environment (.venv) already exists."
    echo "To recreate it, delete the .venv folder and run this script again."
    echo ""
else
    # Create a Python virtual environment
    echo "Creating Python virtual environment for development..."
    python3 -m venv .venv || python -m venv .venv
    echo ""
fi

# Install development requirements
echo "Installing Python development dependencies..."
PYTHON_CMD=".venv/bin/pip"
$PYTHON_CMD install --upgrade pip
$PYTHON_CMD install -r python-dev-requirements.txt

echo ""
echo "Python development environment setup complete!"
echo "To activate, run: source .venv/bin/activate (Linux/macOS) or .venv\\Scripts\\activate (Windows)"
