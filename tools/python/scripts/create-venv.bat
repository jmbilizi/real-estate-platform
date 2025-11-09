@echo off
REM Check if Python installation is adequate
call "%~dp0\check-python-ondemand.bat"
if %ERRORLEVEL% neq 0 (
    echo Failed to verify or install Python. Virtual environment creation aborted.
    exit /b 1
)

REM Create virtual environment
echo Creating Python virtual environment at .venv...
python -m venv .venv

REM Upgrade pip
echo Upgrading pip...
.venv\Scripts\python -m pip install --upgrade pip

echo.
echo Virtual environment created successfully at .venv
echo.
echo To activate, run: .venv\Scripts\activate
