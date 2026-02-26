@echo off
REM This script sets PYTHON_ENV for lint-staged compatibility
REM The UV workspace shared venv is at the workspace root .venv
set PYTHON_ENV=%CD%\.venv\Scripts

REM The rest of the logic is now handled by hooks-runner.js
