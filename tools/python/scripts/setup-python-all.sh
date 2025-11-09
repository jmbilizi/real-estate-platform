#!/bin/bash
# Python All-in-One Setup Script
# This script handles the complete Python setup process:
# 1. Install Python if needed
# 2. Create virtual environment
# 3. Install required packages

echo "======================================"
echo "Python All-in-One Setup"
echo "======================================"

# Step 1: Check and install Python if needed
echo "Step 1: Checking Python installation..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/check-python-ondemand.sh"
if [ $? -ne 0 ]; then
    echo "Failed to install Python. Aborting setup."
    exit 1
fi

echo ""
echo "Step 2: Creating virtual environment..."
cd "$SCRIPT_DIR/../../../"
if [ -d ".venv" ]; then
    echo "Virtual environment already exists at .venv"
else
    # Check if Python is available
    python3 --version > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        # Try python command if python3 doesn't exist
        python --version > /dev/null 2>&1
        if [ $? -ne 0 ]; then
            echo "WARNING: Python not found in PATH after installation."
            echo ""
            echo "Try the following:"
            echo "1. Close this terminal and open a new one"
            echo "2. Run 'npm run py:setup-all' again"
            exit 1
        fi
        # Python command works
        python -m venv .venv
    else
        # Python3 command works
        python3 -m venv .venv
    fi
    
    if [ $? -ne 0 ]; then
        echo "Failed to create virtual environment. Aborting setup."
        exit 1
    fi
    echo "Virtual environment created at .venv"
fi

echo ""
echo "Step 3: Installing required packages..."
if [ ! -f ".venv/bin/activate" ]; then
    echo "Virtual environment activation script not found."
    echo "This could indicate the venv was not created properly."
    exit 1
fi

source .venv/bin/activate
python -m pip install --upgrade pip
if [ $? -ne 0 ]; then
    echo "Failed to upgrade pip. Continuing anyway..."
fi

echo "Installing format requirements..."
python -m pip install -r tools/python/format-requirements.txt
if [ $? -ne 0 ]; then
    echo "Failed to install format requirements."
    exit 1
fi

echo "Installing development requirements..."
python -m pip install -r tools/python/python-dev-requirements.txt
if [ $? -ne 0 ]; then
    echo "Failed to install development requirements."
    exit 1
fi

echo "Installing all requirements..."
python -m pip install -r tools/python/requirements.txt
if [ $? -ne 0 ]; then
    echo "Failed to install all requirements."
    exit 1
fi

echo ""
echo "======================================"
echo "Python setup completed successfully!"
echo ""
echo "Virtual environment: .venv"
echo ""
echo "To activate the virtual environment, run:"
echo "source .venv/bin/activate"
echo "======================================"

exit 0