#!/usr/bin/env node

/**
 * Unified Hooks Setup Script
 *
 * This script sets up Git hooks for the monorepo and handles language-specific setup:
 *
 * 1. Sets up Husky git hooks
 * 2. Configures language-specific environments as needed (Python, Node.js, .NET, etc.)
 * 3. Creates pre-commit hooks that selectively activate language tools based on staged files
 */

const path = require("path");
const fs = require("fs");
const { spawnSync, execSync } = require("child_process");
const os = require("os");

// Determine OS
const isWindows = os.platform() === "win32";
const isMacOS = os.platform() === "darwin";
const isLinux = os.platform() === "linux";

// Define paths
const rootDir = process.cwd();
const toolsDir = path.join(rootDir, "tools");
const pythonToolsDir = path.join(toolsDir, "python");
const scriptsDir = path.join(pythonToolsDir, "scripts");
const huskyDir = path.join(rootDir, ".husky");
const venvPath = path.join(rootDir, ".venv");
const venvBinDir = isWindows ? path.join(venvPath, "Scripts") : path.join(venvPath, "bin");

// Logging helper
function log(message, isError = false) {
  if (isError) {
    console.error(`[ERROR] ${message}`);
  } else {
    console.log(`[INFO] ${message}`);
  }
}

// Execute command helper
function execute(cmd, args = [], options = {}) {
  log(`Executing: ${cmd} ${args.join(" ")}`);

  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: true,
    cwd: options.cwd || process.cwd(),
    ...options,
  });

  return {
    status: result.status,
    success: result.status === 0,
    error: result.error,
  };
}

// Check if Python is installed
function isPythonInstalled() {
  log("Checking if Python is installed...");

  try {
    if (isWindows) {
      const whereResult = spawnSync("where", ["python"], { shell: true });
      if (whereResult.status === 0 && whereResult.stdout.toString().trim().length > 0) {
        return true;
      }

      const versionResult = spawnSync("python", ["--version"], { shell: true });
      if (versionResult.status === 0) {
        return true;
      }

      const pyResult = spawnSync("py", ["--version"], { shell: true });
      if (pyResult.status === 0) {
        return true;
      }
    } else {
      const py3Result = spawnSync("python3", ["--version"], { shell: true });
      if (py3Result.status === 0) {
        return true;
      }

      const pyResult = spawnSync("python", ["--version"], { shell: true });
      if (pyResult.status === 0) {
        return true;
      }
    }

    return false;
  } catch (error) {
    log(`Error checking Python: ${error.message}`, true);
    return false;
  }
}

// Setup Python environment for hooks
function setupPythonEnvironment() {
  log("Setting up Python environment for hooks...");

  // Check Python
  if (!isPythonInstalled()) {
    log("Python is not installed. Running Python installation...", true);
    const pythonInstallScript = path.join(
      scriptsDir,
      isWindows ? "check-python-ondemand.bat" : "check-python-ondemand.sh",
    );
    const result = execute(isWindows ? pythonInstallScript : "bash", isWindows ? [] : [pythonInstallScript]);

    if (!result.success) {
      log("Failed to verify or install Python. Hooks setup will continue but Python linting may not work.", true);
      return false;
    }
  }

  log("Python is installed. Setting up virtual environment...");

  // Create virtual environment if it doesn't exist
  if (!fs.existsSync(venvPath)) {
    log("Creating Python virtual environment...");
    const pythonCmd = isWindows ? "python" : "python3";
    const venvResult = execute(pythonCmd, ["-m", "venv", venvPath]);

    if (!venvResult.success) {
      log(
        "Failed to create Python virtual environment. Hooks setup will continue but Python linting may not work.",
        true,
      );
      return false;
    }
  }

  // Install Python formatting tools
  log("Installing Python formatting tools...");
  const pipCmd = path.join(venvBinDir, isWindows ? "pip.exe" : "pip");
  const formatRequirements = path.join(pythonToolsDir, "format-requirements.txt");

  if (fs.existsSync(formatRequirements)) {
    const pipResult = execute(isWindows ? path.join(venvBinDir, "python.exe") : path.join(venvBinDir, "python"), [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "pip",
      "-r",
      formatRequirements,
    ]);

    if (!pipResult.success) {
      log(
        "Failed to install Python formatting tools. Hooks setup will continue but Python linting may not work.",
        true,
      );
      return false;
    }
  } else {
    log(`Python format requirements file not found: ${formatRequirements}`, true);
    return false;
  }

  // Create environment variable script
  log("Creating Python environment script for hooks...");
  const envScriptPath = path.join(scriptsDir, "set-hook-env.bat");

  try {
    fs.writeFileSync(envScriptPath, `@echo off\nset PYTHON_ENV=${path.join(venvPath, "Scripts")}\n`);
    log(`Created environment script at ${envScriptPath}`);
  } catch (error) {
    log(`Failed to create environment script: ${error.message}`, true);
    return false;
  }

  return true;
}

// Setup Node.js environment for hooks
function setupNodeEnvironment() {
  log("Setting up Node.js environment for hooks...");

  // Check if ESLint and Prettier are installed
  try {
    // We're already running in Node.js, so this should be fine
    log("Verifying Node.js dependencies...");

    // Install husky if needed
    execute("npm", ["run", "prepare"]);

    return true;
  } catch (error) {
    log(`Error setting up Node.js environment: ${error.message}`, true);
    return false;
  }
}

// Setup .NET environment for hooks
function setupDotNetEnvironment() {
  log("Setting up .NET environment for hooks...");

  // Check if .NET is installed
  const dotnetResult = spawnSync("dotnet", ["--version"], { shell: true });

  if (dotnetResult.status === 0) {
    log(".NET is installed. No additional setup needed for hooks.");
    return true;
  } else {
    log(".NET is not installed or not in PATH. .NET formatting in hooks may not work.", true);
    return false;
  }
}

// Create selective pre-commit hook
function createPreCommitHook() {
  log("Creating pre-commit hook...");

  const preCommitPath = path.join(huskyDir, "pre-commit");

  try {
    // Create a pre-commit hook using our unified hooks system
    const preCommitContent = `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run our unified hooks system for pre-commit
node tools/hooks/hooks-runner.js pre-commit
`;

    fs.writeFileSync(preCommitPath, preCommitContent);

    // Make the pre-commit hook executable on Unix
    if (!isWindows) {
      execute("chmod", ["+x", preCommitPath]);
    }

    log(`Created pre-commit hook at ${preCommitPath}`);

    // Create post-merge hook
    log("Creating post-merge hook...");
    const postMergePath = path.join(huskyDir, "post-merge");
    const postMergeContent = `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run our unified hooks system for post-merge
node tools/hooks/hooks-runner.js post-merge
`;
    fs.writeFileSync(postMergePath, postMergeContent);

    // Make the post-merge hook executable on Unix
    if (!isWindows) {
      execute("chmod", ["+x", postMergePath]);
    }

    log(`Created post-merge hook at ${postMergePath}`);

    // Create pre-push hook
    log("Creating pre-push hook...");
    const prePushPath = path.join(huskyDir, "pre-push");
    const prePushContent = `#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run our unified hooks system for pre-push
node tools/hooks/hooks-runner.js pre-push
`;
    fs.writeFileSync(prePushPath, prePushContent);

    // Make the pre-push hook executable on Unix
    if (!isWindows) {
      execute("chmod", ["+x", prePushPath]);
    }

    log(`Created pre-push hook at ${prePushPath}`);

    return true;
  } catch (error) {
    log(`Failed to create hooks: ${error.message}`, true);
    return false;
  }
}

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    node: true, // Node is always required
    python: false,
    dotnet: false,
    all: false,
  };

  if (args.includes("--all")) {
    options.all = true;
    options.python = true;
    options.dotnet = true;
  }

  if (args.includes("--python")) {
    options.python = true;
  }

  if (args.includes("--dotnet")) {
    options.dotnet = true;
  }

  return options;
}

// Main function
async function main() {
  const options = parseArguments();

  log("Setting up unified hooks system...");
  if (options.all) {
    log("Setting up all language environments (Node.js, Python, .NET)");
  } else {
    log(`Setting up environments: Node.js${options.python ? ", Python" : ""}${options.dotnet ? ", .NET" : ""}`);
  }

  // First setup Husky
  log("Setting up Husky...");
  const huskyResult = execute("npm", ["run", "prepare"]);

  if (!huskyResult.success) {
    log("Failed to set up Husky. Aborting hooks setup.", true);
    process.exit(1);
  }

  // Setup language environments
  setupNodeEnvironment(); // Always setup Node.js

  if (options.python) {
    setupPythonEnvironment();
  }

  if (options.dotnet) {
    setupDotNetEnvironment();
  }

  // Create hooks
  createPreCommitHook();

  log("Unified hooks system setup completed successfully!");
}

// Run the script
main().catch((error) => {
  log(`Unhandled error: ${error.message}`, true);
  process.exit(1);
});
