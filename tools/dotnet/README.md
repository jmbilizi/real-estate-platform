# .NET Setup for Polyglot Monorepo

This directory contains scripts and templates for setting up and working with .NET projects in the Polyglot monorepo.

## Getting Started

### Prerequisites

- .NET SDK 8.0 or higher
- NX CLI
- Node.js and npm

### Setup

Run the setup script to configure your development environment:

```
npm run dotnet:setup
```

This script will:

1. Check for the required .NET SDK version
2. Install necessary .NET global tools
3. Ensure the NX .NET plugin is installed
4. Set up the template directory structure if needed

### Creating a New .NET Project

Create .NET projects using Nx generators directly:

```bash
# .NET application
npx nx generate @nx/dotnet:app my-api --directory=apps

# .NET library
npx nx generate @nx/dotnet:lib my-lib --directory=libs
```

Projects are automatically tagged when you run any nx command.

## Project Structure

.NET projects created with Nx generators automatically include:

- Complete project structure with proper directory layout
- Nx configuration (`project.json`) with build, test, lint targets
- Standard .NET project files and configurations
- Integration with monorepo tooling and workflows

## Working with .NET Projects in NX

Once you've created your .NET projects, you can use NX commands to build, test, and run them:

```
npx nx build <project-name>
npx nx test <project-name>
npx nx lint <project-name>
npx nx serve <project-name>  # For application projects
```

You can also run commands on all .NET projects:

```
npm run nx:dotnet-build
npm run nx:dotnet-test
npm run nx:dotnet-lint
npm run nx:dotnet-dev
```

## Best Practices

1. Always tag your .NET projects with `dotnet` in the project.json file
2. Follow the standard .NET coding conventions
3. Use the Directory.Build.props file for shared settings
4. Write unit tests for all functionality
5. Use the NX cache to speed up builds

## Troubleshooting

### Common Issues

1. **Wrong .NET SDK version**: Ensure you have the correct .NET SDK version specified in global.json
2. **Missing NX plugin**: Run `npm run dotnet:setup` to install the required NX plugin
3. **Build errors**: Check the project structure and ensure all dependencies are correctly referenced

### Repairing NX Configuration

If you encounter issues with NX configuration:

```
npm run nx:reset
```

## Additional Resources

- [NX Documentation](https://nx.dev/docs)
- [.NET Documentation](https://docs.microsoft.com/en-us/dotnet/)
- [@nx/dotnet Plugin](https://nx.dev/nx-api/dotnet)
