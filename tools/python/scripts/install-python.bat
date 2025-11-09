@echo off
REM Python Installation and Version Check Script

setlocal enabledelayedexpansion

set MIN_PYTHON_VERSION=3.9
set PYTHON_INSTALLER_URL=https://www.python.org/ftp/python/3.13.7/python-3.13.7-amd64.exe
set PYTHON_INSTALLER=python-installer.exe

echo Checking Python installation...

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Python is not installed.
    call :PROMPT_INSTALL
    exit /b !ERRORLEVEL!
)

REM Check Python version
for /f "tokens=2" %%V in ('python -c "import sys; print(sys.version.split()[0])"') do (
    set PYTHON_VERSION=%%V
)

echo Found Python version !PYTHON_VERSION!

REM Compare version with minimum required
for /f "tokens=1,2,3 delims=." %%a in ("!PYTHON_VERSION!") do (
    set MAJOR=%%a
    set MINOR=%%b
)

for /f "tokens=1,2,3 delims=." %%a in ("%MIN_PYTHON_VERSION%") do (
    set REQ_MAJOR=%%a
    set REQ_MINOR=%%b
)

if !MAJOR! LSS !REQ_MAJOR! (
    echo Python version !PYTHON_VERSION! is below the required version %MIN_PYTHON_VERSION%.
    call :PROMPT_INSTALL
    exit /b !ERRORLEVEL!
)

if !MAJOR! EQU !REQ_MAJOR! if !MINOR! LSS !REQ_MINOR! (
    echo Python version !PYTHON_VERSION! is below the required version %MIN_PYTHON_VERSION%.
    call :PROMPT_INSTALL
    exit /b !ERRORLEVEL!
)

echo Python version !PYTHON_VERSION! meets the minimum requirement of %MIN_PYTHON_VERSION%.
exit /b 0

:PROMPT_INSTALL
echo.
echo This project requires Python %MIN_PYTHON_VERSION% or higher.
echo Would you like to download and install Python now? (Y/N)
choice /C YN /M "Install Python"

if %ERRORLEVEL% equ 1 (
    call :INSTALL_PYTHON
    exit /b !ERRORLEVEL!
) else (
    echo.
    echo Please install Python %MIN_PYTHON_VERSION% or higher manually from:
    echo https://www.python.org/downloads/
    echo.
    echo After installation, restart your terminal and run this script again.
    exit /b 1
)

:INSTALL_PYTHON
echo.
echo Starting Python installation process...
echo Downloading Python installer from: %PYTHON_INSTALLER_URL%
curl -L -o %PYTHON_INSTALLER% %PYTHON_INSTALLER_URL%

if %ERRORLEVEL% neq 0 (
    echo Failed to download Python installer. Error code: %ERRORLEVEL%
    echo Please install Python manually from https://www.python.org/downloads/
    exit /b 1
)

echo.
echo Installing Python...
echo IMPORTANT: Please check "Add Python to PATH" during installation!
echo.
echo The installer will now open. After installation completes, please close
echo the installer and return to this window to continue setup.
echo.
pause

start /wait %PYTHON_INSTALLER% /passive InstallAllUsers=1 PrependPath=1 Include_test=0

echo Cleaning up...
del %PYTHON_INSTALLER%

echo.
echo Verifying Python installation...
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Python installation failed or Python is not in PATH. Error code: %ERRORLEVEL%
    echo Please restart your terminal or computer and try again.
    exit /b 1
)

echo Python has been successfully installed!
echo Running 'python --version' to verify:
python --version
exit /b 0
