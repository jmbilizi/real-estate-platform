/**
 * Helper script to display usage information for Python-related npm scripts
 */

function showServiceHelp() {
  console.log("\nUsage: npm run py:install-service --service=<service-name>");
  console.log("\nExample:");
  console.log("  npm run py:install-service --service=fastapi-service");
  console.log(
    "\nThis will install all Python requirements and then run the install-deps target for the specified service.",
  );
  console.log("\nAvailable services:");
  console.log('  (Use any service with a tag of "python" in nx.json)');
}

function showGeneralHelp() {
  console.log("\nPython Development Setup Help");
  console.log("\nAvailable commands:");
  console.log(
    "  npm run py:setup-dev         - Create and set up Python virtual environment",
  );
  console.log(
    "  npm run py:create-venv       - Create Python virtual environment",
  );
  console.log(
    "  npm run py:activate          - Activate Python virtual environment",
  );
  console.log(
    "  npm run py:install-dev       - Install Python development dependencies",
  );
  console.log(
    "  npm run py:install-all       - Install all Python dependencies",
  );
  console.log(
    "  npm run py:install-service   - Install dependencies for a specific service",
  );
  console.log(
    "  npm run setup-hooks          - Set up Git hooks for Python code quality",
  );
  console.log("  npm run format-python        - Format Python code with Black");
  console.log(
    "  npm run lint-python          - Lint Python code with Flake8 and MyPy",
  );
  console.log("  npm run check-python         - Format and lint Python code");
  console.log(
    "  npm run nx:python-format     - Format all Python projects with Nx",
  );
  console.log(
    "  npm run nx:python-lint       - Lint all Python projects with Nx",
  );
  console.log(
    "  npm run nx:python-test       - Test all Python projects with Nx",
  );
  console.log(
    "  npm run nx:python-dev        - Start all Python projects in development mode",
  );
}

const helpType = process.argv[2] || "general";

if (helpType === "service-help") {
  showServiceHelp();
} else {
  showGeneralHelp();
}
