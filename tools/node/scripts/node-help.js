/**
 * Node.js Help Script
 *
 * This script displays help information for Node.js-related commands in the monorepo.
 */

// We don't need to use packageJson for now
// const packageJson = require('../../../package.json');

function printHeader(text) {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

function main() {
  console.log("\nNode.js Development Commands for Polyglot Monorepo");
  console.log("--------------------------------------------------");

  printHeader("Environment Setup:");
  console.log("  npm run node:check-version   - Check if the correct Node.js version is being used");
  console.log("  npm run nx:tag-projects      - Auto-tag all projects based on executors");
  console.log("  npm run node:help            - Show this help message");

  printHeader("Project Creation:");
  console.log("  Use Nx generators directly:");
  console.log("    npx nx generate @nx/node:app my-app --directory=apps");
  console.log("    npx nx generate @nx/node:lib my-lib --directory=libs");
  console.log("    npx nx generate @nx/express:app my-api --directory=apps");
  console.log("    npx nx generate @nx/next:app my-web-app --directory=apps");
  console.log("\n  Projects are auto-tagged when you run any nx: command");

  printHeader("Development Commands:");
  console.log("  npm run nx:node-dev             - Run all Node.js projects");
  console.log("  npm run nx:node-build           - Build all Node.js projects");
  console.log("  npm run nx:node-test            - Run tests for all Node.js projects");
  console.log("  npm run nx:node-lint            - Lint all Node.js projects");
  console.log("  npm run nx:node-format          - Format all Node.js projects");

  printHeader("Configuration Management:");
  console.log("  npm run node:apply-configs   - Apply centralized configurations to a Node.js project");
  console.log("                                 Usage: npm run node:apply-configs <project-directory>");

  printHeader("Advanced Commands:");
  console.log("  npm run nx g @nx/node:...    - Generate Node.js components using NX generators");
  console.log("  npm run nx g @nx/express:... - Generate Express.js components using NX generators");
  console.log("  npm run nx g @nx/next:...    - Generate Next.js components using NX generators");

  printHeader("Centralized Configurations:");
  console.log("  All Node.js projects use standardized configurations for:");
  console.log("  - ESLint: For code linting");
  console.log("  - Prettier: For code formatting");
  console.log("  - TypeScript: For type checking and compilation");
  console.log("  - Jest: For testing");
  console.log("\n  These configurations are automatically applied to new projects");
  console.log("  and can be manually applied to existing projects with:");
  console.log("  npm run node:apply-configs <project-directory>");
}

// Run the script
main();
