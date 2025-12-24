#!/usr/bin/env node

/**
 * Check if NX Python has already been set up
 * Returns true if NX Python is set up, false otherwise
 */

const fs = require("fs");
const path = require("path");

function isNxPythonSetup() {
  const rootDir = process.cwd();

  // Check 1: Does nx-python.json exist?
  const nxPythonConfigExists = fs.existsSync(path.join(rootDir, "nx-python.json"));

  // Check 2: Is @nxlv/python installed in node_modules?
  const nxPythonModuleExists = fs.existsSync(path.join(rootDir, "node_modules", "@nxlv", "python"));

  // Check 3: Does nx.json have Python plugins configured?
  let nxJsonHasPython = false;
  try {
    const nxJsonPath = path.join(rootDir, "nx.json");
    if (fs.existsSync(nxJsonPath)) {
      const nxJson = require(nxJsonPath);
      nxJsonHasPython =
        nxJson.plugins &&
        nxJson.plugins.some((plugin) => {
          // Plugin can be a string or an object with a 'plugin' property
          if (typeof plugin === "string") {
            return plugin.includes("@nxlv/python");
          } else if (plugin && typeof plugin === "object" && plugin.plugin) {
            return plugin.plugin.includes("@nxlv/python");
          }
          return false;
        });
    }
  } catch (error) {
    console.error(`[WARNING] Error checking nx.json: ${error.message}`);
  }

  // NX Python is considered set up if at least 2 of the 3 checks pass
  const checksPassedCount = [nxPythonConfigExists, nxPythonModuleExists, nxJsonHasPython].filter(Boolean).length;

  return checksPassedCount >= 2;
}

// When run directly from command line
if (require.main === module) {
  const isSetup = isNxPythonSetup();
  console.log(isSetup ? "NX Python is already set up." : "NX Python is not set up yet.");
  process.exit(isSetup ? 0 : 1);
}

// When required as a module
module.exports = {
  isNxPythonSetup,
};
