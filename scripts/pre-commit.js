#!/usr/bin/env node

/**
 * Pre-Commit Quick Checks Script
 *
 * Fast validation before commit (format + lint + type check only).
 * Runs on affected projects to catch most issues in ~5-15 seconds.
 *
 * Intelligently detects:
 * - On feature branches: runs affected checks only
 * - On base branches (main/dev/test): runs all checks
 *
 * Usage:
 *   Called automatically by .husky/pre-commit git hook
 *   Or manually: node scripts/pre-commit.js
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step) {
  log(`\n${"=".repeat(80)}`, "cyan");
  log(`  ${step}`, "bright");
  log("=".repeat(80), "cyan");
}

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logError(message) {
  log(`✗ ${message}`, "red");
}

function logWarning(message) {
  log(`⚠ ${message}`, "yellow");
}

function run(command, options = {}) {
  try {
    const result = execSync(command, {
      cwd: path.resolve(__dirname, ".."),
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf-8",
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error, output: error.stdout || error.stderr };
  }
}

// Check if there are affected Python projects
function hasPythonProjectsAffected(isAffected, base) {
  try {
    if (!isAffected || !base) {
      // On base branch, check if any Python projects exist
      const result = run("npx nx show projects --projects=tag:python", {
        silent: true,
      });
      return result.success && result.output && result.output.trim().length > 0;
    }

    // On feature branch, check for affected Python projects
    const result = run(
      `npx nx show projects --affected --base=${base} --head=HEAD --projects=tag:python`,
      { silent: true },
    );
    return result.success && result.output && result.output.trim().length > 0;
  } catch (error) {
    // If we can't determine, assume there might be Python projects
    return true;
  }
}

// Check if there are affected .NET projects
function hasDotNetProjectsAffected(isAffected, base) {
  try {
    if (!isAffected || !base) {
      // On base branch, check if any .NET projects exist
      const result = run("npx nx show projects --projects=tag:dotnet", {
        silent: true,
      });
      return result.success && result.output && result.output.trim().length > 0;
    }

    // On feature branch, check for affected .NET projects
    const result = run(
      `npx nx show projects --affected --base=${base} --head=HEAD --projects=tag:dotnet`,
      { silent: true },
    );
    return result.success && result.output && result.output.trim().length > 0;
  } catch (error) {
    // If we can't determine, assume there might be .NET projects
    return true;
  }
}

// Setup Python virtual environment if needed
function setupPythonEnvironment() {
  const rootDir = path.resolve(__dirname, "..");
  const venvPath = path.join(rootDir, ".venv");
  const isWindows = process.platform === "win32";
  const pythonBinPath = path.join(venvPath, isWindows ? "Scripts" : "bin");
  const pythonExecutable = path.join(
    pythonBinPath,
    isWindows ? "python.exe" : "python",
  );

  // Check if virtual environment already exists and is valid
  if (fs.existsSync(venvPath) && fs.existsSync(pythonExecutable)) {
    // Already set up - just set the env var
    process.env.PYTHON_ENV = pythonBinPath;
    return true;
  }

  // Virtual environment doesn't exist - create it
  log("Python virtual environment not found. Creating it now...", "yellow");

  try {
    // Try to create virtual environment
    if (isWindows) {
      run("call py-env.bat create", { silent: false });
    } else {
      run("bash py-env.sh create", { silent: false });
    }

    if (!fs.existsSync(pythonExecutable)) {
      logError(
        "Failed to create Python virtual environment. Python checks may fail.",
      );
      return false;
    }

    logSuccess("Python virtual environment created successfully");

    // Set PYTHON_ENV environment variable for the process
    process.env.PYTHON_ENV = pythonBinPath;

    return true;
  } catch (error) {
    logError(`Failed to create Python virtual environment: ${error.message}`);
    logWarning("Run 'npm run py:setup' manually to set up Python environment");
    return false;
  }
}

// Detect current branch and determine validation mode
function detectValidationMode() {
  try {
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      cwd: path.resolve(__dirname, ".."),
    }).trim();

    log(`Current branch: ${currentBranch}`, "cyan");

    // If on base branches (main/dev/test), run ALL checks
    if (["main", "dev", "test"].includes(currentBranch)) {
      log("On base branch - checking ALL projects", "yellow");
      return { isAffected: false, base: null, currentBranch };
    }

    // On feature branch - run AFFECTED checks
    log("On feature branch - checking AFFECTED projects only", "yellow");

    // Try to find the upstream tracking branch
    let base = null;
    try {
      const upstream = execSync(
        "git rev-parse --abbrev-ref --symbolic-full-name @{u}",
        {
          encoding: "utf8",
          cwd: path.resolve(__dirname, ".."),
        },
      ).trim();

      if (upstream && upstream !== "@{u}") {
        base = upstream;
        log(`Comparing against upstream: ${base}`, "cyan");
        return { isAffected: true, base, currentBranch };
      }
    } catch (e) {
      // No upstream set, fall back to common bases
    }

    // Fall back to detecting which main branch exists
    const branches = execSync("git branch -r", {
      encoding: "utf8",
      cwd: path.resolve(__dirname, ".."),
    });

    if (branches.includes("origin/dev")) {
      base = "origin/dev";
    } else if (branches.includes("origin/test")) {
      base = "origin/test";
    } else if (branches.includes("origin/main")) {
      base = "origin/main";
    } else {
      base = "origin/main";
    }

    log(`Comparing against: ${base}`, "cyan");
    return { isAffected: true, base, currentBranch };
  } catch (error) {
    logWarning("Could not detect branch, defaulting to full checks");
    return { isAffected: false, base: null, currentBranch: "unknown" };
  }
}

function checkNodeProjects(isAffected, base) {
  logStep("Quick Check: Node.js/TypeScript");

  const affectedFlag = isAffected && base ? `--base=${base} --head=HEAD` : "";

  // 1. Format check (MUST PASS to continue)
  log("\n1. Checking code formatting...", "blue");
  const formatCmd =
    isAffected && base
      ? `npx nx format:check --base=${base} --head=HEAD`
      : `npm run nx:workspace-format-check`;

  const formatResult = run(formatCmd);
  if (!formatResult.success) {
    logError('Formatting failed - run "npm run nx:workspace-format" to fix');
    return false; // Exit early
  }
  logSuccess("Formatting passed");

  // 2. Lint (MUST PASS to continue)
  log("\n2. Linting code...", "blue");
  const lintCmd =
    isAffected && base
      ? `npx nx affected --base=${base} --head=HEAD --target=lint --projects=tag:node`
      : `npm run nx:node-lint`;

  const lintResult = run(lintCmd);
  if (!lintResult.success) {
    logError("Linting failed");
    return false; // Exit early
  }
  logSuccess("Linting passed");

  // 3. Type check (MUST PASS to continue)
  log("\n3. Type checking...", "blue");
  const typeCmd =
    isAffected && base
      ? `npx nx affected --base=${base} --head=HEAD --target=type-check --projects=tag:node`
      : `npm run nx:node-type-check`;

  const typeResult = run(typeCmd);
  if (!typeResult.success) {
    logError("Type checking failed");
    return false; // Exit early
  }
  logSuccess("Type checking passed");

  return true; // All checks passed
}

function checkPythonProjects(isAffected, base) {
  logStep("Quick Check: Python");

  // Check if Python environment is set up
  const venvCheck = run("py-env.bat check", { silent: true });
  if (!venvCheck.success) {
    logWarning("Python environment not set up - skipping Python checks");
    logWarning('Run "py-env.bat create" to set up Python environment');
    return true; // Don't fail if Python isn't set up
  }

  const affectedFlag = isAffected && base ? `--base=${base} --head=HEAD` : "";

  // 1. Format check (MUST PASS to continue)
  log("\n1. Checking code formatting (Black)...", "blue");
  const formatCmd =
    isAffected && base
      ? `npx nx affected --base=${base} --head=HEAD --target=format-check --projects=tag:python`
      : `npm run nx:python-format-check`;

  const formatResult = run(formatCmd);
  if (!formatResult.success) {
    logError('Formatting failed - run "npm run nx:python-format" to fix');
    return false; // Exit early
  }
  logSuccess("Formatting passed");

  // 2. Lint (Flake8) (MUST PASS to continue)
  log("\n2. Linting code (Flake8)...", "blue");
  const lintCmd =
    isAffected && base
      ? `npx nx affected --base=${base} --head=HEAD --target=lint --projects=tag:python`
      : `npm run nx:python-lint`;

  const lintResult = run(lintCmd);
  if (!lintResult.success) {
    logError("Linting failed");
    return false; // Exit early
  }
  logSuccess("Linting passed");

  // 3. Type check (mypy) (MUST PASS to continue)
  log("\n3. Type checking (mypy)...", "blue");
  const typeCmd =
    isAffected && base
      ? `npx nx affected --base=${base} --head=HEAD --target=type-check --projects=tag:python`
      : `npm run nx:python-type-check`;

  const typeResult = run(typeCmd);
  if (!typeResult.success) {
    logError("Type checking failed");
    return false; // Exit early
  }
  logSuccess("Type checking passed");

  return true; // All checks passed
}

function checkDotNetProjects(isAffected, base) {
  logStep("Quick Check: .NET");

  // Check if .NET SDK is available
  const dotnetCheck = run("dotnet --version", { silent: true });
  if (!dotnetCheck.success) {
    logWarning(".NET SDK not found - skipping .NET checks");
    logWarning("Install .NET SDK 8.0 or higher");
    return true; // Don't fail if .NET isn't installed
  }

  const affectedFlag = isAffected && base ? `--base=${base} --head=HEAD` : "";

  // 0. Restore packages to catch version issues early (NU1604, transitive deps)
  log("\n0. Restoring NuGet packages...", "blue");
  const restoreResult = run("dotnet restore", { silent: true });
  if (!restoreResult.success) {
    logError("Package restore failed - check for package version conflicts");
    return false; // Exit early
  }
  logSuccess("Package restore completed");

  // 1. Format check (MUST PASS to continue)
  log("\n1. Checking code formatting (dotnet format)...", "blue");
  const formatCmd =
    isAffected && base
      ? `npx nx affected --base=${base} --head=HEAD --target=format-check --projects=tag:dotnet`
      : `npm run nx:dotnet-format-check`;

  const formatResult = run(formatCmd);
  if (!formatResult.success) {
    logError('Formatting failed - run "npm run nx:dotnet-format" to fix');
    return false; // Exit early
  }
  logSuccess("Formatting passed");

  // 2. Lint (StyleCop) (MUST PASS to continue)
  log("\n2. Linting code (StyleCop)...", "blue");
  const lintCmd =
    isAffected && base
      ? `npx nx affected --base=${base} --head=HEAD --target=lint --projects=tag:dotnet`
      : `npm run nx:dotnet-lint`;

  const lintResult = run(lintCmd);
  if (!lintResult.success) {
    logError("Linting failed");
    return false; // Exit early
  }
  logSuccess("Linting passed");

  return true; // All checks passed
}

// Check if infrastructure files (Kustomize) have changed
function hasInfraFilesChanged() {
  try {
    // Check if any infra/k8s files are staged
    const result = run("git diff --cached --name-only", { silent: true });
    if (result.success && result.output) {
      const changedFiles = result.output.split("\n").filter(Boolean);
      return changedFiles.some(
        (file) =>
          file.startsWith("infra/k8s/") &&
          (file.endsWith(".yaml") || file.endsWith(".yml")),
      );
    }
    return false;
  } catch (error) {
    // If we can't determine, assume true to be safe
    return true;
  }
}

// Validate infrastructure (Kustomize) files
function checkInfrastructure() {
  if (!hasInfraFilesChanged()) {
    log(
      "\nℹ No infrastructure files changed - skipping Kustomize validation",
      "cyan",
    );
    return true;
  }

  logStep("Validating Infrastructure (Kustomize)");

  // Check if Kustomize is installed
  const kustomizeCheck = run("kustomize version", { silent: true });
  if (!kustomizeCheck.success) {
    logWarning("Kustomize not installed - skipping validation");
    logWarning("Install: npm run infra:setup");
    logWarning(
      "Or install manually: https://kubectl.docs.kubernetes.io/installation/kustomize/",
    );
    return true; // Don't fail if Kustomize not installed (optional tool)
  }

  log("\n🏗️  Validating Kustomize manifests...", "blue");

  const result = run("npm run infra:validate");
  if (!result.success) {
    logError("Kustomize validation failed");
    logError("Fix the errors above or run: npm run infra:validate");
    return false;
  }

  logSuccess("Kustomize validation passed");
  return true;
}

function main() {
  log("\n⚡ Pre-Commit Quick Checks", "bright");
  log("=".repeat(80), "cyan");
  log(
    "Running: Format + Lint + Type Check (fast, no tests/builds)\n",
    "yellow",
  );

  // Early exit if no projects exist (empty workspace)
  const projectCheck = run("npx nx show projects", { silent: true });
  if (!projectCheck.output || projectCheck.output.trim().length === 0) {
    log("\nℹ No projects in workspace - skipping all checks", "cyan");
    logSuccess("\n✅ Commit allowed (empty workspace)\n");
    process.exit(0);
  }

  // Check if --skip-reset flag is present
  const skipReset = process.argv.includes("--skip-reset");

  // Run nx:reset once at the start (unless skipped by git hooks)
  if (!skipReset) {
    logStep("Preparing NX Workspace");
    log("Running nx:reset to ensure clean state...", "cyan");
    const resetResult = run("npm run nx:reset");
    if (!resetResult.success) {
      logWarning("nx:reset had warnings but continuing...");
    } else {
      logSuccess("NX workspace ready");
    }

    // Format any files modified by nx:reset (e.g., .nx/project-graph.json)
    log("Formatting workspace files...", "cyan");
    const formatResetResult = run("npx nx format:write");
    if (!formatResetResult.success) {
      logWarning("Format after reset had warnings but continuing...");
    }

    // Re-stage any staged files that were modified by nx:reset
    log("Re-staging modified files...", "cyan");
    const reStageResult = run("git add --renormalize -u", { silent: true });
    if (reStageResult.success) {
      logSuccess("Modified files re-staged (with line ending normalization)");
    }
  } else {
    log("Skipping nx:reset (running in git hook mode)\n", "cyan");
  }

  const { isAffected, base, currentBranch } = detectValidationMode();

  if (isAffected && base) {
    log(`Mode: Affected projects only (${currentBranch} → ${base})\n`, "cyan");
  } else {
    log(`Mode: All projects (on base branch: ${currentBranch})\n`, "cyan");
  }

  // Setup Python environment only if Python projects are affected
  if (hasPythonProjectsAffected(isAffected, base)) {
    logStep("Environment Setup");
    log("Python projects affected - setting up Python environment...", "cyan");
    const pythonEnvReady = setupPythonEnvironment();
    if (pythonEnvReady) {
      logSuccess("Python environment ready");
    } else {
      logWarning(
        "Python environment setup incomplete - Python checks may fail",
      );
    }
  }

  let allPassed = true;

  // Run checks only for affected language projects
  // Note: Node.js checks always run (includes workspace-level configs, nx tooling)
  const nodeResult = checkNodeProjects(isAffected, base);
  allPassed = allPassed && nodeResult;

  // Only check Python if Python projects are affected
  if (hasPythonProjectsAffected(isAffected, base)) {
    const pythonResult = checkPythonProjects(isAffected, base);
    allPassed = allPassed && pythonResult;
  } else {
    log("\nℹ No Python projects affected - skipping Python checks", "cyan");
  }

  // Only check .NET if .NET projects are affected
  if (hasDotNetProjectsAffected(isAffected, base)) {
    const dotnetResult = checkDotNetProjects(isAffected, base);
    allPassed = allPassed && dotnetResult;
  } else {
    log("\nℹ No .NET projects affected - skipping .NET checks", "cyan");
  }

  // Check infrastructure files (Kustomize) if changed
  const infraResult = checkInfrastructure();
  allPassed = allPassed && infraResult;

  // Final summary
  logStep("Summary");
  if (allPassed) {
    logSuccess("\n✅ Quick checks passed!");
    logSuccess(
      "Commit is allowed. Run 'npm run check' before pushing for full validation.\n",
    );
    process.exit(0);
  } else {
    logError("\n❌ Quick checks failed.");
    logError("Please fix the issues above before committing.\n");
    logError("💡 Tip: Run format commands to auto-fix formatting issues:");
    logError("  - Node: npm run nx:node-format");
    logError("  - Python: npm run nx:python-format");
    logError("  - .NET: npm run nx:dotnet-format\n");
    process.exit(1);
  }
}

main();
