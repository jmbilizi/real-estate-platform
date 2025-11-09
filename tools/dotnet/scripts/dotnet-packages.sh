#!/bin/bash

# Wrapper script for dotnet-packages.js
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

node "$SCRIPT_DIR/dotnet-packages.js" "$@"