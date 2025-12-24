````markdown
# .NET Setup

## Prerequisites

- .NET SDK 8.0+
- Node.js/npm
- NX CLI

## Setup

```bash
npm run dotnet:env
```

## Creating Projects

```bash
# Use dotnet CLI templates
dotnet new webapi -n my-api -o apps/my-api
dotnet new classlib -n my-lib -o libs/my-lib
dotnet new xunit -n my-api-tests -o apps/my-api/tests

# Detect projects
npm run nx:reset
```

## Common Commands

```bash
# Single project
nx build my-api
nx test my-api-tests
nx serve my-api

# All .NET projects
npm run nx:dotnet-build
npm run nx:dotnet-test
npm run nx:dotnet-dev
```

## Configuration Files

All .NET configuration files are located at **workspace root** (auto-discovered by MSBuild/.NET):

- `Directory.Build.props` - MSBuild properties and code analysis settings
- `Directory.Build.targets` - Post-build targets and custom tasks
- `Directory.Packages.props` - Central Package Management (CPM)
- `global.json` - .NET SDK version pinning
- `.editorconfig` - Code style rules (multi-language, includes C# and StyleCop diagnostics)
- `nuget.config` - NuGet package sources and restore configuration

MSBuild and NuGet automatically discover these files by searching upward from each project directory.

### EditorConfig Behavior

- **Root config applies automatically**: All projects inherit workspace `.editorconfig` rules by default
- **Project overrides are optional**: Create project-specific `.editorconfig` (with `root = false`) only if you need different rules
- **Changes take effect immediately**: Modifying root config affects all projects without local overrides
````
