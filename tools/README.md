# Development Tools for Polyglot Monorepo

This directory contains development tools and configurations for the Polyglot monorepo managed by NX.

## Overview

The tools system provides standardized development workflows for Python, .NET, and Node.js projects. Projects are created using Nx generators which automatically handle project structure, configuration, and integration with the monorepo.

## Directory Structure

```
tools/
├── python/
│   ├── configs/          # Python tool configurations
│   ├── docs/            # Python development guides
│   └── scripts/         # Python setup and utility scripts
├── dotnet/
│   ├── configs/         # .NET tool configurations
│   ├── scripts/         # .NET setup and utility scripts
│   └── README.md        # .NET development guide
├── node/
│   ├── configs/         # Node.js tool configurations
│   └── scripts/         # Node.js setup and utility scripts
└── nx/
    ├── auto-tag-projects.js  # Universal project tagging
    ├── repair-nx.js          # Nx workspace repair tools
    └── safe-run-many.js      # Safe execution of nx run-many commands
```

## Project Creation

### Python Projects

Create Python projects using Nx generators directly:

```bash
# FastAPI application
npx nx generate @nxlv/python:fastapi-app my-service --directory=apps

# Python library
npx nx generate @nxlv/python:lib my-lib --directory=libs

# Python application
npx nx generate @nxlv/python:app my-app --directory=apps
```

Projects are automatically tagged when you run any nx command.

### .NET Projects

Create .NET projects using Nx generators directly:

```bash
# .NET application
npx nx generate @nx/dotnet:app my-api --directory=apps

# .NET library
npx nx generate @nx/dotnet:lib my-lib --directory=libs
```

Projects are automatically tagged when you run any nx command.

## Template Details

### Python Templates

The Python templates include:

- `project.json`: NX configuration for the project
- `requirements.txt`: Python package dependencies
- `README.md`: Documentation template

The generation script will create:

- Basic Python package structure
- `setup.py` file
- Example code files
- Basic test file

### .NET Templates

The .NET templates include:

- `project.json`: NX configuration for the project
- `README.md`: Documentation template

The generation script will:

- Create a .NET project using the dotnet CLI
- Set up a test project with xUnit
- Configure reference between the main project and test project
- Create Directory.Build.props for consistent settings
- Add a .gitignore file for .NET projects

## Integration with NX

Once projects are created, they can be used with NX commands:

```
npx nx build <project-name>
npx nx test <project-name>
npx nx lint <project-name>
```

For app projects, you can also use:

```
npx nx serve <project-name>
```

## Modifying Templates

To modify the templates:

1. Edit the template files in the appropriate directory
2. Update the generation scripts if necessary
3. Test the changes by creating a new project

## Prerequisites

- Python 3.9+ for Python projects
- .NET SDK 8.0+ for .NET projects
- NX CLI
- For .NET projects, the @nx/dotnet executor plugin
