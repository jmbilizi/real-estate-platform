@echo off
REM This script is run when a Python-related command is executed
REM It checks for Python and sets it up only when needed for Python tasks
REM Fully automated - no user interaction required

setlocal enabledelayedexpansion

echo ======================================
echo Checking Python installation...
echo ======================================

REM Check if Python is already available
where python 2>nul | findstr /i "python.exe" >nul
if %ERRORLEVEL% equ 0 (
    REM Python found, check version
    for /f "usebackq delims=" %%V in (`python -c "import sys; print(sys.version.split()[0])" 2^>nul`) do (
        set PYTHON_VERSION=%%V
    )
    
    if "!PYTHON_VERSION!"=="" (
        echo Python command found but cannot get version. Installing Python...
        goto :INSTALL_PYTHON
    )
    
    echo Found Python version !PYTHON_VERSION!
    
    REM Parse version numbers
    for /f "tokens=1,2,3 delims=." %%a in ("!PYTHON_VERSION!") do (
        set MAJOR=%%a
        set MINOR=%%b
    )
    
    REM Check version is adequate (3.9+)
    if !MAJOR! geq 3 (
        if !MAJOR! equ 3 (
            if !MINOR! geq 9 (
                echo Using Python !PYTHON_VERSION!
                echo Python path: 
                python -c "import sys; print(sys.executable)"
                exit /b 0
            )
        ) else (
            echo Using Python !PYTHON_VERSION!
            echo Python path: 
            python -c "import sys; print(sys.executable)"
            exit /b 0
        )
    )
    
    echo WARNING: Python version !PYTHON_VERSION! is below the recommended version 3.9+.
    echo Installing newer Python version...
    goto :INSTALL_PYTHON
) else (
    echo Python not found. Installing Python...
    goto :INSTALL_PYTHON
)

:INSTALL_PYTHON
REM Run the direct installer without prompts
echo.
echo Running Python direct installer...
call "%~dp0\install-python-direct.bat"
if %ERRORLEVEL% neq 0 (
    echo.
    echo ======================================
    echo ERROR: Python installation failed with error code %ERRORLEVEL%
    echo Please run tools\python\scripts\install-python-direct.bat manually
    echo or install Python 3.11+ from https://www.python.org/downloads/
    echo ======================================
    exit /b 1
)

echo.
echo ======================================
echo Python installation completed successfully!
echo ======================================
exit /b 0
