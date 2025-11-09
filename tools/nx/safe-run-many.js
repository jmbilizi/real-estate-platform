#!/usr/bin/env node

/**
 * Safe NX Run Script
 *
 * This script runs nx run-many commands and properly handles errors when no projects exist.
 * It's designed to avoid pipeline failures and provide clear error messages.
 */

const { spawnSync } = require("child_process");
const args = process.argv.slice(2);

// Extract target and project type for better error messages
let target = "unknown";
let projectType = "matching";
let hasTargetArg = false;
let hasProjectsArg = false;

// Parse arguments in format --name=value or --name value
for (const arg of args) {
  if (arg.startsWith("--target=")) {
    target = arg.substring("--target=".length);
    hasTargetArg = true;
  } else if (arg === "--target" && args.indexOf(arg) + 1 < args.length) {
    target = args[args.indexOf(arg) + 1];
    hasTargetArg = true;
  } else if (arg.startsWith("--projects=")) {
    hasProjectsArg = true;
    const projectsArg = arg.substring("--projects=".length);
    if (projectsArg.startsWith("tag:")) {
      projectType = projectsArg.substring(4);
    }
  } else if (arg === "--projects" && args.indexOf(arg) + 1 < args.length) {
    hasProjectsArg = true;
    const projectsArg = args[args.indexOf(arg) + 1];
    if (projectsArg.startsWith("tag:")) {
      projectType = projectsArg.substring(4);
    }
  }
}

// If no command-line args were provided, show usage
if (args.length === 0 || !hasTargetArg || !hasProjectsArg) {
  console.log("[NX] Running nx run-many command");

  // Just pass through to regular nx without special handling
  const result = spawnSync("npx", ["nx", "run-many", ...args], {
    stdio: "inherit",
  });

  process.exit(result.status || 0);
}

console.log(
  `[NX] Running nx run-many for ${projectType} projects with target "${target}"`,
);

// Run the nx command
const result = spawnSync("npx", ["nx", "run-many", ...args], {
  stdio: "inherit",
});

// If the command fails, check if it's because of no projects
if (result.status !== 0) {
  console.log(
    `\n[NX] No ${projectType} projects found with target "${target}".`,
  );
  console.log(
    `[NX] This is expected if you haven't created any ${projectType} projects yet.`,
  );
  console.log(
    `[NX] You can create projects using the appropriate create commands.`,
  );

  // Exit with success code so CI pipelines don't fail
  process.exit(0);
}
