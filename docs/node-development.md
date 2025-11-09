# Node.js Development

This document provides information about Node.js development in this monorepo.

## Prerequisites

### Node.js Version

This project requires Node.js version 20.19.5 (LTS). You can check your current version with:

```bash
node --version
```

If you need to install or update Node.js, we recommend using a version manager:

#### Using nvm (Node Version Manager)

For Unix/macOS:

```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash

# Install and use the required Node.js version
nvm install 20.19.5
nvm use 20.19.5
```

For Windows:

```bash
# Install nvm-windows from: https://github.com/coreybutler/nvm-windows/releases

# Install and use the required Node.js version
nvm install 20.19.5
nvm use 20.19.5
```

#### Manual Installation

You can also download and install Node.js 20.19.5 directly from [nodejs.org](https://nodejs.org/).

### Verifying Your Setup

To verify that you have the correct Node.js version:

```bash
npm run node:check-version
```

## Project Structure

Node.js projects in this monorepo follow the NX workspace structure:

```
apps/
  ├── clients/         # Frontend applications (Next.js, React, etc.)
  ├── services/        # Backend services (Node.js, Express, etc.)
libs/
  ├── shared/          # Shared libraries used across projects
  ├── ui/              # Shared UI components
  ├── utils/           # Utility libraries
tools/
  └── node/            # Node.js tooling and configuration
      ├── configs/     # Centralized configurations
      └── scripts/     # Node.js utility scripts
```

## Creating New Projects

Use Nx generators directly to create Node.js projects:

### Node.js Application

```bash
npx nx generate @nx/node:app my-service --directory=apps
```

### Node.js Library

```bash
npx nx generate @nx/node:lib my-lib --directory=libs
```

### Express.js Application

```bash
npx nx generate @nx/express:app my-api --directory=apps
```

### Next.js Application

```bash
npx nx generate @nx/next:app my-web-app --directory=apps
```

### Auto-Configuration

After creating projects, they are automatically configured when you run any nx command:

1. **Auto-tagging**: Projects are tagged based on their executors (`node`, `express`, `next`, `api`, `client`, etc.)
2. **Centralized configs**: Apply configs manually with `npm run node:apply-configs <project-path>`
3. **Nx integration**: Projects are immediately available for `npm run nx:node-*` commands

## Centralized Configurations

The monorepo uses centralized configurations for all Node.js projects to ensure consistency:

| Tool       | Configuration Path            | Purpose                       |
| ---------- | ----------------------------- | ----------------------------- |
| ESLint     | tools/node/configs/eslint     | Code linting                  |
| Prettier   | tools/node/configs/prettier   | Code formatting               |
| TypeScript | tools/node/configs/typescript | Type checking and compilation |
| Jest       | tools/node/configs/jest       | Testing                       |

### How Configuration Works

1. **New Projects**: When you create a new project using the provided commands, the centralized configurations are automatically applied.

2. **Existing Projects**: To apply centralized configurations to an existing project, run:

   ```bash
   npm run node:apply-configs <project-directory>
   ```

3. **Configuration Structure**: Each tool's configuration extends the centralized config:
   ```javascript
   // Example project .eslintrc.js
   module.exports = {
     extends: ["../../tools/node/configs/eslint/base"],
   };
   ```

### Migration from Root Configurations

We are transitioning away from root-level configuration files (`.eslintrc.json`, `.prettierrc`, etc.) to our centralized configuration system. For detailed information about this migration, see the [Node.js Configuration Migration Plan](./node-config-migration.md).

## Common Commands

### Development

```bash
# Run all Node.js projects
npm run nx:node-dev

# Run a specific project
nx serve my-project
```

### Code Quality

```bash
# Format all files in workspace (including repo-level files)
npm run nx:workspace-format

# Format only Node.js project files
npm run nx:node-format

# Check formatting for all files
npm run nx:workspace-format-check

# Lint all Node.js projects
npm run nx:node-lint

# Type check all Node.js projects
npm run nx:node-type-check

# Format a specific project
nx format:write --projects=my-project

# Lint a specific project
nx lint my-project
```

> **Note:** Use `nx:workspace-format` to format all files including `scripts/`, `docs/`, `package.json`, etc. Use `nx:node-format` for project-specific formatting only.

### Testing

```bash
# Run all tests
npm run nx:node-test

# Run tests for a specific project
nx test my-project

# Run tests with code coverage
nx test my-project --coverage
```

### Building

```bash
# Build all Node.js projects
npm run nx:node-build

# Build a specific project
nx build my-project
```

## Advanced NX Commands

NX provides powerful generators for creating various components:

```bash
# Generate a React component
nx g @nx/react:component MyComponent --project=my-app

# Generate an Express controller
nx g @nx/express:controller MyController --project=my-api

# Generate a Next.js page
nx g @nx/next:page my-page --project=my-web-app
```

## Best Practices

1. **Project Tags**: Always add appropriate tags to projects to organize them:
   - `node` for all Node.js projects
   - Additional tags like `express`, `next`, `api`, `client`, etc.

2. **Module Boundaries**: Respect the module boundaries defined in `nx.json`

3. **Shared Code**: Extract reusable code into libraries in the `libs/` directory

4. **Dependencies**: Manage dependencies through NX project references

5. **Testing**: Write tests for all projects using Jest

6. **Configuration**: Use centralized configurations for consistent code style and behavior

## Troubleshooting

If you encounter issues:

1. Verify your Node.js version: `npm run node:check-version`
2. Clear the NX cache: `npm run nx:reset`
3. Check for linting errors: `npm run nx:node-lint`
4. Verify project dependencies: `nx dep-graph`
5. Re-apply configurations: `npm run node:apply-configs <project-directory>`
6. Get help: `npm run node:help`
