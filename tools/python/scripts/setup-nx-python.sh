#!/bin/bash
# Setup Nx for Python development

echo "===== Setting up Nx for Python Development ====="

# Check if @nxlv/python is installed
echo "Checking if Nx Python plugin is installed..."
if node -e "try { require.resolve('@nxlv/python'); console.log('Nx Python plugin is already installed.'); } catch(e) { console.log('Nx Python plugin is not installed.'); process.exit(1); }"; then
    echo "Nx Python plugin is already installed."
else
    echo "Installing Nx Python plugin..."
    npm install -D @nxlv/python
fi

# Initialize Nx Python plugin
echo "Initializing Nx Python plugin..."
npx nx g @nxlv/python:init

# Create nx-python.json in the workspace root if it doesn't exist
if [ ! -f "nx-python.json" ]; then
    echo "Creating nx-python.json configuration..."
    cat << EOF > nx-python.json
{
  "executors": {
    "ensure-dependencies": {
      "implementation": "./node_modules/@nxlv/python/src/executors/ensure-dependencies/executor",
      "schema": "./node_modules/@nxlv/python/src/executors/ensure-dependencies/schema.json",
      "description": "Install dependencies defined in requirements.txt or pyproject.toml"
    },
    "lint": {
      "implementation": "./node_modules/@nxlv/python/src/executors/lint/executor",
      "schema": "./node_modules/@nxlv/python/src/executors/lint/schema.json",
      "description": "Lint Python code using a variety of linters"
    },
    "test": {
      "implementation": "./node_modules/@nxlv/python/src/executors/test/executor",
      "schema": "./node_modules/@nxlv/python/src/executors/test/schema.json",
      "description": "Test Python code using pytest"
    },
    "build": {
      "implementation": "./node_modules/@nxlv/python/src/executors/build/executor",
      "schema": "./node_modules/@nxlv/python/src/executors/build/schema.json",
      "description": "Build Python package using setuptools"
    },
    "execute": {
      "implementation": "./node_modules/@nxlv/python/src/executors/execute/executor",
      "schema": "./node_modules/@nxlv/python/src/executors/execute/schema.json",
      "description": "Execute Python script"
    }
  }
}
EOF
fi

echo "Creating Python executor templates..."
mkdir -p tools/nx-python-templates
cat << EOF > tools/nx-python-templates/app-project.json
{
  "name": "[project-name]",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "projectType": "application",
  "sourceRoot": "[project-path]/src",
  "targets": {
    "lint": {
      "executor": "@nxlv/python:lint",
      "options": {
        "linter": "flake8"
      }
    },
    "test": {
      "executor": "@nxlv/python:test",
      "options": {}
    },
    "build": {
      "executor": "@nxlv/python:build",
      "options": {
        "outputPath": "dist/[project-name]",
        "baseHref": "/"
      }
    },
    "serve": {
      "executor": "@nxlv/python:execute",
      "options": {
        "command": "uvicorn [project-name].main:app --reload"
      }
    }
  },
  "tags": []
}
EOF

cat << EOF > tools/nx-python-templates/lib-project.json
{
  "name": "[project-name]",
  "$schema": "../../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "sourceRoot": "[project-path]/src",
  "targets": {
    "lint": {
      "executor": "@nxlv/python:lint",
      "options": {
        "linter": "flake8"
      }
    },
    "test": {
      "executor": "@nxlv/python:test",
      "options": {}
    },
    "build": {
      "executor": "@nxlv/python:build",
      "options": {
        "outputPath": "dist/[project-name]",
        "baseHref": "/"
      }
    }
  },
  "tags": []
}
EOF

echo "Nx Python setup complete!"
