@echo off
REM Setup Nx for Python development
echo ===== Setting up Nx for Python Development =====

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Check if Python is available and install if needed
call "%SCRIPT_DIR%\check-python-ondemand.bat"
if %ERRORLEVEL% neq 0 (
    echo Failed to verify or install Python. Nx Python setup aborted.
    exit /b 1
)

REM Check if .venv exists, if not create it
if not exist ".venv" (
    echo Creating Python virtual environment...
    python -m venv .venv
    if %ERRORLEVEL% neq 0 (
        echo Failed to create Python virtual environment. Nx Python setup aborted.
        exit /b 1
    )
    echo Virtual environment created at .venv
) else (
    echo Using existing Python virtual environment at .venv
)

REM Check if @nxlv/python is installed
echo Checking if Nx Python plugin is installed...
node -e "try { require.resolve('@nxlv/python'); console.log('Nx Python plugin is already installed.'); } catch(e) { console.log('Nx Python plugin is not installed.'); process.exit(1); }"

IF %ERRORLEVEL% NEQ 0 (
    echo Installing Nx Python plugin...
    call npm install -D @nxlv/python
)

REM Initialize Nx Python plugin
echo Initializing Nx Python plugin...
call npx nx g @nxlv/python:init

REM Create nx-python.json in the workspace root if it doesn't exist
IF NOT EXIST "nx-python.json" (
    echo Creating nx-python.json configuration...
    echo {> nx-python.json
    echo   "executors": {>> nx-python.json
    echo     "ensure-dependencies": {>> nx-python.json
    echo       "implementation": "./node_modules/@nxlv/python/src/executors/ensure-dependencies/executor",>> nx-python.json
    echo       "schema": "./node_modules/@nxlv/python/src/executors/ensure-dependencies/schema.json",>> nx-python.json
    echo       "description": "Install dependencies defined in requirements.txt or pyproject.toml">> nx-python.json
    echo     },>> nx-python.json
    echo     "lint": {>> nx-python.json
    echo       "implementation": "./node_modules/@nxlv/python/src/executors/lint/executor",>> nx-python.json
    echo       "schema": "./node_modules/@nxlv/python/src/executors/lint/schema.json",>> nx-python.json
    echo       "description": "Lint Python code using a variety of linters">> nx-python.json
    echo     },>> nx-python.json
    echo     "test": {>> nx-python.json
    echo       "implementation": "./node_modules/@nxlv/python/src/executors/test/executor",>> nx-python.json
    echo       "schema": "./node_modules/@nxlv/python/src/executors/test/schema.json",>> nx-python.json
    echo       "description": "Test Python code using pytest">> nx-python.json
    echo     },>> nx-python.json
    echo     "build": {>> nx-python.json
    echo       "implementation": "./node_modules/@nxlv/python/src/executors/build/executor",>> nx-python.json
    echo       "schema": "./node_modules/@nxlv/python/src/executors/build/schema.json",>> nx-python.json
    echo       "description": "Build Python package using setuptools">> nx-python.json
    echo     },>> nx-python.json
    echo     "execute": {>> nx-python.json
    echo       "implementation": "./node_modules/@nxlv/python/src/executors/execute/executor",>> nx-python.json
    echo       "schema": "./node_modules/@nxlv/python/src/executors/execute/schema.json",>> nx-python.json
    echo       "description": "Execute Python script">> nx-python.json
    echo     }>> nx-python.json
    echo   }>> nx-python.json
    echo }>> nx-python.json
)

REM Create template directories
echo Creating Python executor templates...
if not exist "tools\nx-python-templates" mkdir tools\nx-python-templates

REM Create app template
echo {> tools\nx-python-templates\app-project.json
echo   "name": "[project-name]",>> tools\nx-python-templates\app-project.json
echo   "$schema": "../../../node_modules/nx/schemas/project-schema.json",>> tools\nx-python-templates\app-project.json
echo   "projectType": "application",>> tools\nx-python-templates\app-project.json
echo   "sourceRoot": "[project-path]/src",>> tools\nx-python-templates\app-project.json
echo   "targets": {>> tools\nx-python-templates\app-project.json
echo     "lint": {>> tools\nx-python-templates\app-project.json
echo       "executor": "@nxlv/python:lint",>> tools\nx-python-templates\app-project.json
echo       "options": {>> tools\nx-python-templates\app-project.json
echo         "linter": "flake8">> tools\nx-python-templates\app-project.json
echo       }>> tools\nx-python-templates\app-project.json
echo     },>> tools\nx-python-templates\app-project.json
echo     "test": {>> tools\nx-python-templates\app-project.json
echo       "executor": "@nxlv/python:test",>> tools\nx-python-templates\app-project.json
echo       "options": {}>> tools\nx-python-templates\app-project.json
echo     },>> tools\nx-python-templates\app-project.json
echo     "build": {>> tools\nx-python-templates\app-project.json
echo       "executor": "@nxlv/python:build",>> tools\nx-python-templates\app-project.json
echo       "options": {>> tools\nx-python-templates\app-project.json
echo         "outputPath": "dist/[project-name]",>> tools\nx-python-templates\app-project.json
echo         "baseHref": "/">> tools\nx-python-templates\app-project.json
echo       }>> tools\nx-python-templates\app-project.json
echo     },>> tools\nx-python-templates\app-project.json
echo     "serve": {>> tools\nx-python-templates\app-project.json
echo       "executor": "@nxlv/python:execute",>> tools\nx-python-templates\app-project.json
echo       "options": {>> tools\nx-python-templates\app-project.json
echo         "command": "uvicorn [project-name].main:app --reload">> tools\nx-python-templates\app-project.json
echo       }>> tools\nx-python-templates\app-project.json
echo     }>> tools\nx-python-templates\app-project.json
echo   },>> tools\nx-python-templates\app-project.json
echo   "tags": []>> tools\nx-python-templates\app-project.json
echo }>> tools\nx-python-templates\app-project.json

REM Create lib template
echo {> tools\nx-python-templates\lib-project.json
echo   "name": "[project-name]",>> tools\nx-python-templates\lib-project.json
echo   "$schema": "../../../node_modules/nx/schemas/project-schema.json",>> tools\nx-python-templates\lib-project.json
echo   "projectType": "library",>> tools\nx-python-templates\lib-project.json
echo   "sourceRoot": "[project-path]/src",>> tools\nx-python-templates\lib-project.json
echo   "targets": {>> tools\nx-python-templates\lib-project.json
echo     "lint": {>> tools\nx-python-templates\lib-project.json
echo       "executor": "@nxlv/python:lint",>> tools\nx-python-templates\lib-project.json
echo       "options": {>> tools\nx-python-templates\lib-project.json
echo         "linter": "flake8">> tools\nx-python-templates\lib-project.json
echo       }>> tools\nx-python-templates\lib-project.json
echo     },>> tools\nx-python-templates\lib-project.json
echo     "test": {>> tools\nx-python-templates\lib-project.json
echo       "executor": "@nxlv/python:test",>> tools\nx-python-templates\lib-project.json
echo       "options": {}>> tools\nx-python-templates\lib-project.json
echo     },>> tools\nx-python-templates\lib-project.json
echo     "build": {>> tools\nx-python-templates\lib-project.json
echo       "executor": "@nxlv/python:build",>> tools\nx-python-templates\lib-project.json
echo       "options": {>> tools\nx-python-templates\lib-project.json
echo         "outputPath": "dist/[project-name]",>> tools\nx-python-templates\lib-project.json
echo         "baseHref": "/">> tools\nx-python-templates\lib-project.json
echo       }>> tools\nx-python-templates\lib-project.json
echo     }>> tools\nx-python-templates\lib-project.json
echo   },>> tools\nx-python-templates\lib-project.json
echo   "tags": []>> tools\nx-python-templates\lib-project.json
echo }>> tools\nx-python-templates\lib-project.json

echo Nx Python setup complete!
