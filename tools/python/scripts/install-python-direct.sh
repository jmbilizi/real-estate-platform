#!/bin/bash
# Direct Python Installer Script for Unix systems
# This script installs Python without any prompts

set -e

echo "======================================"
echo "Python Direct Installation Script"
echo "======================================"
echo
echo "This script will check and install Python 3.9+ if needed"
echo "No prompts will be shown during installation."
echo

# Check if Python is already installed
if command -v python3 &> /dev/null; then
    echo "Found Python in PATH"
    PYTHON_VERSION=$(python3 -c "import sys; print(sys.version.split()[0])" 2>/dev/null)
    
    if [ -n "$PYTHON_VERSION" ]; then
        echo "Found Python version $PYTHON_VERSION"
        
        # Parse version numbers
        MAJOR=$(echo $PYTHON_VERSION | cut -d. -f1)
        MINOR=$(echo $PYTHON_VERSION | cut -d. -f2)
        
        # Check version is adequate (3.9+)
        if [ "$MAJOR" -gt 3 ] || ([ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 9 ]); then
            echo "Using Python $PYTHON_VERSION"
            echo "Python path:"
            python3 -c "import sys; print(sys.executable)"
            exit 0
        fi
        
        echo "WARNING: Python version $PYTHON_VERSION is below the recommended version 3.9+."
    else
        echo "Python command found but cannot get version."
    fi
    
    echo "Installing newer Python version..."
else
    echo "Python not found. Installing Python..."
fi

# OS-specific installation
if [ "$(uname)" == "Darwin" ]; then
    # macOS
    if ! command -v brew &> /dev/null; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    
    echo "Installing Python using Homebrew..."
    brew install python@3.9
    
elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    # Linux
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        echo "Installing Python using apt..."
        sudo apt-get update
        sudo apt-get install -y python3.9 python3.9-venv python3.9-dev
        
    elif command -v dnf &> /dev/null; then
        # Fedora
        echo "Installing Python using dnf..."
        sudo dnf install -y python39
        
    elif command -v yum &> /dev/null; then
        # CentOS/RHEL
        echo "Installing Python using yum..."
        sudo yum install -y python39
        
    else
        echo "Unsupported Linux distribution. Please install Python 3.9+ manually."
        exit 1
    fi
else
    echo "Unsupported operating system. Please install Python 3.9+ manually."
    exit 1
fi

echo
echo "Verifying Python installation..."
if ! command -v python3 &> /dev/null; then
    echo "Python installation completed, but Python is not in PATH."
    echo
    echo "You will need to restart your terminal for the PATH to update."
    echo "After restarting, run 'python3 --version' to verify."
else
    echo "Python is now in PATH:"
    python3 --version
fi

echo
echo "======================================"
echo "Python is successfully installed!"
echo
echo "You may need to restart your terminal for the PATH to update."
echo
echo "To create a virtual environment, run:"
echo "python3 -m venv .venv"
echo
echo "To activate it, run:"
echo "source .venv/bin/activate"
echo "======================================"

exit 0