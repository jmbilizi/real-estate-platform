# .NET Development

This document provides information about .NET development in this monorepo.

## Setup

To set up .NET development environment:

```bash
npm run dotnet:setup
```

This script will:

1. Check for .NET SDK installation
2. Verify .NET SDK version
3. Install required .NET global tools
4. Ensure NX .NET plugin is installed
5. Set up template directories if needed

> **Automatic Installation**: If .NET SDK is not installed, the script can automatically download and install the required version (9.0.305). This feature works on Windows and macOS systems. On other systems, the script will provide instructions for manual installation.

### Configuring Auto-Installation

By default, automatic installation is enabled. You can disable this feature by setting `AUTO_INSTALL_ENABLED` to `false` in the `tools/dotnet/scripts/dotnet-dev-setup.js` file.

### Troubleshooting

If you encounter issues with automatic installation:

1. Ensure you have administrator privileges
2. Check your internet connection
3. Try installing manually from https://dotnet.microsoft.com/download/dotnet/9.0

## Code Quality Tools

.NET code quality tools for formatting and linting are automatically installed as part of the setup process.

```bash
npm run dotnet:setup
```

If you want to skip the tools installation, you can use:

```bash
npm run dotnet:setup -- --skip-tools
```

The following global .NET tools are installed during setup:

1. `dotnet-format` - Official .NET code formatter
2. `csharpier` - Opinionated C# code formatter
3. `roslynator.dotnet.cli` - Roslyn-based analyzers and code fixes
4. `dotnet-outdated-tool` - Tool to check for outdated NuGet packages
5. `dotnet-coverage` - Code coverage tools
6. `dotnet-cleanup` - Project file cleanup
7. `dotnet-doc` - Documentation generator

## Project Creation

Projects are created using Nx generators which provide complete project templates:

- `@nx/dotnet:app`: Creates .NET applications with full structure
- `@nx/dotnet:lib`: Creates .NET libraries with proper configuration

## Creating New Projects

Use Nx generators directly to create .NET projects:

```bash
# .NET Web API
npx nx generate @nx/dotnet:app my-api --directory=apps

# .NET Library
npx nx generate @nx/dotnet:lib my-lib --directory=libs

# .NET Console Application
npx nx generate @nx/dotnet:app my-console --directory=apps --template=console
```

Projects are automatically tagged with `dotnet` and additional tags when you run `npm run nx:reset` or any nx command.

Use Nx generators directly:

```bash
# .NET application
npx nx generate @nx/dotnet:app my-api

# .NET library
npx nx generate @nx/dotnet:lib my-lib
```

## Configuration Files

Important .NET configuration files are located in `tools/dotnet/configs/`:

- `global.json`: Specifies the .NET SDK version
- `Directory.Build.props`: Common MSBuild properties
- `Directory.Build.targets`: Common MSBuild targets

When a new project is created, these configuration files are used as a basis for the project setup.

## NX Integration

The monorepo uses the `@nx/dotnet` plugin for NX integration. Common NX commands:

```bash
# Run all .NET projects
npm run nx:dotnet-dev

# Format all .NET projects
npm run nx:dotnet-format

# Lint all .NET projects
npm run nx:dotnet-lint

# Run tests for all .NET projects
npm run nx:dotnet-test

# Build all .NET projects
npm run nx:dotnet-build
```

## Best Practices

1. Always use the provided scripts for creating new projects
2. Follow the code style defined in MSBuild properties
3. Tag .NET projects with `dotnet` in `project.json` for NX targeting
4. Use the NX commands for building and testing to ensure proper dependency resolution

## Troubleshooting

If you encounter issues:

1. Run `npm run dotnet:setup` to verify and fix your environment
2. Make sure you have the correct .NET SDK version installed (see config files)
3. Verify that required tools are installed with `dotnet tool list --global`
