# .NET Development

## Setup

```bash
npm run dotnet:env
```

Installs .NET SDK (if missing), global tools, and Nx plugin.

## Creating Projects

Use standard `dotnet new` commands:

```bash
# Web API
dotnet new webapi -n MyApi -o apps/my-api

# Console App
dotnet new console -n MyApp -o apps/my-app

# Class Library
dotnet new classlib -n MyLib -o libs/my-lib

# Tests
dotnet new xunit -n MyApi.Tests -o apps/my-api/tests
```

After creating or deleting projects:

```bash
npm run dotnet:setup-projects
```

This syncs `real-estate-platform.sln` with all .csproj files and creates project.json files.

> **Note**: This also runs automatically as part of `npm run nx:reset` and during pre-commit hooks, ensuring solution files stay synchronized.

## Configuration

All .NET configuration files are at **workspace root** (auto-discovered by MSBuild/.NET):

- `Directory.Build.props` - MSBuild properties for all projects
- `Directory.Build.targets` - Post-build targets
- `Directory.Packages.props` - Central package management (CPM)
- `global.json` - .NET SDK version pinning
- `.editorconfig` - Code style rules (multi-language, includes C# StyleCop rules)
- `nuget.config` - NuGet package sources and restore settings

### EditorConfig Hierarchy

**Root config** (`.editorconfig` at workspace root with `root = true`):

- Defines default rules for all .NET projects
- Automatically discovered via upward search from each project
- Projects inherit all rules unless they have their own `.editorconfig`

**Project-specific overrides** (optional `.editorconfig` in project folder with `root = false`):

- Used only when you need different rules for a specific project
- Inherits from root config, then applies local overrides
- Most projects don't need this - root config is sufficient

**Example**: To disable a specific rule for one project, create `apps/my-api/.editorconfig`:

```ini
root = false  # Inherit from workspace root
[*.cs]
dotnet_diagnostic.SA1101.severity = none  # Override: disable "prefix with this"
```

## Common Commands

```bash
# Build/run
nx build my-api
nx serve my-api
nx test my-api-tests

# All .NET projects
npm run nx:dotnet-build
npm run nx:dotnet-test
```

**Problem**: After creating a .NET project, Nx doesn't recognize it.

**Solution**:

```bash
# Run the reset command to detect projects
npm run nx:reset

# Verify project was detected
nx show projects
```

#### Build Fails with Dependency Errors

**Problem**: Project builds fail due to missing dependencies.

**Solution**:

```bash
# Ensure project references are correct
cd apps/my-api
dotnet add reference ../../libs/my-library/MyLibrary.csproj

# Rebuild with Nx
nx build my-api
```

#### .NET SDK Issues

**Problem**: Wrong .NET SDK version or SDK not found.

**Solution**:

```bash
# Verify and fix environment
npm run dotnet:env

# Check installed SDKs
dotnet --list-sdks

# Check required version
type tools\dotnet\configs\global.json
```

#### Targets Not Available

**Problem**: Expected targets like `serve` or `test` don't exist.

**Solution**:

- `serve` target: Only created for executable projects (web apps, console apps)
- `test` target: Only created for test projects (xunit, nunit, mstest)
- `pack` target: Only created for class libraries

Verify project type in `.csproj`:

```xml
<PropertyGroup>
  <OutputType>Exe</OutputType>  <!-- For executable -->
  <IsTestProject>true</IsTestProject>  <!-- For tests -->
</PropertyGroup>
```

#### Tools Not Installed

**Problem**: Global .NET tools are missing.

**Solution**:

```bash
# Reinstall all tools
npm run dotnet:env

# Verify tools are installed
dotnet tool list --global
```

### Getting Help

If you encounter issues:

1. Run `npm run dotnet:env` to verify and fix your environment
2. Check that you have the correct .NET SDK version (see `tools/dotnet/configs/global.json`)
3. Verify that required tools are installed: `dotnet tool list --global`
4. Check the Nx plugin documentation: https://nx.dev/nx-api/dotnet
5. Review the official .NET CLI docs: https://docs.microsoft.com/dotnet/core/tools/
