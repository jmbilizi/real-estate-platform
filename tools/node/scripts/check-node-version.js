/**
 * Node.js Version Checker
 *
 * This script verifies that the correct Node.js version is being used.
 * It reads the required version from .nvmrc or .node-version files
 * and compares it with the current running Node.js version.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
};

// Get the repository root directory
const rootDir = path.resolve(__dirname, "../../../");

/**
 * Get the required Node.js version from .nvmrc or .node-version files
 * @returns {string} The required Node.js version
 */
function getRequiredNodeVersion() {
  const nvmrcPath = path.join(rootDir, ".nvmrc");
  const nodeVersionPath = path.join(rootDir, ".node-version");

  let requiredVersion;

  if (fs.existsSync(nvmrcPath)) {
    requiredVersion = fs.readFileSync(nvmrcPath, "utf8").trim();
  } else if (fs.existsSync(nodeVersionPath)) {
    requiredVersion = fs.readFileSync(nodeVersionPath, "utf8").trim();
  }

  if (!requiredVersion) {
    console.warn(`${colors.yellow}Warning: No .nvmrc or .node-version file found.${colors.reset}`);
    return null;
  }

  return requiredVersion;
}

/**
 * Get the current running Node.js version
 * @returns {string} The current Node.js version
 */
function getCurrentNodeVersion() {
  return process.version.slice(1); // Remove the 'v' prefix
}

/**
 * Compare version strings to check compatibility
 * @param {string} current - The current version
 * @param {string} required - The required version
 * @returns {boolean} True if versions are compatible
 */
function isVersionCompatible(current, required) {
  // Simple exact match check
  if (current === required) {
    return true;
  }

  // Parse versions for component-wise comparison
  const currentParts = current.split(".").map(Number);
  const requiredParts = required.split(".").map(Number);

  // Major version must match
  if (currentParts[0] !== requiredParts[0]) {
    return false;
  }

  // For a simple compatibility check, we'll consider matching major versions as compatible
  return true;
}

/**
 * Print installation instructions based on the platform
 * @param {string} requiredVersion - The required Node.js version
 */
function printInstallationInstructions(requiredVersion) {
  console.log(`\n${colors.bold}Installation Instructions:${colors.reset}\n`);

  console.log(`${colors.bold}Using Node Version Manager (recommended):${colors.reset}`);
  console.log(
    `1. Install nvm: https://github.com/nvm-sh/nvm (Unix/macOS) or https://github.com/coreybutler/nvm-windows (Windows)`,
  );
  console.log(`2. Run: ${colors.blue}nvm install ${requiredVersion}${colors.reset}`);
  console.log(`3. Run: ${colors.blue}nvm use ${requiredVersion}${colors.reset}`);

  console.log(`\n${colors.bold}Manual Installation:${colors.reset}`);
  console.log(`1. Download Node.js ${requiredVersion} from: https://nodejs.org/download/release/v${requiredVersion}/`);
  console.log(`2. Follow the installation instructions for your platform\n`);
}

/**
 * Main function to check Node.js version compatibility
 */
function checkNodeVersion() {
  const requiredVersion = getRequiredNodeVersion();
  if (!requiredVersion) {
    return;
  }

  const currentVersion = getCurrentNodeVersion();

  console.log(`Current Node.js version: ${colors.green}${currentVersion}${colors.reset}`);
  console.log(`Required Node.js version: ${colors.green}${requiredVersion}${colors.reset}`);

  if (isVersionCompatible(currentVersion, requiredVersion)) {
    console.log(`${colors.green}✓ Node.js version is compatible.${colors.reset}`);
    return true;
  } else {
    console.log(`${colors.red}✗ Node.js version mismatch.${colors.reset}`);
    console.log(
      `${colors.yellow}This project requires Node.js ${requiredVersion}, but you're using ${currentVersion}.${colors.reset}`,
    );
    printInstallationInstructions(requiredVersion);

    // Ask if the user wants to continue anyway
    console.log(
      `${colors.yellow}Warning: Continuing with an incompatible Node.js version may cause issues.${colors.reset}`,
    );

    if (process.env.NODE_FORCE_VERSION_CHECK === "strict") {
      console.log(`${colors.red}Strict version checking is enabled. Exiting.${colors.reset}`);
      process.exit(1);
    }

    return false;
  }
}

// If the script is run directly
if (require.main === module) {
  const compatible = checkNodeVersion();
  if (!compatible && !process.env.NODE_SKIP_VERSION_CHECK) {
    process.exit(1);
  }
}

module.exports = {
  checkNodeVersion,
  getRequiredNodeVersion,
  getCurrentNodeVersion,
  isVersionCompatible,
};
