@echo off
REM Direct Python Installer Script
REM This script installs Python without any prompts

setlocal enabledelayedexpansion

set PYTHON_INSTALLER_URL=https://www.python.org/ftp/python/3.13.7/python-3.13.7-amd64.exe
set PYTHON_INSTALLER=python-installer.exe

echo ======================================
echo Python Direct Installation Script
echo ======================================
echo.
echo This script will download and install Python 3.13.7
echo No prompts will be shown during installation.
echo.
echo Checking if Python is already installed...

where python 2>nul | findstr /i "python.exe" >nul
if %ERRORLEVEL% equ 0 (
    echo Found Python in PATH
    for /f "usebackq delims=" %%V in (`python -c "import sys; print(sys.version.split()[0])" 2^>nul`) do (
        set PYTHON_VERSION=%%V
    )
    
    if not "!PYTHON_VERSION!"=="" (
        echo Found Python version !PYTHON_VERSION!
        echo Using existing Python installation.
        python --version
        echo Python path: 
        python -c "import sys; print(sys.executable)"
        goto :EXIT_SUCCESS
    )
)

echo Python not found or not working properly. Starting installation...
echo.
echo Downloading Python installer...
curl -L -o %PYTHON_INSTALLER% %PYTHON_INSTALLER_URL%

if %ERRORLEVEL% neq 0 (
    echo Failed to download Python installer. Error code: %ERRORLEVEL%
    echo Please try again or install Python manually from https://www.python.org/downloads/
    exit /b 1
)

echo.
echo Installing Python 3.13.7...
echo This may take a few minutes. Please wait...
start /wait %PYTHON_INSTALLER% /quiet InstallAllUsers=1 PrependPath=1 Include_test=0

echo Cleaning up...
del %PYTHON_INSTALLER%

echo.
echo Verifying Python installation...
echo Refreshing environment variables...

REM Refresh PATH from registry to make Python available
echo Attempting to refresh PATH from registry...
for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "SYS_PATH=%%b"
for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path' 2^>nul') do set "USER_PATH=%%b"
set "PATH=%USER_PATH%;%SYS_PATH%;%PATH%"

REM Try additional paths where Python might be installed
set POSSIBLE_PYTHON_PATHS=^
C:\Python311\;^
C:\Python312\;^
C:\Python313\;^
C:\Program Files\Python311\;^
C:\Program Files\Python312\;^
C:\Program Files\Python313\;^
C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311\;^
C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\;^
C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python313\

set "PATH=%PATH%;%POSSIBLE_PYTHON_PATHS%"

REM Check if Python is now in PATH
where python 2>nul | findstr /i "python.exe" >nul
if %ERRORLEVEL% neq 0 (
    REM Create a PowerShell script to search for Python installations
    echo $pythonInstalls = Get-ChildItem -Path "C:\Program Files\", "C:\Python*", "C:\Users\$env:USERNAME\AppData\Local\Programs\Python\" -Filter "python.exe" -Recurse -ErrorAction SilentlyContinue ^| Select-Object -ExpandProperty FullName > find-python.ps1
    echo Write-Host $pythonInstalls >> find-python.ps1
    
    echo Searching for Python installations...
    powershell -ExecutionPolicy Bypass -File find-python.ps1
    del find-python.ps1
    
    echo Python installation completed, but Python is not in PATH.
    echo.
    echo You will need to restart your terminal or VS Code for the PATH to update.
    echo.
) else (
    echo Python is now in PATH:
    python --version 2>nul
)

:EXIT_SUCCESS
echo.
echo ======================================
echo Python is successfully installed!
echo.
echo If you're running this as part of an automated script, we'll try to
echo continue with the PATH environment as is.
echo ======================================

exit /b 0
