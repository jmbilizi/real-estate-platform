@echo off
REM .NET Setup Script for Polyglot Monorepo

echo Setting up .NET development environment...

REM Check if .NET SDK is installed
where dotnet >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo .NET SDK not found. Please install .NET SDK 8.0 or higher.
    echo Visit https://dotnet.microsoft.com/download to download and install.
    exit /b 1
)

REM Check .NET version
for /f "tokens=* USEBACKQ" %%F in (`dotnet --version`) do (
    set DOTNET_VERSION=%%F
)
echo Found .NET SDK version: %DOTNET_VERSION%

REM Check if global.json exists and matches installed version
if exist global.json (
    for /f "tokens=2 delims=:, " %%I in ('findstr "version" global.json') do (
        set REQUIRED_VERSION=%%~I
    )
    set REQUIRED_VERSION=%REQUIRED_VERSION:"=%
    echo Required .NET SDK version from global.json: %REQUIRED_VERSION%
    
    REM Simple version check - might need to be more sophisticated
    if not "%DOTNET_VERSION:~0,4%"=="%REQUIRED_VERSION:~0,4%" (
        echo Warning: Installed .NET SDK version (%DOTNET_VERSION%) may not match required version (%REQUIRED_VERSION%)
        echo Consider installing the exact version specified in global.json
    )
)

REM Install global tools
echo Installing required .NET global tools...
dotnet tool install --global dotnet-format || dotnet tool update --global dotnet-format

REM Check if NX .NET plugin is installed
findstr "@nx/dotnet" package.json >nul
if %ERRORLEVEL% neq 0 (
    echo Installing @nx/dotnet NX plugin...
    call npm install --save-dev @nx/dotnet
) else (
    echo @nx/dotnet NX plugin is already installed.
)

REM Check if tools/dotnet directory exists
if not exist tools\dotnet (
    echo Creating tools\dotnet directory structure...
    mkdir tools\dotnet\templates\app
    mkdir tools\dotnet\templates\lib
    mkdir tools\dotnet\scripts
    
    echo Copying template files...
    REM This assumes the template files are already in the repo
    REM If not, you would need to create them here
)

echo .NET development environment setup completed.
echo You can now create .NET projects using Nx generators:
echo Example: npx nx generate @nx/dotnet:app my-app --directory=apps

exit /b 0