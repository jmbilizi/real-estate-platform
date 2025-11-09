#!/bin/bash
# .NET Setup Script for Polyglot Monorepo

echo "Setting up .NET development environment..."

# Check if .NET SDK is installed
if ! command -v dotnet &> /dev/null; then
    echo ".NET SDK not found. Please install .NET SDK 8.0 or higher."
    echo "Visit https://dotnet.microsoft.com/download to download and install."
    exit 1
fi

# Check .NET version
DOTNET_VERSION=$(dotnet --version)
echo "Found .NET SDK version: $DOTNET_VERSION"

# Check if global.json exists and matches installed version
if [ -f "global.json" ]; then
    REQUIRED_VERSION=$(grep -o '"version": "[^"]*"' global.json | cut -d'"' -f4)
    echo "Required .NET SDK version from global.json: $REQUIRED_VERSION"
    
    # Simple version check - might need to be more sophisticated
    if [[ "$DOTNET_VERSION" != "$REQUIRED_VERSION"* ]]; then
        echo "Warning: Installed .NET SDK version ($DOTNET_VERSION) may not match required version ($REQUIRED_VERSION)"
        echo "Consider installing the exact version specified in global.json"
    fi
fi

# Install global tools
echo "Installing required .NET global tools..."
dotnet tool install --global dotnet-format || dotnet tool update --global dotnet-format

# Check if NX .NET plugin is installed
if ! grep -q "@nx/dotnet" package.json; then
    echo "Installing @nx/dotnet NX plugin..."
    npm install --save-dev @nx/dotnet
else
    echo "@nx/dotnet NX plugin is already installed."
fi

# Check if tools/dotnet directory exists
if [ ! -d "tools/dotnet" ]; then
    echo "Creating tools/dotnet directory structure..."
    mkdir -p tools/dotnet/scripts
    mkdir -p tools/dotnet/configs
    
    echo "Copying template files..."
    # This assumes the template files are already in the repo
    # If not, you would need to create them here
fi

echo ".NET development environment setup completed."
echo "You can now create .NET projects using Nx generators:"
echo "Example: npx nx generate @nx/dotnet:app my-app --directory=apps"

exit 0