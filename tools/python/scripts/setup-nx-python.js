#!/usr/bin/env node

/**
 * Setup NX Python wrapper script
 * Detects OS and runs the appropriate script
 */

const path = require("path");
const { spawnSync } = require("child_process");
const os = require("os");
const { isNxPythonSetup } = require("./check-nx-python");

// Check if NX Python is already set up
if (isNxPythonSetup()) {
  console.log("NX Python is already set up. Skipping installation.");
  process.exit(0);
}

// Determine OS
const isWindows = os.platform() === "win32";

// Get the script directory
const scriptDir = path.join(__dirname);

// Determine which script to run
const scriptPath = isWindows ? path.join(scriptDir, "setup-nx-python.bat") : path.join(scriptDir, "setup-nx-python.sh");

// Make the script executable on Unix
if (!isWindows) {
  try {
    spawnSync("chmod", ["+x", scriptPath], { stdio: "inherit" });
  } catch (error) {
    console.error(`Error making script executable: ${error.message}`);
  }
}

// Execute the script
const result = spawnSync(isWindows ? scriptPath : "bash", isWindows ? [] : [scriptPath], {
  stdio: "inherit",
  shell: true,
});

// Exit with the same status code
process.exit(result.status);
