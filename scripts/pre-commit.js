#!/usr/bin/env node

/**
 * Pre-Commit Checks Script
 *
 * Intelligently mimics CI/CD behavior locally before committing:
 * - On feature branches: runs affected checks (like PR in CI)
 * - On base branches (main/dev/test): runs all checks (like push in CI)
 *
 * Usage:
 *   npm run pre-commit    # Auto-detects and runs appropriate checks
 */ const { execSync } = require("child_process");
const path = require("path");

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

// Detect current branch and determine validation mode
function detectValidationMode() {
  try {
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      cwd: path.resolve(__dirname, ".."),
    }).trim();

    log(`Current branch: ${currentBranch}`, "cyan");

    // If on base branches (main/dev/test), run ALL checks (like CI does on push)
    if (["main", "dev", "test"].includes(currentBranch)) {
      log(
        "On base branch - running ALL checks (mimics CI push behavior)",
        "yellow",
      );
      return { isAffected: false, base: null, currentBranch };
    }

    // On feature branch - run AFFECTED checks (like CI does on PR)
    log(
      "On feature branch - running AFFECTED checks (mimics CI PR behavior)",
      "yellow",
    );

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
        // Extract the remote base (e.g., origin/dev from origin/dev)
        const parts = upstream.split("/");
        if (parts.length >= 2) {
          base = upstream;
          log(`Comparing against upstream: ${base}`, "cyan");
          return { isAffected: true, base, currentBranch };
        }
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
      base = "origin/main"; // Ultimate fallback
    }

    log(`Comparing against: ${base}`, "cyan");
    return { isAffected: true, base, currentBranch };
  } catch (error) {
    logWarning("Could not detect branch, defaulting to full validation");
    return { isAffected: false, base: null, currentBranch: "unknown" };
  }
}

function checkNodeProjects(isAffected, base) {
  logStep("Validating Node.js/TypeScript Projects");

  const affectedFlag = isAffected && base ? `--base=${base} --head=HEAD` : "";
  let hasErrors = false;

  // 1. Format check
  log("\n1. Checking code formatting...", "blue");
  const formatCmd =
    isAffected && base
      ? `npx nx format:check ${affectedFlag}`
      : `npx nx format:check --projects=tag:node`;

  const formatResult = run(formatCmd);
  if (formatResult.success) {
    logSuccess("Code formatting passed");
  } else {
    logError('Code formatting failed - run "npm run nx:node-format" to fix');
    hasErrors = true;
  }

  // 2. Lint
  log("\n2. Linting code...", "blue");
  const lintCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=lint`
      : `npm run nx:node-lint`;

  const lintResult = run(lintCmd);
  if (lintResult.success) {
    logSuccess("Linting passed");
  } else {
    logError("Linting failed");
    hasErrors = true;
  }

  // 3. Type check
  log("\n3. Type checking...", "blue");
  const typeCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=type-check`
      : `npm run nx:node-type-check`;

  const typeResult = run(typeCmd);
  if (typeResult.success) {
    logSuccess("Type checking passed");
  } else {
    logError("Type checking failed");
    hasErrors = true;
  }

  // 4. Tests
  log("\n4. Running tests...", "blue");
  const testCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=test`
      : `npm run nx:node-test`;

  const testResult = run(testCmd);
  if (testResult.success) {
    logSuccess("Tests passed");
  } else {
    logError("Tests failed");
    hasErrors = true;
  }

  // 5. Build
  log("\n5. Building projects...", "blue");
  const buildCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=build`
      : `npm run nx:node-build`;

  const buildResult = run(buildCmd);
  if (buildResult.success) {
    logSuccess("Build passed");
  } else {
    logError("Build failed");
    hasErrors = true;
  }

  return !hasErrors;
}

function checkPythonProjects(isAffected, base) {
  logStep("Validating Python Projects");

  // Check if Python environment is set up
  const venvCheck = run("py-env.bat check", { silent: true });
  if (!venvCheck.success) {
    logWarning("Python environment not set up - skipping Python checks");
    logWarning('Run "py-env.bat create" to set up Python environment');
    return true; // Don't fail if Python isn't set up
  }

  const affectedFlag = isAffected && base ? `--base=${base} --head=HEAD` : "";
  let hasErrors = false;

  // 1. Format check
  log("\n1. Checking code formatting (Black)...", "blue");
  const formatCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=format-check`
      : `npm run nx:python-format-check`;

  const formatResult = run(formatCmd);
  if (formatResult.success) {
    logSuccess("Code formatting passed");
  } else {
    logError('Code formatting failed - run "npm run nx:python-format" to fix');
    hasErrors = true;
  }

  // 2. Lint (Flake8)
  log("\n2. Linting code (Flake8)...", "blue");
  const lintCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=lint`
      : `npm run nx:python-lint`;

  const lintResult = run(lintCmd);
  if (lintResult.success) {
    logSuccess("Linting passed");
  } else {
    logError("Linting failed");
    hasErrors = true;
  }

  // 3. Type check (mypy)
  log("\n3. Type checking (mypy)...", "blue");
  const typeCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=type-check`
      : `npm run nx:python-type-check`;

  const typeResult = run(typeCmd);
  if (typeResult.success) {
    logSuccess("Type checking passed");
  } else {
    logError("Type checking failed");
    hasErrors = true;
  }

  // 4. Tests (pytest)
  log("\n4. Running tests (pytest)...", "blue");
  const testCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=test`
      : `npm run nx:python-test`;

  const testResult = run(testCmd);
  if (testResult.success) {
    logSuccess("Tests passed");
  } else {
    logError("Tests failed");
    hasErrors = true;
  }

  return !hasErrors;
}

function checkDotNetProjects(isAffected, base) {
  logStep("Validating .NET Projects");

  // Check if .NET SDK is available
  const dotnetCheck = run("dotnet --version", { silent: true });
  if (!dotnetCheck.success) {
    logWarning(".NET SDK not found - skipping .NET checks");
    logWarning("Install .NET SDK 8.0 or higher");
    return true; // Don't fail if .NET isn't installed
  }

  const affectedFlag = isAffected && base ? `--base=${base} --head=HEAD` : "";
  let hasErrors = false;

  // 1. Format check
  log("\n1. Checking code formatting (dotnet format)...", "blue");
  const formatCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=format-check`
      : `npm run nx:dotnet-format-check`;

  const formatResult = run(formatCmd);
  if (formatResult.success) {
    logSuccess("Code formatting passed");
  } else {
    logError('Code formatting failed - run "npm run nx:dotnet-format" to fix');
    hasErrors = true;
  }

  // 2. Lint (StyleCop via build)
  log("\n2. Linting code (StyleCop)...", "blue");
  const lintCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=lint`
      : `npm run nx:dotnet-lint`;

  const lintResult = run(lintCmd);
  if (lintResult.success) {
    logSuccess("Linting passed");
  } else {
    logError("Linting failed");
    hasErrors = true;
  }

  // 3. Tests
  log("\n3. Running tests (xUnit)...", "blue");
  const testCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=test`
      : `npm run nx:dotnet-test`;

  const testResult = run(testCmd);
  if (testResult.success) {
    logSuccess("Tests passed");
  } else {
    logError("Tests failed");
    hasErrors = true;
  }

  // 4. Build
  log("\n4. Building projects...", "blue");
  const buildCmd =
    isAffected && base
      ? `npx nx affected ${affectedFlag} --target=build`
      : `npm run nx:dotnet-build`;

  const buildResult = run(buildCmd);
  if (buildResult.success) {
    logSuccess("Build passed");
  } else {
    logError("Build failed");
    hasErrors = true;
  }

  return !hasErrors;
}

function main() {
  log("\n✓ Pre-Commit Checks", "bright");
  log("=".repeat(80), "cyan");

  const { isAffected, base, currentBranch } = detectValidationMode();

  if (isAffected && base) {
    log(
      `\n✓ Mode: Affected Only (comparing ${currentBranch} to ${base})`,
      "yellow",
    );
    log("This mimics what CI checks on a Pull Request\n", "yellow");
  } else {
    log(`\n✓ Mode: Full Checks`, "yellow");
    log("This mimics what CI checks on push to base branch\n", "yellow");
  }

  let allPassed = true;

  // Run checks for each language
  const nodeResult = checkNodeProjects(isAffected, base);
  allPassed = allPassed && nodeResult;

  const pythonResult = checkPythonProjects(isAffected, base);
  allPassed = allPassed && pythonResult;

  const dotnetResult = checkDotNetProjects(isAffected, base);
  allPassed = allPassed && dotnetResult;

  // Final summary
  logStep("Summary");
  if (allPassed) {
    logSuccess("\n✅ All checks passed!");
    logSuccess("Your changes are ready to commit and push.\n");
    process.exit(0);
  } else {
    logError("\n❌ Some checks failed.");
    logError("Please fix the issues above before committing.\n");
    process.exit(1);
  }
}

main();
