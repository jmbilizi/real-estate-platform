#!/usr/bin/env node

/**
 * Python Developer Setup Script
 *
 * This script sets up a Python development environment:
 * 1. Checks for Python installation and installs if needed
 * 2. Creates and activates a virtual environment (.venv)
 * 3. Installs all development and common packages
 * 4. Optionally installs packages for specific Python services
 *
 * Usage:
 *   node python-dev-setup.js [service-path1] [service-path2] ...
 *
 *   Examples:
 *     node python-dev-setup.js                  // Install only common packages
 *     node python-dev-setup.js all              // Install packages for all services
 *     node python-dev-setup.js apps/my-service1 apps/my-service2  // Install packages for specific services
 */

const path = require("path");
const { spawnSync, execSync } = require("child_process");
const os = require("os");
const fs = require("fs");

// Determine OS
const isWindows = os.platform() === "win32";

// Define paths
const rootDir = process.cwd();
const toolsDir = path.join(rootDir, "tools", "python");
const scriptsDir = path.join(toolsDir, "scripts");
const venvPath = path.join(rootDir, ".venv");
const venvBinDir = isWindows ? path.join(venvPath, "Scripts") : path.join(venvPath, "bin");

// Scripts paths
const installPythonScript = path.join(scriptsDir, isWindows ? "install-python-direct.bat" : "install-python-direct.sh");

// Requirements files
const mainRequirements = path.join(toolsDir, "requirements.txt");
const formatRequirements = path.join(toolsDir, "format-requirements.txt");
const devRequirements = path.join(toolsDir, "python-dev-requirements.txt");

// Logging helper
function log(message, isError = false) {
  if (isError) {
    console.error(`[ERROR] ${message}`);
  } else {
    console.log(`[INFO] ${message}`);
  }
}

// Execute command helper
function execute(cmd, args = [], options = {}) {
  log(`Executing: ${cmd} ${args.join(" ")}`);

  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: true,
    cwd: options.cwd || process.cwd(),
    ...options,
  });

  return {
    status: result.status,
    success: result.status === 0,
    error: result.error,
  };
}

// Check if Python is installed
function isPythonInstalled() {
  log("Checking if Python is installed...");

  try {
    // Try multiple methods to detect Python
    if (isWindows) {
      // 1. Try 'where python'
      const whereResult = spawnSync("where", ["python"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
      });
      if (whereResult.status === 0 && whereResult.stdout.trim().length > 0) {
        log("Python found in PATH");

        // Verify it actually works
        const versionResult = spawnSync("python", ["--version"], {
          shell: true,
          stdio: "pipe",
          encoding: "utf8",
        });

        if (versionResult.status === 0 && versionResult.stdout.trim().length > 0) {
          log(`Python is working: ${versionResult.stdout.trim()}`);
          return true;
        } else {
          log("Python found in PATH but not working. It might be a Windows App Execution Alias.", true);
          return false;
        }
      }

      // 2. Try direct 'python --version'
      const versionResult = spawnSync("python", ["--version"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
      });
      if (versionResult.status === 0 && versionResult.stdout.trim().length > 0) {
        log(`Python command is working: ${versionResult.stdout.trim()}`);
        return true;
      }

      // 3. Try Python launcher 'py --version'
      const pyResult = spawnSync("py", ["--version"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
      });
      if (pyResult.status === 0 && pyResult.stdout.trim().length > 0) {
        log(`Python launcher (py) is working: ${pyResult.stdout.trim()}`);
        return true;
      }
    } else {
      // On Unix, try python3 and python
      const py3Result = spawnSync("python3", ["--version"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
      });
      if (py3Result.status === 0 && py3Result.stdout.trim().length > 0) {
        log(`Python 3 found: ${py3Result.stdout.trim()}`);
        return true;
      }

      const pyResult = spawnSync("python", ["--version"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
      });
      if (pyResult.status === 0 && pyResult.stdout.trim().length > 0) {
        log(`Python found: ${pyResult.stdout.trim()}`);
        return true;
      }
    }

    log("Python not found in PATH");
    return false;
  } catch (error) {
    log(`Error checking Python: ${error.message}`, true);
    return false;
  }
}

// Install Python
function installPython() {
  if (isPythonInstalled()) {
    log("Python is already installed.");
    return true;
  }

  log("Python not found. Installing Python...");

  const result = execute(installPythonScript);

  if (result.success) {
    log("\nPython has been installed successfully!");
    return true;
  } else {
    log("Failed to install Python automatically.", true);
    return false;
  }
}

// Refresh PATH environment variable to include newly installed Python
async function refreshPath() {
  log("Refreshing PATH environment variable...");

  if (isWindows) {
    try {
      // First try finding Python in common locations
      if (findPythonInCommonLocations()) {
        return true;
      }

      // Use PowerShell to get the updated PATH from the registry
      const refreshPathCmd = `
        $envPath = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH', 'User')
        Write-Host $envPath
      `;

      const result = execSync(`powershell -command "${refreshPathCmd}"`, {
        encoding: "utf8",
        stdio: "pipe",
      });

      if (result) {
        const newPath = result.trim();
        process.env.PATH = newPath;
        log("PATH environment variable refreshed");

        // Verify Python is now in PATH
        return isPythonInstalled();
      }
    } catch (error) {
      log(`Failed to refresh PATH: ${error.message}`, true);
    }
  } else {
    // On Unix systems, we'd need to source the profile which is not possible in Node.js
    // So we'll just check if Python is in PATH after installation
    return isPythonInstalled();
  }

  return false;
}

// Try to find Python in common installation locations
function findPythonInCommonLocations() {
  log("Searching for Python in common installation locations...");

  if (!isWindows) {
    return false; // This is primarily for Windows
  }

  const commonLocations = [
    "C:\\Python311\\python.exe",
    "C:\\Python312\\python.exe",
    "C:\\Python313\\python.exe",
    "C:\\Program Files\\Python311\\python.exe",
    "C:\\Program Files\\Python312\\python.exe",
    "C:\\Program Files\\Python313\\python.exe",
    `C:\\Users\\${os.userInfo().username}\\AppData\\Local\\Programs\\Python\\Python311\\python.exe`,
    `C:\\Users\\${os.userInfo().username}\\AppData\\Local\\Programs\\Python\\Python312\\python.exe`,
    `C:\\Users\\${os.userInfo().username}\\AppData\\Local\\Programs\\Python\\Python313\\python.exe`,
  ];

  for (const location of commonLocations) {
    if (fs.existsSync(location)) {
      log(`Found Python at: ${location}`);

      // Add to PATH for this process
      process.env.PATH = `${path.dirname(location)}${path.delimiter}${process.env.PATH}`;

      // Test if Python is now callable
      const testResult = spawnSync("python", ["--version"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
      });

      if (testResult.status === 0) {
        log("Successfully added Python to PATH for this process");
        return true;
      }
    }
  }

  return false;
}

// Create virtual environment
function createVirtualEnv() {
  log("Creating/checking virtual environment...");

  if (fs.existsSync(venvPath)) {
    log("Virtual environment already exists.");

    // Verify the venv is valid
    const pythonExePath = path.join(venvBinDir, isWindows ? "python.exe" : "python");
    if (fs.existsSync(pythonExePath)) {
      log("Virtual environment appears to be valid.");
      return true;
    } else {
      log("Virtual environment seems corrupt, recreating...", true);
      try {
        fs.rmSync(venvPath, { recursive: true, force: true });
      } catch (error) {
        log(`Error removing corrupt venv: ${error.message}`, true);
        return false;
      }
    }
  }

  // Create the virtual environment
  // Try multiple Python commands in case one works
  const commands = isWindows ? ["python", "py -3", "py"] : ["python3", "python"];

  for (const cmd of commands) {
    log(`Trying to create virtual environment with: ${cmd}`);
    const result = execute(cmd, ["-m", "venv", venvPath]);

    if (result.success) {
      log(`Virtual environment created successfully using ${cmd}.`);
      return true;
    }
  }

  log("Failed to create virtual environment with any available Python command.", true);
  return false;
}

// Add pipx bin directory to system PATH permanently
function addPipxToPath() {
  log("Adding pipx bin directory to system PATH...");

  const pipxBinPath = isWindows ? path.join(os.homedir(), ".local", "bin") : path.join(os.homedir(), ".local", "bin");

  if (isWindows) {
    try {
      // Get current user PATH
      const getCurrentPath = execSync(
        "powershell -command \"[System.Environment]::GetEnvironmentVariable('Path', 'User')\"",
        { encoding: "utf8" },
      ).trim();

      // Check if pipx bin path is already in PATH
      if (getCurrentPath.includes(pipxBinPath)) {
        log("pipx bin directory is already in PATH.");
        return true;
      }

      // Add pipx bin path to user PATH
      const newPath = `${pipxBinPath};${getCurrentPath}`;
      execSync(`powershell -command "[System.Environment]::SetEnvironmentVariable('Path', '${newPath}', 'User')"`, {
        encoding: "utf8",
      });

      // Also add to current process PATH
      process.env.PATH = `${pipxBinPath};${process.env.PATH}`;

      log("pipx bin directory added to PATH successfully.");
      return true;
    } catch (error) {
      log(`Failed to add pipx to PATH: ${error.message}`, true);
      log(`Please manually add ${pipxBinPath} to your system PATH if needed.`, true);
      return false;
    }
  } else {
    // For Unix-like systems, ensurepath should handle it
    // Add to current process PATH
    process.env.PATH = `${pipxBinPath}:${process.env.PATH}`;
    return true;
  }
}

// Install UV and Poetry globally via pipx
function installGlobalTools() {
  log("Checking and installing global Python tools (UV, Poetry)...");

  // Use venv Python for all pip operations (has SSL certs configured)
  const venvPython = path.join(venvBinDir, isWindows ? "python.exe" : "python");

  // Check if pipx is installed as a Python module (required for 'python -m pipx')
  const pipxModuleCheck = spawnSync(venvPython, ["-m", "pipx", "--version"], {
    shell: true,
    stdio: "pipe",
    encoding: "utf8",
  });

  if (pipxModuleCheck.status !== 0) {
    log("pipx not found. Installing pipx into venv...");
    // Install pipx into venv (not --user since venv doesn't support that)
    const pipxInstall = execute(venvPython, ["-m", "pip", "install", "pipx"]);

    if (!pipxInstall.success) {
      log("Failed to install pipx. Skipping global tools installation.", true);
      return false;
    }

    log("pipx installed successfully.");

    // Ensure pipx path is added with --force to update immediately
    log("Ensuring pipx is in PATH...");
    execute(venvPython, ["-m", "pipx", "ensurepath", "--force"]);

    // Add pipx to PATH for current session and permanently
    addPipxToPath();
  } else {
    log("pipx is already installed.");
    // Even if pipx is installed, ensure pipx bin dir is in the current process PATH
    const pipxBinPath = isWindows ? path.join(os.homedir(), ".local", "bin") : path.join(os.homedir(), ".local", "bin");

    // Add to current process PATH if not already there
    if (!process.env.PATH.includes(pipxBinPath)) {
      process.env.PATH = isWindows ? `${pipxBinPath};${process.env.PATH}` : `${pipxBinPath}:${process.env.PATH}`;
      log("Added pipx bin directory to current session PATH.");
    }
  }

  // Get pipx bin path for checking UV/Poetry with full paths
  const pipxBinDir = isWindows ? path.join(os.homedir(), ".local", "bin") : path.join(os.homedir(), ".local", "bin");

  const uvPath = path.join(pipxBinDir, isWindows ? "uv.exe" : "uv");
  const poetryPath = path.join(pipxBinDir, isWindows ? "poetry.exe" : "poetry");

  // Install UV if not already installed
  const uvCheck = fs.existsSync(uvPath)
    ? { status: 0 }
    : spawnSync("uv", ["--version"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
        env: process.env, // Use updated PATH
      });

  if (uvCheck.status !== 0) {
    log("UV not found. Installing UV globally via pipx...");
    const uvInstall = execute(venvPython, ["-m", "pipx", "install", "uv"]);

    if (!uvInstall.success) {
      log("Failed to install UV globally.", true);
    } else {
      log("UV installed successfully.");
    }
  } else {
    log("UV is already installed.");
  }

  // Install Poetry if not already installed
  const poetryCheck = fs.existsSync(poetryPath)
    ? { status: 0 }
    : spawnSync("poetry", ["--version"], {
        shell: true,
        stdio: "pipe",
        encoding: "utf8",
        env: process.env, // Use updated PATH
      });

  if (poetryCheck.status !== 0) {
    log("Poetry not found. Installing Poetry globally via pipx...");
    const poetryInstall = execute(venvPython, ["-m", "pipx", "install", "poetry"]);

    if (!poetryInstall.success) {
      log("Failed to install Poetry globally.", true);
    } else {
      log("Poetry installed successfully.");
      // Ensure PATH is updated after installation
      addPipxToPath();
    }
  } else {
    log("Poetry is already installed.");
  }

  // Create a .env file with UV and Poetry paths for immediate use
  const envContent = `# Auto-generated by python-dev-setup.js
# UV and Poetry paths for immediate use in npm scripts
UV_PATH=${path.join(pipxBinDir, isWindows ? "uv.exe" : "uv")}
POETRY_PATH=${path.join(pipxBinDir, isWindows ? "poetry.exe" : "poetry")}
PIPX_BIN_PATH=${pipxBinDir}
`;

  const envPath = path.join(rootDir, ".env");
  try {
    fs.writeFileSync(envPath, envContent, "utf8");
    log("Created .env file with UV and Poetry paths.");
  } catch (error) {
    log(`Warning: Could not create .env file: ${error.message}`, true);
  }

  log("Global tools setup complete. UV and Poetry have been installed globally.");
  log("");

  // Refresh PATH in current process by re-reading from registry
  if (isWindows) {
    try {
      const userPath = execSync(
        "powershell -command \"[System.Environment]::GetEnvironmentVariable('Path', 'User')\"",
        { encoding: "utf8" },
      ).trim();
      const machinePath = execSync(
        "powershell -command \"[System.Environment]::GetEnvironmentVariable('Path', 'Machine')\"",
        { encoding: "utf8" },
      ).trim();
      process.env.PATH = `${userPath};${machinePath}`;
      log("✓ PATH refreshed in current process. UV and Poetry are now available!");
    } catch (error) {
      log("Note: Could not auto-refresh PATH. You may need to restart your terminal.");
    }
  }

  log("");
  log("You can now use Nx Python generators:");
  log("  npx nx g @nxlv/python:uv-project my-service --directory=apps");
  log("");
  return true;
}

// Install common packages in the virtual environment
function installCommonPackages() {
  log("Installing common Python packages...");

  // Ensure venv exists
  if (!fs.existsSync(venvPath)) {
    log("Virtual environment not found. Please create it first.", true);
    return false;
  }

  // Determine which requirements files to install
  const reqFiles = [mainRequirements, formatRequirements, devRequirements];

  // Activate and install packages
  const pipPath = path.join(venvBinDir, isWindows ? "pip.exe" : "pip");

  // First upgrade pip
  log("Upgrading pip...");
  const pipUpgradeResult = execute(isWindows ? path.join(venvBinDir, "python.exe") : path.join(venvBinDir, "python"), [
    "-m",
    "pip",
    "install",
    "--upgrade",
    "pip",
  ]);

  if (!pipUpgradeResult.success) {
    log("Failed to upgrade pip. Continuing anyway...", true);
  }

  // Install each requirements file
  let allSuccessful = true;

  for (const reqFile of reqFiles) {
    if (fs.existsSync(reqFile)) {
      log(`Installing requirements from: ${reqFile}`);

      const result = execute(isWindows ? path.join(venvBinDir, "python.exe") : path.join(venvBinDir, "python"), [
        "-m",
        "pip",
        "install",
        "-r",
        reqFile,
      ]);

      if (!result.success) {
        log(`Failed to install requirements from: ${reqFile}`, true);
        allSuccessful = false;
      }
    } else {
      log(`Requirements file not found: ${reqFile}`, true);
      allSuccessful = false;
    }
  }

  if (allSuccessful) {
    log("All common packages installed successfully.");
  } else {
    log("Some packages failed to install. Check the output above.", true);
  }

  return allSuccessful;
}

// Find all requirements.txt files in Python services
function findAllServiceRequirements() {
  log("Finding all Python service requirements files...");

  const requirementsFiles = [];

  // Search in apps directory
  const appsDir = path.join(rootDir, "apps");
  if (fs.existsSync(appsDir)) {
    const findCmd = isWindows
      ? `powershell -command "Get-ChildItem -Path '${appsDir}' -Filter 'requirements.txt' -Recurse | Select-Object -ExpandProperty FullName"`
      : `find ${appsDir} -name "requirements.txt" -type f`;

    try {
      const result = execSync(findCmd, { encoding: "utf8" });
      if (result) {
        const files = result.trim().split("\n").filter(Boolean);
        requirementsFiles.push(...files);
      }
    } catch (error) {
      log(`Error finding requirements files: ${error.message}`, true);
    }
  }

  return requirementsFiles;
}

// Install service-specific packages
function installServicePackages(servicePaths) {
  if (!Array.isArray(servicePaths)) {
    servicePaths = [servicePaths];
  }

  log(`Installing packages for services: ${servicePaths.join(", ") || "all"}`);

  // Find requirements.txt files
  let requirementsFiles = [];

  if (servicePaths.length === 1 && (servicePaths[0] === "all" || !servicePaths[0])) {
    // Install packages for all services
    requirementsFiles = findAllServiceRequirements();

    if (requirementsFiles.length === 0) {
      log("No service requirements files found.");
      return true;
    }

    log(`Found ${requirementsFiles.length} service requirements files.`);
  } else {
    // Install packages for specific services
    for (const servicePath of servicePaths) {
      if (!servicePath) continue;

      const serviceReqPath = path.join(rootDir, servicePath, "requirements.txt");

      if (fs.existsSync(serviceReqPath)) {
        requirementsFiles.push(serviceReqPath);
        log(`Found requirements file: ${serviceReqPath}`);
      } else {
        log(`No requirements.txt file found for service: ${servicePath}`, true);
        // Continue with other services instead of returning false
      }
    }

    if (requirementsFiles.length === 0) {
      log("No valid requirements.txt files found for the specified services.", true);
      return false;
    }
  }

  // Install packages from each requirements file
  let allSuccessful = true;

  for (const reqFile of requirementsFiles) {
    log(`Installing requirements from: ${reqFile}`);

    const result = execute(isWindows ? path.join(venvBinDir, "python.exe") : path.join(venvBinDir, "python"), [
      "-m",
      "pip",
      "install",
      "-r",
      reqFile,
    ]);

    if (!result.success) {
      log(`Failed to install requirements from: ${reqFile}`, true);
      allSuccessful = false;
    }
  }

  return allSuccessful;
}

// Show activation instructions
function showActivationInstructions() {
  log("\nTo activate the virtual environment, run:");

  if (isWindows) {
    log(`${venvPath}\\Scripts\\activate.bat`);
  } else {
    log(`source ${venvPath}/bin/activate`);
  }
}

// Show help information
function showHelp() {
  console.log(`
Python Developer Setup Script
=============================

This script sets up a Python development environment for the real-estate-platform.

Usage:
  node python-dev-setup.js [options] [service-paths...]

Options:
  --help        Show this help message
  all           Install packages for all Python services

Examples:
  node python-dev-setup.js                        # Install only common packages
  node python-dev-setup.js all                    # Install packages for all services
  node python-dev-setup.js apps/my-service1 # Install packages for one service
  node python-dev-setup.js apps/my-service1 apps/my-service2 
                                                  # Install packages for multiple services

Available npm scripts:
  npm run python:env           # Setup Python dev environment with common packages
  npm run python:env:full      # Setup Python and install packages for all services
  npm run python:deps          # Install packages for specific services
  `);
  process.exit(0);
}

// Main function
async function main() {
  // Get service paths from command line, skip the first two args (node and script path)
  const args = process.argv.slice(2);

  // Check for help flag
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  const servicePaths = args;

  log("Starting Python development environment setup...");

  // Step 1: Check and install Python if needed
  if (!isPythonInstalled()) {
    log("Python not found. Installing...");

    const installed = installPython();
    if (!installed) {
      log("Failed to install Python.", true);
      log("Please install Python manually from https://www.python.org/downloads/", true);
      process.exit(1);
    }

    // Refresh PATH to include newly installed Python
    log("Refreshing PATH to include newly installed Python...");
    let pythonInPath = await refreshPath();

    if (!pythonInPath) {
      // One more attempt to find Python directly
      log("Trying to find Python in common installation locations...");
      pythonInPath = findPythonInCommonLocations();

      if (!pythonInPath) {
        log("Failed to detect Python in PATH after installation.", true);
        log("Python has been installed but is not available in the current terminal session.", true);
        log("Please restart your terminal or VS Code and run this script again.", true);
        log("If the issue persists, try manually setting the PATH to include Python.", true);

        // Show manual recovery steps
        if (isWindows) {
          log("\nManual recovery steps:", true);
          log("1. Try running: C:\\Python313\\python.exe -m venv .venv", true);
          log("   or: C:\\Program Files\\Python313\\python.exe -m venv .venv", true);
          log("2. Activate with: .venv\\Scripts\\activate.bat", true);
          log("3. Install packages with: pip install -r tools/python/requirements.txt", true);
        }

        process.exit(1);
      }
    }
  }

  log("Python is available. Proceeding with setup...");

  // Step 2: Create virtual environment
  log("Setting up Python virtual environment...");
  const venvCreated = createVirtualEnv();

  if (!venvCreated) {
    log("Failed to create virtual environment.", true);
    log("Try running the command manually: python -m venv .venv", true);
    process.exit(1);
  }

  // Step 3: Install common packages
  log("Installing common Python packages...");
  const commonPackagesInstalled = installCommonPackages();

  if (!commonPackagesInstalled) {
    log("Some common packages failed to install. Setup may be incomplete.", true);
  }

  // Step 3.5: Install global tools (UV, Poetry) via pipx
  log("Installing global Python tools (UV, Poetry)...");
  installGlobalTools();

  // Step 4: Install service-specific packages if requested
  if (servicePaths.length > 0) {
    log(`Installing service-specific packages...`);
    const servicePackagesInstalled = installServicePackages(servicePaths);

    if (!servicePackagesInstalled) {
      log("Some service-specific packages failed to install.", true);
    }
  }

  // Show activation instructions
  showActivationInstructions();

  log("\nPython development environment setup completed!");
  log("You can now start working on Python services.");
  log("\nTo install packages for specific services later, run:");
  log("npm run python:deps apps/my-service1 apps/my-service2");
}

// Run the main function
main().catch((error) => {
  log(`Unhandled error: ${error.message}`, true);
  process.exit(1);
});
