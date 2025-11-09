# NX Command Usage Guide

This document explains how to run NX commands in this project.

## Running NX Commands

There are two main ways to run NX commands:

### 1. Using NPM Scripts (Recommended for Common Tasks)

We've defined npm scripts for common tasks in `package.json`. For example:

```bash
# Run lint on Node.js projects
npm run nx:node-lint

# Run tests on Python projects
npm run nx:python-test

# Run the development server for .NET projects
npm run nx:dotnet-dev
```

### 2. Using NPX Directly (For Custom Commands)

For custom or one-off commands, you can use `npx nx` directly:

```bash
# Run a specific command
npx nx run-many --target=lint --projects=tag:node

# View the project graph
npx nx graph

# Run a specific project
npx nx run project-name:target
```

## NX Maintenance Commands

These commands help maintain a healthy Nx workspace:

> **Note**: Many nx commands automatically run `nx:reset` before execution to ensure fresh cache and valid configuration. This prevents stale cache issues and ensures consistent behavior across environments.

### nx:repair

```bash
npm run nx:repair
```

**What it does**: Repairs and validates Nx configuration files

- Ensures `nx.json` has proper structure and plugins
- Creates missing directories (`.nx/cache`, etc.)
- Verifies Nx installation
- Updates `nx.bat` wrapper for Windows

**When to use**:

- After upgrading Nx versions
- When Nx commands fail unexpectedly
- After cloning the repository
- When project graph seems corrupted

### nx:reset

```bash
npm run nx:reset
```

**What it does**: Runs `nx:repair` + clears the Nx cache + auto-tags projects

- Everything that `nx:repair` does
- Clears Nx's computational cache (executes official `nx reset`)
- **Auto-tags all projects** based on their executors
- Forces fresh project graph computation
- Cleans `.nx/cache` directory

**When to use**:

- When builds are behaving inconsistently
- After major dependency updates
- Before running affected commands in CI/CD
- When you suspect stale cache issues
- **After creating new projects** (ensures they get tagged automatically)

### nx:tag-projects

```bash
npm run nx:tag-projects
```

**What it does**: Automatically detects and tags all projects based on their executors

- Scans all projects in the workspace
- Detects language (Node.js, Python, .NET) from executors
- Adds appropriate tags: `node`, `python`, `dotnet`
- Adds additional tags: `express`, `next`, `fastapi`, `webapi`, `api`, `client`, `service`, `lib`
- Updates `project.json` files automatically

**When to use**:

- After creating projects with direct Nx generators
- When `--projects=tag:*` commands aren't finding your projects
- To ensure all projects have proper tags

### clean

```bash
npm run clean
```

**What it does**: Full workspace cleanup

- Runs `nx:reset` (repair + cache clearing)
- Removes `dist/` directory (build outputs)
- Removes `node_modules/.cache/` (all cached files)

**When to use**:

- Starting fresh after major changes
- Troubleshooting persistent build issues
- Before creating a clean build for deployment
- When disk space is needed

### Best Practices

- **Most commands**: Don't need manual reset/repair - they're automated in the workflow
- **CI/CD**: Use `nx:reset` before running affected commands to ensure clean state
- **Troubleshooting**: Start with `nx:reset`, escalate to `clean` if issues persist
- **Regular development**: Nx manages its cache automatically - no intervention needed

## Handling "No Projects" Errors

When running commands like `run-many` with project filters (e.g., `--projects=tag:node`), you might get an error if no projects match the criteria. This is expected if you haven't created any projects of that type yet.

For npm scripts, we've added error handling to ensure these commands exit successfully with a helpful message, which is especially useful in CI/CD pipelines.

## Creating New Projects

Create projects using Nx generators directly. Projects will be automatically tagged when you run any nx command:

```bash
# Create projects using Nx generators directly
npx nx generate @nx/express:app my-api --directory=apps
npx nx generate @nx/next:app my-web-app --directory=apps
npx nx generate @nxlv/python:fastapi-app my-service --directory=apps
npx nx generate @nx/dotnet:app my-dotnet-api --directory=apps

# Projects are automatically tagged when you run:
npm run nx:reset          # Tags all projects automatically
npm run nx:tag-projects   # Manual tagging if needed
```
