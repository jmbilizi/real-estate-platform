#!/bin/bash
# This script now delegates to the unified hooks system
# It uses hooks-runner.js for consistent behavior across all languages

# Just set PYTHON_ENV to make lint-staged happy if Python files are found
export PYTHON_ENV="$(pwd)/.venv/bin"

# The rest of the logic is now handled by hooks-runner.js
  if [ -n "$WINDIR" ] || [ -n "$windir" ]; then
    # Windows
    export PYTHON_ENV="$(pwd)/.venv/Scripts"
  else
    # Unix-like
    export PYTHON_ENV="$(pwd)/.venv/bin"
  fi
fi
