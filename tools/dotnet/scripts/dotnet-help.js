/**
 * .NET Help Script
 *
 * This script displays help information for .NET-related commands in the monorepo.
 */

const packageJson = require("../../../package.json");

function printHeader(text) {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

function main() {
  console.log("\n.NET Development Commands for Polyglot Monorepo");
  console.log("-------------------------------------------------");

  printHeader("Environment Setup:");
  console.log(
    "  npm run dotnet:setup         - Setup .NET development environment (includes tools)",
  );
  console.log(
    "  npm run dotnet:setup -- --skip-tools  - Setup .NET without installing tools",
  );
  console.log("  npm run dotnet:help          - Show this help message");

  printHeader("Package Management:");
  console.log(
    "  npm run dotnet:install-packages   - Install packages for all .NET projects",
  );
  console.log(
    "  npm run dotnet:install-package    - Install a package to a specific project",
  );

  printHeader("Project Creation:");
  console.log("  Use Nx generators directly:");
  console.log("    npx nx generate @nx/dotnet:app my-api --directory=apps");
  console.log("    npx nx generate @nx/dotnet:lib my-lib --directory=libs");
  console.log("\n  Projects are auto-tagged when you run any nx: command");

  printHeader("NX Commands:");
  console.log("  npm run nx:dotnet-dev        - Run all .NET projects");
  console.log("  npm run nx:dotnet-format     - Format all .NET projects");
  console.log("  npm run nx:dotnet-lint       - Lint all .NET projects");
  console.log(
    "  npm run nx:dotnet-test       - Run tests for all .NET projects",
  );
  console.log("  npm run nx:dotnet-build      - Build all .NET projects");

  printHeader("Available .NET Tools:");
  console.log("  dotnet format               - Format .NET code");
  console.log(
    "  dotnet outdated             - Check for outdated NuGet packages",
  );
  console.log("  csharpier                   - Alternative C# code formatter");
  console.log("  dotnet roslynator           - Run Roslyn-based analyzers");
  console.log("  dotnet coverage             - Generate code coverage reports");
  console.log("  cleanup                     - Clean up project files");
  console.log("  docs                        - Generate documentation");
}

// Run the script
main();
