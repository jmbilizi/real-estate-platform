# Project Templates and Generation

This document explains how to use the project templates and generation scripts in the Polyglot monorepo.

## Overview

The monorepo supports various project types, including:

- .NET applications and libraries
- Python applications and libraries
- Node.js applications and libraries

To maintain consistency and simplify project creation, we use a template-based approach for generating new projects. The templates include:

- Basic project structure
- Proper NX configuration
- Standard files (README, .gitignore, etc.)
- Test setup
- Centralized configurations

## Project Generation

Projects are created using:

- **Node.js/TypeScript**: Nx generators (`@nx/node`, `@nx/express`, `@nx/next`) with centralized configurations
- **Python**: Nx generators (`@nxlv/python`) for apps and libraries
- **.NET**: Standard `dotnet new` command - the `@nx/dotnet` plugin automatically detects projects

All approaches provide:

- **Consistent Structure**: Organized in `apps/` and `libs/` directories
- **Nx Integration**: Full integration with monorepo tools and workflows
- **Auto-tagging**: Projects automatically tagged based on their type for easy filtering
- **Dependency Management**: Proper dependency graphs and build order

- **Node.js Projects**: For Node.js projects, we use NX generators with centralized configurations:
  - `tools/node/configs/` - Centralized configurations for ESLint, Prettier, TypeScript, and Jest
  - These are automatically applied to new projects during creation

## Creating New Projects

### Creating Projects

Use Nx generators directly for consistent project creation:

#### .NET Projects

The `@nx/dotnet` plugin is inference-based and doesn't provide generators. Use the standard `dotnet new` command:

```bash
# .NET Web API
dotnet new webapi -n MyApi -o apps/my-api

# .NET Class Library
dotnet new classlib -n MyLibrary -o libs/my-library

# .NET Console Application
dotnet new console -n MyConsoleApp -o apps/my-console-app

# Detect projects and create Nx targets
npm run nx:reset
```

See all available .NET templates: `dotnet new list`

#### Python Projects

Use Nx generators directly:

```bash
# FastAPI application
npx nx generate @nxlv/python:fastapi-app my-service --directory=apps

# Python library
npx nx generate @nxlv/python:lib shared-utils --directory=libs

# Python application
npx nx generate @nxlv/python:app my-app --directory=apps
```

Projects are automatically tagged when you run any nx command.

#### Node.js Projects

Use Nx generators directly:

```bash
# Node.js application
npx nx generate @nx/node:app my-service --directory=apps

# Node.js library
npx nx generate @nx/node:lib my-lib --directory=libs

# Express.js API
npx nx generate @nx/express:app my-api --directory=apps

# Next.js application
npx nx generate @nx/next:app my-web-app --directory=apps
```

Projects are automatically tagged when you run any nx command.

## Project Structure

All projects are created using Nx generators which automatically create the appropriate structure:

### .NET Projects

.NET projects created with `dotnet new` and detected by `@nx/dotnet`:

- Standard .NET project structure (`.csproj` based)
- MSBuild configuration from `tools/dotnet/configs/`
- Nx targets auto-generated based on project type
- Automatic dependency detection via `<ProjectReference>`

**Available Templates**:

- `webapi` - ASP.NET Core Web API
- `mvc` - ASP.NET Core Web App
- `console` - Console Application
- `classlib` - Class Library
- `xunit`/`nunit`/`mstest` - Test Projects
- See all: `dotnet new list`

**Auto-generated Nx Targets**:

- `build` - All projects
- `serve` - Executable projects (web apps, console apps)
- `test` - Test projects
- `pack` - Libraries
- `publish` - Applications

### Python Projects

Python projects created with `@nxlv/python` generators include:

- Python modules in `src/` directory
- Test files with pytest setup
- Dependency management (`requirements.txt`)
- Nx project configuration (`project.json`)
- Standard configuration files (.gitignore, etc.)

### Node.js Projects

Node.js projects use NX generators with centralized configurations:

- **Node.js Applications**: Created with `npm run node:create-app`
  - Includes proper project structure with src/ directory
  - Configured with centralized ESLint, Prettier, TypeScript, and Jest configs
  - Tagged with "node" and "service" tags

- **Node.js Libraries**: Created with `npm run node:create-lib`
  - Optimized for sharing code between applications
  - Tagged with "node" and "lib" tags

- **Express.js APIs**: Created with `npm run node:create-express`
  - Includes Express.js setup with proper middleware
  - Tagged with "node", "express", and "api" tags

- **Next.js Applications**: Created with `npm run node:create-next`
  - Includes modern Next.js setup
  - Tagged with "node", "next", and "client" tags

All Node.js projects automatically use the centralized configurations from `tools/node/configs/`.

## Customizing Templates

To customize the templates:

1. Navigate to the appropriate template directory
2. Edit the template files as needed
3. Save your changes

New projects will use your updated templates.

## NX Integration

After creating a project, it will automatically be integrated with NX:

```bash
# Build a specific project
npx nx build my-project

# Run tests for a specific project
npx nx test my-project

# Serve an application project
npx nx serve my-app
```

You can also view all projects:

```bash
npm run nx:list-projects
```

## Best Practices

1. Always use Nx generators rather than creating projects manually
2. Follow the standard project structure
3. Use appropriate tags in project.json for categorizing projects
4. Keep templates up to date with latest best practices
