#!/usr/bin/env node

/**
 * Auto-Tag Projects
 *
 * This script automatically detects and tags projects based on their executors.
 * It scans all projects in the workspace and applies appropriate language tags.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Colors for console output
const colors = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
};

// Root path
const rootDir = process.cwd();

// Get all projects in the workspace
function getAllProjects() {
  try {
    const output = execSync("npx nx show projects --json", {
      encoding: "utf8",
    });
    return JSON.parse(output);
  } catch (error) {
    console.error("Error getting projects:", error.message);
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
    console.error(`Error getting config for ${projectName}:`, error.message);
    return null;
  }
}

// Detect language based on executors
function detectLanguage(projectConfig) {
  const targets = projectConfig.targets || {};
  const executors = [];

  // Collect all executors
  for (const targetName in targets) {
    const target = targets[targetName];
    if (target.executor) {
      executors.push(target.executor);
    }
  }

  const executorString = executors.join(" ");

  // Node.js detection
  if (
    executorString.includes("@nx/node") ||
    executorString.includes("@nx/express") ||
    executorString.includes("@nx/next") ||
    executorString.includes("@nx/react") ||
    executorString.includes("@nx/web") ||
    executorString.includes("@nx/js") ||
    executorString.includes("@nx/jest") ||
    executorString.includes("@nx/eslint")
  ) {
    return "node";
  }

  // Python detection
  if (executorString.includes("@nxlv/python")) {
    return "python";
  }

  // .NET detection
  if (executorString.includes("@nx/dotnet")) {
    return "dotnet";
  }

  return null;
}

// Get additional tags based on executors
function getAdditionalTags(projectConfig, language) {
  const targets = projectConfig.targets || {};
  const executors = [];
  const additionalTags = [];

  // Collect all executors
  for (const targetName in targets) {
    const target = targets[targetName];
    if (target.executor) {
      executors.push(target.executor);
    }
  }

  const executorString = executors.join(" ");

  if (language === "node") {
    if (executorString.includes("@nx/express"))
      additionalTags.push("express", "api");
    if (executorString.includes("@nx/next"))
      additionalTags.push("next", "client");
    if (executorString.includes("@nx/react"))
      additionalTags.push("react", "client");

    // Determine if it's a service or library
    if (projectConfig.projectType === "library") {
      additionalTags.push("lib");
    } else {
      additionalTags.push("service");
    }
  }

  if (language === "python") {
    if (executorString.includes("fastapi"))
      additionalTags.push("fastapi", "api");
    if (executorString.includes("django")) additionalTags.push("django", "api");

    // Determine if it's a service or library
    if (projectConfig.projectType === "library") {
      additionalTags.push("lib");
    } else {
      additionalTags.push("service");
    }
  }

  if (language === "dotnet") {
    if (executorString.includes("webapi")) additionalTags.push("webapi", "api");
    if (executorString.includes("blazor"))
      additionalTags.push("blazor", "client");

    // Determine if it's a service or library
    if (projectConfig.projectType === "library") {
      additionalTags.push("lib");
    } else {
      additionalTags.push("service");
    }
  }

  return additionalTags;
}

// Update project tags
function updateProjectTags(projectName, projectConfig, newTags) {
  const projectRoot = projectConfig.root;
  const projectJsonPath = path.join(rootDir, projectRoot, "project.json");

  if (!fs.existsSync(projectJsonPath)) {
    console.warn(
      `project.json not found for ${projectName} at ${projectJsonPath}`,
    );
    return false;
  }

  try {
    const projectJson = JSON.parse(fs.readFileSync(projectJsonPath, "utf8"));

    // Initialize tags if not exist
    if (!projectJson.tags) {
      projectJson.tags = [];
    }

    const originalTags = [...projectJson.tags];
    let tagsAdded = false;

    // Add new tags if they don't exist
    for (const tag of newTags) {
      if (!projectJson.tags.includes(tag)) {
        projectJson.tags.push(tag);
        tagsAdded = true;
      }
    }

    if (tagsAdded) {
      // Write the updated project.json
      fs.writeFileSync(
        projectJsonPath,
        JSON.stringify(projectJson, null, 2) + "\n",
      );
      console.log(
        `${colors.green}✓${colors.reset} Tagged ${colors.blue}${projectName}${colors.reset}: ${newTags.join(", ")}`,
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error updating tags for ${projectName}:`, error.message);
    return false;
  }
}

// Main function
function main() {
  console.log(`${colors.blue}🏷️  Auto-tagging projects...${colors.reset}\n`);

  const projects = getAllProjects();
  let taggedCount = 0;
  let processedCount = 0;

  for (const projectName of projects) {
    const projectConfig = getProjectConfig(projectName);
    if (!projectConfig) {
      continue;
    }

    processedCount++;
    const language = detectLanguage(projectConfig);

    if (language) {
      const additionalTags = getAdditionalTags(projectConfig, language);
      const allTags = [language, ...additionalTags];

      const wasTagged = updateProjectTags(projectName, projectConfig, allTags);
      if (wasTagged) {
        taggedCount++;
      }
    } else {
      console.log(
        `${colors.yellow}⚠${colors.reset}  Could not detect language for ${colors.blue}${projectName}${colors.reset}`,
      );
    }
  }

  console.log(`\n${colors.green}✅ Auto-tagging complete!${colors.reset}`);
  console.log(`   Processed: ${processedCount} projects`);
  console.log(`   Tagged: ${taggedCount} projects`);

  if (taggedCount > 0) {
    console.log(
      `\n${colors.blue}💡 Tip:${colors.reset} Your nx:*-lint, nx:*-test, and nx:*-build commands will now work correctly!`,
    );
  }
}

// Run the script
main();
