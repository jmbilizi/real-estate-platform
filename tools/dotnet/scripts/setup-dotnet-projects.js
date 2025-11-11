#!/usr/bin/env node

/**
 * Setup .NET Project Configurations
 *
 * This script automatically creates project.json files for .NET projects
 * to add lint, format, and format-check targets.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Write file preserving original BOM and line endings
 * @param {string} filePath - Path to file
 * @param {string} content - Content to write
 */
function writeFilePreservingEncoding(filePath, content) {
  // Check if file exists to detect original encoding
  let hasBOM = false;
  let lineEnding = "\n";

  if (fs.existsSync(filePath)) {
    const originalBuffer = fs.readFileSync(filePath);
    hasBOM =
      originalBuffer.length >= 3 &&
      originalBuffer[0] === 0xef &&
      originalBuffer[1] === 0xbb &&
      originalBuffer[2] === 0xbf;

    const originalContent = originalBuffer.toString("utf8");
    lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n";
  } else {
    // For new files, detect from content being written
    lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  }

  // Normalize line endings
  if (lineEnding === "\r\n") {
    content = content.replace(/\r?\n/g, "\r\n");
  } else {
    content = content.replace(/\r\n/g, "\n");
  }

  // Write with appropriate BOM
  const outputBuffer = hasBOM
    ? Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(content, "utf8"),
      ])
    : Buffer.from(content, "utf8");

  fs.writeFileSync(filePath, outputBuffer);
}

// Colors for console output
const colors = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Get all .NET projects from Nx
function getDotNetProjects() {
  try {
    const output = execSync("npx nx show projects --json", {
      encoding: "utf8",
    });
    const allProjects = JSON.parse(output);

    // Filter for .NET projects by checking for .csproj files
    return allProjects.filter((projectName) => {
      const projectConfig = getProjectConfig(projectName);
      if (!projectConfig) return false;

      const projectRoot = projectConfig.root;
      const csprojFiles = fs
        .readdirSync(projectRoot)
        .filter((file) => file.endsWith(".csproj"));
      return csprojFiles.length > 0;
    });
  } catch (error) {
    console.error("Error getting .NET projects:", error.message);
    return [];
  }
}

// Get project configuration
function getProjectConfig(projectName) {
  try {
    const output = execSync(`npx nx show project ${projectName} --json`, {
      encoding: "utf8",
    });
    return JSON.parse(output);
  } catch (error) {
    return null;
  }
}

// Create project.json for a .NET project
function createProjectJson(projectName, projectConfig) {
  const projectRoot = projectConfig.root;
  const projectJsonPath = path.join(projectRoot, "project.json");

  // Check if project.json already exists
  if (fs.existsSync(projectJsonPath)) {
    const existingContent = JSON.parse(
      fs.readFileSync(projectJsonPath, "utf8"),
    );

    // Check if it already has lint and format targets
    if (
      existingContent.targets?.lint &&
      existingContent.targets?.format &&
      existingContent.targets?.["format-check"]
    ) {
      log(
        `  ℹ ${projectName}: project.json already has all targets`,
        "yellow",
      );
      return false;
    }

    // Update existing project.json
    existingContent.targets = existingContent.targets || {};
    existingContent.targets.lint = {
      executor: "nx:run-commands",
      options: {
        command: "dotnet format analyzers --verify-no-changes",
        cwd: projectRoot,
      },
    };
    existingContent.targets.format = {
      executor: "nx:run-commands",
      options: {
        command: "dotnet format",
        cwd: projectRoot,
      },
    };
    existingContent.targets["format-check"] = {
      executor: "nx:run-commands",
      options: {
        command: "dotnet format --verify-no-changes",
        cwd: projectRoot,
      },
    };

    // Ensure tags include 'dotnet'
    existingContent.tags = existingContent.tags || [];
    if (!existingContent.tags.includes("dotnet")) {
      existingContent.tags.push("dotnet");
    }

    writeFilePreservingEncoding(
      projectJsonPath,
      JSON.stringify(existingContent, null, 2) + "\n",
    );
    log(`  ✓ ${projectName}: Updated project.json with targets`, "green");
    return true;
  }

  // Create new project.json
  const projectType = projectConfig.projectType || "application";
  const projectJson = {
    name: projectName,
    $schema: "../../node_modules/nx/schemas/project-schema.json",
    sourceRoot: projectRoot,
    projectType: projectType,
    targets: {
      lint: {
        executor: "nx:run-commands",
        options: {
          command: "dotnet format analyzers --verify-no-changes",
          cwd: projectRoot,
        },
      },
      format: {
        executor: "nx:run-commands",
        options: {
          command: "dotnet format",
          cwd: projectRoot,
        },
      },
      "format-check": {
        executor: "nx:run-commands",
        options: {
          command: "dotnet format --verify-no-changes",
          cwd: projectRoot,
        },
      },
    },
    tags: ["dotnet"],
  };

  writeFilePreservingEncoding(
    projectJsonPath,
    JSON.stringify(projectJson, null, 2) + "\n",
  );
  log(`  ✓ ${projectName}: Created project.json`, "green");
  return true;
}

// Add .NET projects to the root solution file
function addProjectsToSolution() {
  const solutionPath = path.join(process.cwd(), "real-estate-platform.sln");

  // Check if solution file exists
  if (!fs.existsSync(solutionPath)) {
    log("\n⚠️  No solution file found. Creating new solution...", "yellow");
    try {
      execSync("dotnet new sln -n real-estate-platform", { stdio: "inherit" });
      log("✓ Created real-estate-platform.sln", "green");
    } catch (error) {
      log(`✗ Failed to create solution file: ${error.message}`, "red");
      return { added: 0, removed: 0 };
    }
  }

  // Read solution file to check existing projects
  const solutionContent = fs.readFileSync(solutionPath, "utf8");
  const existingProjects = [];

  // Extract existing project paths from solution file
  const projectRegex = /Project\([^)]+\)\s*=\s*"[^"]+",\s*"([^"]+)"/g;
  let match;
  while ((match = projectRegex.exec(solutionContent)) !== null) {
    // Normalize path separators for comparison
    existingProjects.push(match[1].replace(/\\/g, "/"));
  }

  // Find all .csproj files in the workspace
  const csprojFiles = [];
  function findCsprojFiles(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== "node_modules"
        ) {
          findCsprojFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".csproj")) {
          csprojFiles.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore errors reading directories
    }
  }

  findCsprojFiles(process.cwd());

  // Normalize current .csproj paths for comparison
  const currentProjectPaths = csprojFiles.map((csprojPath) => {
    const relativePath = path.relative(process.cwd(), csprojPath);
    return relativePath.replace(/\\/g, "/");
  });

  // Remove projects that no longer exist
  let removedCount = 0;
  for (const existingPath of existingProjects) {
    const fullPath = path.join(process.cwd(), existingPath);

    if (!fs.existsSync(fullPath)) {
      log(
        `  🗑️  ${path.basename(existingPath, ".csproj")}: Project file no longer exists, removing from solution`,
        "yellow",
      );
      try {
        execSync(`dotnet sln "${solutionPath}" remove "${existingPath}"`, {
          stdio: "pipe",
        });
        log(
          `  ✓ ${path.basename(existingPath, ".csproj")}: Removed from solution`,
          "green",
        );
        removedCount++;
      } catch (error) {
        log(
          `  ✗ ${path.basename(existingPath, ".csproj")}: Failed to remove - ${error.message}`,
          "red",
        );
      }
    }
  }

  if (csprojFiles.length === 0) {
    log("\n  No .csproj files found to add to solution", "yellow");
    return { added: 0, removed: removedCount };
  }

  // Add new projects to solution
  let addedCount = 0;

  for (const csprojPath of csprojFiles) {
    // Get relative path from solution root
    const relativePath = path.relative(process.cwd(), csprojPath);
    const normalizedPath = relativePath.replace(/\\/g, "/");

    // Check if already in solution
    const alreadyAdded = existingProjects.some(
      (existingPath) => existingPath === normalizedPath,
    );

    if (alreadyAdded) {
      log(
        `  ℹ ${path.basename(csprojPath, ".csproj")}: Already in solution`,
        "yellow",
      );
      continue;
    }

    // Add to solution
    try {
      execSync(`dotnet sln "${solutionPath}" add "${csprojPath}"`, {
        stdio: "pipe",
      });
      log(
        `  ✓ ${path.basename(csprojPath, ".csproj")}: Added to solution`,
        "green",
      );
      addedCount++;
    } catch (error) {
      log(
        `  ✗ ${path.basename(csprojPath, ".csproj")}: Failed to add - ${error.message}`,
        "red",
      );
    }
  }

  return { added: addedCount, removed: removedCount };
}

// Main function
function main() {
  log("\n🔧 Setting up .NET project configurations...\n", "blue");

  const dotNetProjects = getDotNetProjects();

  if (dotNetProjects.length === 0) {
    log("No .NET projects found in the workspace.", "yellow");
  } else {
    log(`Found ${dotNetProjects.length} .NET project(s):\n`, "blue");

    let updatedCount = 0;

    for (const projectName of dotNetProjects) {
      const projectConfig = getProjectConfig(projectName);
      if (!projectConfig) continue;

      const wasUpdated = createProjectJson(projectName, projectConfig);
      if (wasUpdated) {
        updatedCount++;
      }
    }

    log(`\n✅ Project.json setup complete!`, "green");
    log(`   Total projects: ${dotNetProjects.length}`, "blue");
    log(`   Updated/Created: ${updatedCount}`, "green");
  }

  // Always synchronize solution file, even if no NX projects exist
  log("\n🔗 Synchronizing solution file...\n", "blue");
  const solutionResult = addProjectsToSolution();

  // Clean up the solution file - remove leading/trailing blank lines and fix platforms (always)
  const solutionPath = path.join(process.cwd(), "real-estate-platform.sln");
  if (fs.existsSync(solutionPath)) {
    try {
      // Read as buffer to preserve exact encoding
      const buffer = fs.readFileSync(solutionPath);
      const hasBOM =
        buffer.length >= 3 &&
        buffer[0] === 0xef &&
        buffer[1] === 0xbb &&
        buffer[2] === 0xbf;

      let solutionContent = buffer.toString("utf8");
      // Remove BOM character from string if present
      if (solutionContent.charCodeAt(0) === 0xfeff) {
        solutionContent = solutionContent.substring(1);
      }

      // Detect current line ending style to preserve it
      const hasCRLF = solutionContent.includes("\r\n");
      const lineEnding = hasCRLF ? "\r\n" : "\n";

      // Remove extra platform configurations that dotnet sln adds
      // Keep only Debug|Any CPU and Release|Any CPU
      solutionContent = solutionContent.replace(
        /^\s*Debug\|x64 = Debug\|x64\r?\n/gm,
        "",
      );
      solutionContent = solutionContent.replace(
        /^\s*Debug\|x86 = Debug\|x86\r?\n/gm,
        "",
      );
      solutionContent = solutionContent.replace(
        /^\s*Release\|x64 = Release\|x64\r?\n/gm,
        "",
      );
      solutionContent = solutionContent.replace(
        /^\s*Release\|x86 = Release\|x86\r?\n/gm,
        "",
      );

      // Normalize all line endings to match detected style
      if (hasCRLF) {
        solutionContent = solutionContent.replace(/\r?\n/g, "\r\n");
      } else {
        solutionContent = solutionContent.replace(/\r\n/g, "\n");
      }

      // Trim and add single trailing newline
      solutionContent = solutionContent.trim() + lineEnding;

      // Write with same BOM state as original
      const outputBuffer = hasBOM
        ? Buffer.concat([
            Buffer.from([0xef, 0xbb, 0xbf]),
            Buffer.from(solutionContent, "utf8"),
          ])
        : Buffer.from(solutionContent, "utf8");
      fs.writeFileSync(solutionPath, outputBuffer);
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  log(`\n✅ Solution synchronization complete!`, "green");
  log(`   Added to solution: ${solutionResult.added}`, "green");
  if (solutionResult.removed > 0) {
    log(`   Removed from solution: ${solutionResult.removed}`, "yellow");
  }
  log("");

  if (dotNetProjects.length > 0) {
    log(
      "💡 Tip: Run 'npm run nx:dotnet-lint' to lint all .NET projects\n",
      "blue",
    );
  }

  // Important reminders based on common issues
  log("⚠️  Important Reminders:", "yellow");
  log("   • ImplicitUsings doesn't include third-party packages", "yellow");
  log(
    "   • Add explicit 'using' directives for Newtonsoft.Json, Ocelot, etc.",
    "yellow",
  );
  log(
    "   • Reload VS Code after adding packages for IntelliSense to work",
    "yellow",
  );
  log(
    "   • Add explicit versions to PackageReferences to avoid NU1604 warnings",
    "yellow",
  );
  log(
    "   • Use VersionOverride in Directory.Packages.props for transitive deps\n",
    "yellow",
  );
}

// Run the script
main();
