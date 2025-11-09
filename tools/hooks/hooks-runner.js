#!/usr/bin/env node

/**
 * Hooks Runner
 *
 * This script centralizes hook execution across different languages and frameworks.
 * It determines which languages/frameworks are affected by changes and runs appropriate checks.
 */

const path = require("path");
const { execSync } = require("child_process");
const fs = require("fs");

// Get command line arguments
const hookType = process.argv[2]; // e.g., pre-commit, pre-push, etc.

if (!hookType) {
  console.error(
    "Error: Hook type not specified. Usage: node hooks-runner.js <hook-type>",
  );
  process.exit(1);
}

// Helper function to check if files of a certain type are staged
function hasStagedFilesOfType(patterns) {
  try {
    // Get list of staged files
    const stagedFiles = execSync(
      "git diff --cached --name-only --diff-filter=ACM",
      {
        encoding: "utf8",
      },
    )
      .trim()
      .split("\n")
      .filter((file) => file.trim() !== "");

    if (stagedFiles.length === 0) return false;

    // Check if any staged file matches the patterns
    return stagedFiles.some((file) => {
      return patterns.some((pattern) => {
        if (typeof pattern === "string") {
          return file.endsWith(pattern);
        } else if (pattern instanceof RegExp) {
          return pattern.test(file);
        }
        return false;
      });
    });
  } catch (error) {
    console.error("Error checking staged files:", error.message);
    return false;
  }
}

// Detect languages/frameworks from staged files
const hasPythonFiles = hasStagedFilesOfType([
  ".py",
  ".pyx",
  ".pxd",
  ".pxi",
  ".pyi",
  ".ipynb",
]);
const hasJsFiles = hasStagedFilesOfType([".js", ".jsx", ".ts", ".tsx"]);
const hasCSharpFiles = hasStagedFilesOfType([
  ".cs",
  ".vb",
  ".csproj",
  ".fsproj",
  ".sqlproj",
]);
const hasSqlFiles = hasStagedFilesOfType([".sql"]);
const hasYamlFiles = hasStagedFilesOfType([".yml", ".yaml"]);
const hasXmlFiles = hasStagedFilesOfType([".xml", ".csproj", ".sqlproj"]);
const hasJsonFiles = hasStagedFilesOfType([".json"]);
const hasMarkdownFiles = hasStagedFilesOfType([".md"]);

// Execute hook based on detected languages
async function executeHook() {
  console.log(`Executing ${hookType} hook...`);

  try {
    // Handle different hook types
    if (hookType === "pre-commit") {
      // Set up Python environment if needed
      if (hasPythonFiles) {
        console.log("Python files detected, setting up Python environment...");

        // Set up Python environment (different for Windows vs Unix)
        if (process.platform === "win32") {
          const pythonEnvPath = path.join(process.cwd(), ".venv", "Scripts");
          process.env.PYTHON_ENV = pythonEnvPath;

          if (
            fs.existsSync(
              path.join(
                process.cwd(),
                "tools",
                "python",
                "scripts",
                "set-hook-env.bat",
              ),
            )
          ) {
            execSync("call tools\\python\\scripts\\set-hook-env.bat", {
              stdio: "inherit",
              shell: true,
            });
          }
        } else {
          const pythonEnvPath = path.join(process.cwd(), ".venv", "bin");
          process.env.PYTHON_ENV = pythonEnvPath;

          if (
            fs.existsSync(
              path.join(
                process.cwd(),
                "tools",
                "python",
                "scripts",
                "set-hook-env.sh",
              ),
            )
          ) {
            execSync("source tools/python/scripts/set-hook-env.sh", {
              stdio: "inherit",
              shell: true,
            });
          }
        }
      } else {
        // Set a default PYTHON_ENV to prevent lint-staged errors
        process.env.PYTHON_ENV = path.join(
          process.cwd(),
          ".venv",
          process.platform === "win32" ? "Scripts" : "bin",
        );
      }

      // Run lint-staged for all file types
      console.log("Running lint-staged...");
      execSync("npx lint-staged", { stdio: "inherit" });
    } else if (hookType === "post-merge") {
      // Check for changes in dependency files and install if needed
      console.log("Checking for dependency changes...");

      const hasChangedFiles = (patterns) => {
        try {
          const changedFiles = execSync(
            "git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD",
            { encoding: "utf8" },
          )
            .trim()
            .split("\n");

          return changedFiles.some((file) =>
            patterns.some((pattern) =>
              typeof pattern === "string"
                ? file.endsWith(pattern)
                : pattern.test(file),
            ),
          );
        } catch (error) {
          console.error("Error checking changed files:", error.message);
          return false;
        }
      };

      // Check for package changes
      if (hasChangedFiles(["package.json", "package-lock.json", "yarn.lock"])) {
        console.log("JavaScript dependencies changed, installing packages...");
        execSync("npm install", { stdio: "inherit" });
      }

      // Check for Python dependency changes
      if (hasChangedFiles(["requirements.txt", /requirements.*\.txt$/])) {
        console.log("Python dependencies changed, installing packages...");
        execSync("npm run py:install-packages", { stdio: "inherit" });
      }

      // Check for .NET dependency changes
      if (hasChangedFiles([".csproj", ".fsproj", ".vbproj"])) {
        console.log(".NET dependencies changed, restoring packages...");
        execSync("dotnet restore", { stdio: "inherit" });
      }
    } else if (hookType === "pre-push") {
      console.log("Running tests before pushing...");

      // Determine which types of tests to run based on the staged files
      if (hasJsFiles) {
        console.log("Running JavaScript tests...");
        try {
          execSync("npx nx affected --target=test", { stdio: "inherit" });
        } catch (error) {
          console.error("JavaScript tests failed:", error.message);
          process.exit(1);
        }
      }

      if (hasPythonFiles) {
        console.log("Running Python tests...");
        try {
          execSync("npm run nx:python-test", { stdio: "inherit" });
        } catch (error) {
          console.error("Python tests failed:", error.message);
          process.exit(1);
        }
      }

      if (hasCSharpFiles) {
        console.log("Running .NET tests...");
        try {
          execSync("dotnet test", { stdio: "inherit" });
        } catch (error) {
          console.error(".NET tests failed:", error.message);
          process.exit(1);
        }
      }
    }

    console.log(`${hookType} hook completed successfully`);
  } catch (error) {
    console.error(`Error in ${hookType} hook:`, error.message);
    process.exit(1);
  }
}

// Execute the hook
executeHook();
