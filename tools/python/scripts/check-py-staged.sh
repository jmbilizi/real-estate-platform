#!/bin/bash
# This script sets PYTHON_ENV for lint-staged compatibility
# The UV workspace shared venv is at the workspace root .venv

if [ -n "$WINDIR" ] || [ -n "$windir" ]; then
  # Windows
  export PYTHON_ENV="$(pwd)/.venv/Scripts"
else
  # Unix-like
  export PYTHON_ENV="$(pwd)/.venv/bin"
fi
