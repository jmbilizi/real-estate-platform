/**
 * .NET Development Environment Setup Script
 *
 * This script sets up the .NET development environment for the Polyglot monorepo project.
 * It detects the operating system and performs the appropriate setup actions.
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const os = require("os");

// Process command line arguments
const args = process.argv.slice(2);
const skipTools = args.includes("--skip-tools");

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: node dotnet-dev-setup.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --help, -h     Display this help message");
  console.log("  --skip-tools   Skip installation of .NET global tools");
  console.log("");
  console.log("Description:");
  console.log(
    "  This script sets up the .NET development environment for the Polyglot monorepo project.",
  );
  console.log(
    "  It automatically detects the operating system and performs the appropriate setup actions.",
  );
  console.log("");
  console.log("Actions:");
  console.log("  1. Checks for .NET SDK installation");
  console.log("  2. Verifies .NET SDK version");
  console.log(
    "  3. Installs required .NET global tools (unless --skip-tools is used)",
  );
  console.log("  4. Ensures NX .NET plugin is installed");
  process.exit(0);
}

// Configuration
const requiredDotNetVersion = "9.0.305"; // The required .NET SDK version

// Determine if we're running on Windows
const isWindows = os.platform() === "win32";
const isUnix = !isWindows;

// Common .NET tools for code quality
const commonTools = [
  {
    name: "dotnet-format",
    version: "latest",
    description: "Code formatter for .NET",
  },
  {
    name: "dotnet-outdated-tool",
    version: "latest",
    description: "Find outdated NuGet packages",
  },
  {
    name: "dotnet-cleanup",
    version: "latest",
    description: "Clean up project files",
  },
  {
    name: "dotnet-doc",
    version: "latest",
    description: "Documentation generator",
  },
  {
    name: "dotnet-coverage",
    version: "latest",
    description: "Code coverage tool",
  },
  { name: "csharpier", version: "latest", description: "C# code formatter" },
  {
    name: "roslynator.dotnet.cli",
    version: "latest",
    description: "Roslyn-based analyzers",
  },
];

// Set this to true if you want to allow automatic installation of .NET SDK
const AUTO_INSTALL_ENABLED = true; // Can be controlled via environment variable

// Utility functions
function executeCommand(command, silent = false) {
  try {
    const options = { stdio: silent ? "pipe" : "inherit" };
    return execSync(command, options);
  } catch (error) {
    if (!silent) {
      console.error(`Error executing command: ${command}`);
      console.error(error.message);
    }
    return null;
  }
}

function checkNxDotNetPluginInstalled() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    );
    return (
      packageJson.devDependencies && packageJson.devDependencies["@nx/dotnet"]
    );
  } catch (error) {
    return false;
  }
}

function downloadFile(url, destinationPath) {
  console.log(`Downloading from ${url} to ${destinationPath}...`);
  try {
    // Use PowerShell to download the file on Windows
    if (isWindows) {
      const powershellCommand = `
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;
        Invoke-WebRequest -Uri "${url}" -OutFile "${destinationPath}"
      `;
      execSync(`powershell -Command "${powershellCommand}"`, {
        stdio: "inherit",
      });
      return true;
    } else {
      // For Unix systems use curl or wget
      const curlCommand = `curl -L "${url}" -o "${destinationPath}"`;
      execSync(curlCommand, { stdio: "inherit" });
      return true;
    }
  } catch (error) {
    console.error(`Failed to download file: ${error.message}`);
    return false;
  }
}

function installDotNetSdk() {
  console.log("\nAttempting to automatically install .NET SDK...");

  // Creating a temporary directory for the installer
  const tempDir = path.join(os.tmpdir(), "dotnet-installer");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Determine the correct installer URL based on OS
  let installerUrl, installerPath;
  const majorVersion = requiredDotNetVersion.split(".")[0];

  if (isWindows) {
    // Windows installer
    installerUrl = `https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0/dotnet-sdk-${requiredDotNetVersion}-win-x64.exe`;
    installerPath = path.join(tempDir, "dotnet-installer.exe");
  } else if (os.platform() === "darwin") {
    // macOS installer
    installerUrl = `https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0/dotnet-sdk-${requiredDotNetVersion}-osx-x64.pkg`;
    installerPath = path.join(tempDir, "dotnet-installer.pkg");
  } else {
    console.log(
      "Automatic installation is only supported on Windows and macOS.",
    );
    console.log("Please install manually following the instructions at:");
    console.log(
      `https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`,
    );
    return false;
  }

  // Download the installer
  if (!downloadFile(installerUrl, installerPath)) {
    console.error("Failed to download .NET SDK installer.");
    return false;
  }

  // Run the installer
  console.log("Running .NET SDK installer...");
  try {
    if (isWindows) {
      // Windows: run the installer silently
      execSync(`"${installerPath}" /install /quiet /norestart`, {
        stdio: "inherit",
      });

      // Set PATH environment variable to include .NET
      const dotnetPath = "C:\\Program Files\\dotnet";
      const currentPath = process.env.PATH || "";

      if (!currentPath.includes(dotnetPath)) {
        // Add to current process PATH
        process.env.PATH = `${dotnetPath};${currentPath}`;

        // Also attempt to permanently add to user PATH
        try {
          execSync(
            `powershell -Command "[Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'User') + ';${dotnetPath}', 'User')"`,
            { stdio: "inherit" },
          );
          console.log("Added .NET SDK to your PATH environment variable.");
        } catch (error) {
          console.warn(
            "Could not automatically update PATH environment variable.",
          );
          console.warn("You may need to add .NET SDK to your PATH manually.");
        }
      }
    } else if (os.platform() === "darwin") {
      // macOS: use installer command
      execSync(`sudo installer -pkg "${installerPath}" -target /`, {
        stdio: "inherit",
      });
    }

    console.log(".NET SDK installation completed.");

    // Clean up
    try {
      fs.unlinkSync(installerPath);
    } catch (error) {
      // Ignore cleanup errors
    }

    return true;
  } catch (error) {
    console.error(`Installation failed: ${error.message}`);
    console.log("Please try installing .NET SDK manually.");
    return false;
  }
}

// Function to list installed .NET SDKs
function listInstalledDotNetSdks() {
  try {
    console.log("\nChecking installed .NET SDKs...");
    const output = executeCommand("dotnet --list-sdks", true);
    if (output) {
      const sdks = output.toString().trim().split("\n");
      if (sdks.length > 0 && sdks[0] !== "") {
        console.log("Installed .NET SDKs:");
        sdks.forEach((sdk) => console.log(`  ${sdk}`));
        return sdks.map((sdk) => sdk.split(" ")[0].trim()); // Extract just the version numbers
      }
    }
    return [];
  } catch (error) {
    return [];
  }
}

// Functions for .NET tools installation
function installTool(tool) {
  console.log(`Installing ${tool.name}...`);
  const args = ["tool", "install", "--global", tool.name];

  if (tool.version && tool.version !== "latest") {
    args.push("--version", tool.version);
  }

  const result = spawnSync("dotnet", args, {
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.log(
      `Tool ${tool.name} may already be installed. Attempting to update...`,
    );
    updateTool(tool);
  } else {
    console.log(`✓ Installed ${tool.name} successfully.`);
  }
}

function updateTool(tool) {
  console.log(`Updating ${tool.name}...`);
  const result = spawnSync(
    "dotnet",
    ["tool", "update", "--global", tool.name],
    {
      encoding: "utf8",
      stdio: "inherit",
    },
  );

  if (result.status === 0) {
    console.log(`✓ Updated ${tool.name} successfully.`);
  } else {
    console.error(`✗ Failed to update ${tool.name}.`);
  }
}

function installDotNetTools() {
  console.log("\nSetting up .NET code quality tools...");

  // Install each tool
  for (const tool of commonTools) {
    installTool(tool);
  }

  console.log("\n✅ .NET code quality tools setup complete!");
  console.log("You can now use these tools in your .NET projects.");
}

// Main setup steps
async function setupDotNetEnvironment() {
  console.log("===== Setting up .NET development environment =====");

  // Step 1: Check for .NET SDK
  console.log("\nChecking for .NET SDK installation...");

  // Add diagnostic information to help troubleshoot
  console.log(`Operating System: ${os.platform()} (${os.release()})`);
  console.log(`Node.js Version: ${process.version}`);

  // Run dotnet --version directly for diagnostic purposes
  try {
    const dotnetVersionOutput = execSync("dotnet --version", { stdio: "pipe" });
    console.log(
      `Direct dotnet --version output: ${dotnetVersionOutput.toString().trim()}`,
    );

    // If we get here, .NET is definitely installed
    const dotnetVersion = dotnetVersionOutput.toString().trim();
    console.log(`Found .NET SDK version: ${dotnetVersion}`);

    // Check against required version - stricter check for major.minor version match
    const installedMajorMinor = dotnetVersion.split(".").slice(0, 2).join(".");
    const requiredMajorMinor = requiredDotNetVersion
      .split(".")
      .slice(0, 2)
      .join(".");

    if (dotnetVersion && installedMajorMinor !== requiredMajorMinor) {
      console.warn(
        `\nWARNING: Installed .NET SDK version (${dotnetVersion}) does not match the required version (${requiredDotNetVersion}).`,
      );

      // List all installed SDKs to see if the required one is available
      const installedSdks = listInstalledDotNetSdks();
      const hasRequiredSdk = installedSdks.some((sdk) =>
        sdk.startsWith(requiredMajorMinor),
      );

      if (hasRequiredSdk) {
        console.warn(
          "You have the required SDK installed, but it is not the default version.",
        );
        console.warn(
          "You can specify which version to use with global.json in your project.",
        );
      } else if (AUTO_INSTALL_ENABLED) {
        console.log(
          `\nAttempting to install required .NET SDK version: ${requiredDotNetVersion}`,
        );
        const installSuccess = installDotNetSdk();

        if (!installSuccess) {
          console.warn(
            "Failed to automatically install the required SDK version.",
          );
          console.warn(
            "Continuing with the current version, but you may encounter compatibility issues.",
          );
        } else {
          // Re-check the version after installation
          try {
            const newVersion = execSync("dotnet --version", { stdio: "pipe" })
              .toString()
              .trim();
            console.log(`Now using .NET SDK version: ${newVersion}`);
          } catch (e) {
            // Ignore errors
          }
        }
      } else {
        console.warn(
          "Consider installing the exact version specified for best compatibility.",
        );
      }
    }
  } catch (error) {
    console.error("ERROR: .NET SDK is not installed or not in PATH.");
    console.error(`Diagnostic information: ${error.message}`);

    // Try to get additional information about the environment
    console.log("\nEnvironment Path:");
    try {
      const pathVar = isWindows
        ? execSync("echo %PATH%", { stdio: "pipe" }).toString()
        : execSync("echo $PATH", { stdio: "pipe" }).toString();
      console.log(pathVar);
    } catch (e) {
      console.log("Unable to display PATH variable");
    }

    // If on Windows, check for common installation locations
    let dotnetFoundButNotInPath = false;
    if (isWindows) {
      console.log("\nChecking common .NET SDK installation locations...");
      const commonPaths = [
        "C:\\Program Files\\dotnet\\dotnet.exe",
        "C:\\Program Files (x86)\\dotnet\\dotnet.exe",
      ];

      for (const dotnetPath of commonPaths) {
        try {
          if (fs.existsSync(dotnetPath)) {
            console.log(`Found .NET SDK at: ${dotnetPath}`);
            dotnetFoundButNotInPath = true;

            // Try to automatically add to PATH for current process
            const pathDir = path.dirname(dotnetPath);
            process.env.PATH = `${pathDir};${process.env.PATH}`;
            console.log("Added to PATH for current process. Trying again...");

            try {
              const retryVersion = execSync("dotnet --version", {
                stdio: "pipe",
              })
                .toString()
                .trim();
              console.log(`Success! Found .NET SDK version: ${retryVersion}`);

              // Skip auto-install since we found it
              break;
            } catch (retryError) {
              console.log(
                "Still unable to run dotnet command. PATH update may require a restart.",
              );
            }
          }
        } catch (e) {
          // Ignore errors
        }
      }
    }

    if (AUTO_INSTALL_ENABLED && !dotnetFoundButNotInPath) {
      // Attempt automatic installation
      const installSuccess = installDotNetSdk();

      if (installSuccess) {
        // Check if installation succeeded by trying to run dotnet again
        try {
          const installedVersion = execSync("dotnet --version", {
            stdio: "pipe",
          })
            .toString()
            .trim();
          console.log(
            `\nSuccessfully installed .NET SDK version: ${installedVersion}`,
          );

          // List all installed SDKs
          listInstalledDotNetSdks();

          // Continue with the script since we now have .NET installed
        } catch (postInstallError) {
          console.error(
            "Installation appeared to succeed, but dotnet command still not available.",
          );
          console.error(
            "You may need to restart your terminal or computer before continuing.",
          );
          process.exit(1);
        }
      } else {
        // If auto-install failed, show manual instructions
        const majorVersion = requiredDotNetVersion.split(".")[0];
        console.log(
          `\nPlease install .NET SDK ${majorVersion}.0 or higher manually:`,
        );
        console.log(
          `  - Windows: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`,
        );
        console.log(
          `  - macOS/Linux: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`,
        );
        process.exit(1);
      }
    } else if (!AUTO_INSTALL_ENABLED) {
      // Auto-install is disabled, show manual instructions
      const majorVersion = requiredDotNetVersion.split(".")[0];
      console.log(`\nPlease install .NET SDK ${majorVersion}.0 or higher:`);
      console.log(
        `  - Windows: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`,
      );
      console.log(
        `  - macOS/Linux: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`,
      );
      process.exit(1);
    }
  }

  // Step 3: Check and install global tools if needed
  console.log("\nChecking for required .NET global tools...");

  if (skipTools) {
    console.log(
      "Skipping .NET global tools installation (--skip-tools option used).",
    );
  } else {
    try {
      // Install .NET tools directly
      installDotNetTools();
    } catch (error) {
      console.warn("Warning: Error while setting up .NET global tools.");
      console.warn(`Error details: ${error.message}`);
    }
  }

  // Step 4: Check for NX .NET plugin
  console.log("\nChecking for @nx/dotnet NX plugin...");
  if (!checkNxDotNetPluginInstalled()) {
    console.log("Installing @nx/dotnet NX plugin...");
    try {
      executeCommand("npm install --save-dev @nx/dotnet");
      console.log("@nx/dotnet NX plugin installed successfully");
    } catch (error) {
      console.error("Error installing @nx/dotnet plugin:");
      console.error(error.message);
      console.error(
        "You may need to install it manually with: npm install --save-dev @nx/dotnet",
      );
    }
  } else {
    console.log("@nx/dotnet NX plugin is already installed.");
  }

  // Step 5: Provide usage instructions
  console.log("\n===== .NET development environment setup completed =====");
  console.log("\nYou can now create .NET projects using Nx generators:");
  console.log("  npx nx generate @nx/dotnet:app my-api --directory=apps");
  console.log("  npx nx generate @nx/dotnet:lib my-lib --directory=libs");
  console.log("\nProjects will be automatically tagged when you run:");
  console.log("  npm run nx:reset     # Triggers auto-tagging");
  console.log("  npm run nx:tag-projects  # Manual tagging if needed");
}

// Run the setup
setupDotNetEnvironment().catch((error) => {
  console.error("Error during setup:", error);
  process.exit(1);
});
