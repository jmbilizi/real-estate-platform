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

Located in `tools/dotnet/configs/`:

- `Directory.Build.props` - MSBuild properties
- `Directory.Packages.props` - Package management
- `global.json` - SDK version
- `.editorconfig` - Code style
````
