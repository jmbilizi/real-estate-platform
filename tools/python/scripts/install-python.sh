#!/bin/bash
# Script to check if Python is installed on Unix systems (macOS/Linux)
# and install it if needed

MIN_PYTHON_VERSION="3.9"

echo "Checking Python installation..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python is not installed."
    
    # Detect OS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        echo "This project requires Python $MIN_PYTHON_VERSION or higher."
        read -p "Would you like to install Python using Homebrew? (y/n): " INSTALL_PYTHON
        
        if [[ "$INSTALL_PYTHON" == "y" || "$INSTALL_PYTHON" == "Y" ]]; then
            echo "Checking if Homebrew is installed..."
            if ! command -v brew &> /dev/null; then
                echo "Homebrew is not installed. Installing Homebrew..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            fi
            
            echo "Installing Python using Homebrew..."
            brew install python
            
            if [[ $? -ne 0 ]]; then
                echo "Failed to install Python."
                echo "Please install Python $MIN_PYTHON_VERSION or higher manually from https://www.python.org/downloads/"
                exit 1
            fi
        else
            echo "Please install Python $MIN_PYTHON_VERSION or higher manually from https://www.python.org/downloads/"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        echo "This project requires Python $MIN_PYTHON_VERSION or higher."
        read -p "Would you like to install Python? (y/n): " INSTALL_PYTHON
        
        if [[ "$INSTALL_PYTHON" == "y" || "$INSTALL_PYTHON" == "Y" ]]; then
            # Detect package manager
            if command -v apt-get &> /dev/null; then
                echo "Installing Python using apt..."
                sudo apt-get update
                sudo apt-get install -y python3 python3-pip python3-venv
            elif command -v dnf &> /dev/null; then
                echo "Installing Python using dnf..."
                sudo dnf install -y python3 python3-pip
            elif command -v yum &> /dev/null; then
                echo "Installing Python using yum..."
                sudo yum install -y python3 python3-pip
            else
                echo "Could not determine package manager."
                echo "Please install Python $MIN_PYTHON_VERSION or higher manually."
                exit 1
            fi
            
            if [[ $? -ne 0 ]]; then
                echo "Failed to install Python."
                echo "Please install Python $MIN_PYTHON_VERSION or higher manually."
                exit 1
            fi
        else
            echo "Please install Python $MIN_PYTHON_VERSION or higher manually."
            exit 1
        fi
    else
        echo "Unsupported operating system."
        echo "Please install Python $MIN_PYTHON_VERSION or higher manually from https://www.python.org/downloads/"
        exit 1
    fi
fi

# Check Python version
PYTHON_CMD="python3"
if ! command -v python3 &> /dev/null && command -v python &> /dev/null; then
    PYTHON_CMD="python"
fi

PYTHON_VERSION=$($PYTHON_CMD -c "import sys; print(sys.version.split()[0])")
echo "Found Python version $PYTHON_VERSION"

# Compare version with minimum required
IFS='.' read -ra PYTHON_VERSION_PARTS <<< "$PYTHON_VERSION"
IFS='.' read -ra MIN_VERSION_PARTS <<< "$MIN_PYTHON_VERSION"

MAJOR=${PYTHON_VERSION_PARTS[0]}
MINOR=${PYTHON_VERSION_PARTS[1]}
REQ_MAJOR=${MIN_VERSION_PARTS[0]}
REQ_MINOR=${MIN_VERSION_PARTS[1]}

if [[ $MAJOR -lt $REQ_MAJOR || ($MAJOR -eq $REQ_MAJOR && $MINOR -lt $REQ_MINOR) ]]; then
    echo "Python version $PYTHON_VERSION is below the required version $MIN_PYTHON_VERSION."
    echo "Please install Python $MIN_PYTHON_VERSION or higher."
    exit 1
fi

echo "Python version $PYTHON_VERSION meets the minimum requirement of $MIN_PYTHON_VERSION."
exit 0
