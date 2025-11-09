@echo off
REM Python Development Environment Setup Script
REM This script creates a Python virtual environment for development

echo ===== Python Development Environment Setup =====
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Check if Python installation is adequate
call "%SCRIPT_DIR%\check-python-ondemand.bat"
if %errorlevel% neq 0 (
    echo Failed to verify or install Python. Development environment setup aborted.
    exit /b 1
)

REM Show which Python is being used
echo Using Python:
python --version
echo Python executable path:
python -c "import sys; print(sys.executable)"
echo.

REM Check if .venv already exists
if exist ".venv" (
    echo Python virtual environment (.venv) already exists.
    echo To recreate it, delete the .venv folder and run this script again.
    echo.
    goto :DEPENDENCIES
)

REM Create a Python virtual environment
echo Creating Python virtual environment for development...
python -m venv .venv
echo.

:DEPENDENCIES
REM Install development requirements
echo Installing Python development dependencies...
.venv\Scripts\pip install --upgrade pip
.venv\Scripts\pip install -r python-dev-requirements.txt

echo.
echo Python development environment setup complete!
echo To activate, run: .venv\Scripts\activate
