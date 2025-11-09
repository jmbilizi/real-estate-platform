@echo off
REM This script now delegates to the unified hooks system
REM It uses hooks-runner.js for consistent behavior across all languages

REM Just set PYTHON_ENV to make lint-staged happy if Python files are found
set PYTHON_ENV=%CD%\.venv\Scripts

REM The rest of the logic is now handled by hooks-runner.js
