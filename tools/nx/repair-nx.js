#!/usr/bin/env node

/**
 * NX Repair Script
 *
 * This script repairs the NX setup by:
 * 1. Creating or updating necessary NX configuration files
 * 2. Ensuring NX is properly installed
 * 3. Setting up minimal configuration for NX to work
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("🔧 Starting NX repair process...");

// Root path
const rootDir = process.cwd();

// Ensure nx.json exists with proper structure
const nxJsonPath = path.join(rootDir, "nx.json");
let nxJsonExists = fs.existsSync(nxJsonPath);
let nxJson = { plugins: [] };

if (nxJsonExists) {
  try {
    nxJson = require(nxJsonPath);
    console.log("✅ Found existing nx.json");
  } catch (error) {
    console.log("⚠️ Error reading nx.json, creating a new one");
    nxJsonExists = false;
  }
}

// Ensure minimum required fields
if (!nxJson.plugins) {
  nxJson.plugins = [];
}

if (!nxJson.installation) {
  nxJson.installation = { version: "22.0.1" }; // Updated to match package.json
}

if (!nxJson.projects) {
  nxJson.projects = {};
}

// Make sure we have all the plugins listed properly
const requiredPlugins = [
  {
    plugin: "@nx/dotnet",
    options: {
      lintTargetName: "lint",
      formatTargetName: "format",
      testTargetName: "test",
      buildTargetName: "build",
      serveTargetName: "serve",
    },
  },
  {
    plugin: "@nx/js/typescript",
    options: {
      typecheck: { targetName: "typecheck" },
      build: { targetName: "build", configName: "tsconfig.lib.json" },
    },
  },
  {
    plugin: "@nx/eslint/plugin",
    options: { targetName: "lint" },
  },
  {
    plugin: "@nxlv/python",
    options: {
      lintTargetName: "lint",
      formatTargetName: "format",
      testTargetName: "test",
      buildTargetName: "build",
      serveTargetName: "serve",
    },
  },
];

// Check if each required plugin exists, add if missing
for (const requiredPlugin of requiredPlugins) {
  if (typeof requiredPlugin === "string") {
    // For string plugins, check if they exist
    const exists = nxJson.plugins.some(
      (p) =>
        (typeof p === "string" && p === requiredPlugin) ||
        (typeof p === "object" && p.plugin === requiredPlugin),
    );

    if (!exists) {
      console.log(`➕ Adding missing plugin: ${requiredPlugin}`);
      nxJson.plugins.push(requiredPlugin);
    }
  } else {
    // For object plugins, check by plugin name
    const pluginName = requiredPlugin.plugin;
    const exists = nxJson.plugins.some(
      (p) => typeof p === "object" && p.plugin === pluginName,
    );

    if (!exists) {
      console.log(`➕ Adding missing plugin: ${pluginName}`);
      nxJson.plugins.push(requiredPlugin);
    }
  }
}

// Write updated nx.json
fs.writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2));
console.log("✅ Updated nx.json with proper configuration");

// Ensure .nx directory exists
const nxDir = path.join(rootDir, ".nx");
if (!fs.existsSync(nxDir)) {
  fs.mkdirSync(nxDir, { recursive: true });
  console.log("✅ Created .nx directory");
}

// Create a minimal project-graph.json to ensure nx can run without projects
const projectGraphPath = path.join(nxDir, "project-graph.json");
const minimalProjectGraph = {
  nodes: {},
  dependencies: {},
  version: "6.0",
};

// Always write the project-graph.json to ensure it's valid
fs.writeFileSync(
  projectGraphPath,
  JSON.stringify(minimalProjectGraph, null, 2),
);
console.log(
  "✅ Created/Updated minimal project-graph.json for Nx to work without projects",
);

// Ensure cache directory exists
const cachePath = path.join(nxDir, "cache");
if (!fs.existsSync(cachePath)) {
  fs.mkdirSync(cachePath, { recursive: true });
  console.log("✅ Created .nx/cache directory");
}

// Ensure nx-cloud.env file exists with basic content
const nxCloudEnvPath = path.join(nxDir, "nx-cloud.env");
if (!fs.existsSync(nxCloudEnvPath)) {
  fs.writeFileSync(nxCloudEnvPath, "# Nx Cloud Environment Variables\n");
  console.log("✅ Created nx-cloud.env file");
}

// Create workspace.json if it doesn't exist (helps with nx run-many)
const workspaceJsonPath = path.join(rootDir, "workspace.json");
if (!fs.existsSync(workspaceJsonPath)) {
  const workspaceJson = {
    version: 2,
    projects: {},
  };
  fs.writeFileSync(workspaceJsonPath, JSON.stringify(workspaceJson, null, 2));
  console.log("✅ Created workspace.json file");
}

// Update nx.bat file if it doesn't exist or is incorrect
const nxBatPath = path.join(rootDir, "nx.bat");
const correctNxBatContent = `@echo off
rem NX wrapper for Windows
rem This script executes NX commands directly using the local NX installation

node_modules\\.bin\\nx %*
`;

let updateNxBat = true;
if (fs.existsSync(nxBatPath)) {
  const currentContent = fs.readFileSync(nxBatPath, "utf8");
  if (currentContent.includes("node_modules\\.bin\\nx %*")) {
    updateNxBat = false;
  }
}

if (updateNxBat) {
  fs.writeFileSync(nxBatPath, correctNxBatContent);
  console.log("✅ Updated nx.bat file");
}

// Run npx nx --version to verify installation
try {
  console.log("⚙️ Verifying NX installation...");
  const version = execSync("npx nx --version", { stdio: "pipe" })
    .toString()
    .trim();
  console.log(`✅ NX is installed: ${version}`);
} catch (error) {
  console.log("⚠️ Error verifying NX. Trying to reinstall NX...");
  try {
    execSync("npm install nx@latest --save-dev", { stdio: "inherit" });
    console.log("✅ Reinstalled NX");
  } catch (installError) {
    console.error("❌ Failed to reinstall NX", installError.message);
    process.exit(1);
  }
}

console.log("🎉 NX repair completed successfully!");
console.log("You can now try running NX commands like:");
console.log("  npx nx graph");
console.log("  npx nx run-many --target=lint --projects=tag:python");
console.log("Or use the npm scripts defined in package.json.");
