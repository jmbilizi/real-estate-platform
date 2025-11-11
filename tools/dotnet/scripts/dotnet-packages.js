/**
 * .NET Package Management Script
 *
 * This script helps with managing NuGet packages in .NET projects:
 * - Install packages to a specific project
 * - Install packages to all projects
 * - Update packages across projects
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

// Constants
const USAGE = `
.NET Package Manager
-------------------
Usage: node dotnet-packages.js <command> [options]

Commands:
  install <package> [project]    Install a NuGet package to a specific project or all projects
  list [project]                 List installed NuGet packages for a project or all projects
  update <package> [project]     Update a NuGet package for a specific project or all projects
  help                           Show this help message

Options:
  --version <version>            Specify package version (for install command)
  --all                          Apply to all .NET projects (default if no project specified)
  --preview                      Include preview versions (for update command)
  --exact                        Use exact version match

Examples:
  node dotnet-packages.js install Newtonsoft.Json my-api
  node dotnet-packages.js install Microsoft.EntityFrameworkCore --version 8.0.0 --all
  node dotnet-packages.js list my-api
  node dotnet-packages.js update Newtonsoft.Json --all

Note: When using --all, the package is installed to all .NET projects using the version 
specified in Directory.Packages.props (Central Package Management).
`;

// Command line argument parsing
const args = process.argv.slice(2);
if (
  args.length === 0 ||
  args[0] === "help" ||
  args[0] === "--help" ||
  args[0] === "-h"
) {
  console.log(USAGE);
  process.exit(0);
}

// Check if we're running on Windows
const isWindows = os.platform() === "win32";

// Parse command line arguments
const command = args[0];
let packageName = "";
let projectName = "";
let version = "";
let all = false;
let preview = false;
let exact = false;

// Process additional arguments
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--all") {
    all = true;
  } else if (args[i] === "--preview") {
    preview = true;
  } else if (args[i] === "--exact") {
    exact = true;
  } else if (args[i] === "--version" && i + 1 < args.length) {
    version = args[i + 1];
    i++; // Skip the next argument (version value)
  } else if (!packageName && ["install", "update"].includes(command)) {
    packageName = args[i];
  } else if (!projectName) {
    projectName = args[i];
  }
}

// If no project is specified, apply to all projects
if (!projectName) {
  all = true;
}

// Helper functions
function findDotNetProjects() {
  const projects = [];

  // Helper function to recursively search for .csproj files
  function searchDirectory(dir) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dir, item.name);

        // Skip certain directories
        if (
          item.isDirectory() &&
          !item.name.startsWith(".") &&
          item.name !== "node_modules" &&
          item.name !== "bin" &&
          item.name !== "obj"
        ) {
          searchDirectory(fullPath);
        } else if (item.isFile() && item.name.endsWith(".csproj")) {
          // Extract project name from file name
          const projectNameFromFile = item.name.replace(".csproj", "");

          // Get project.json file to find NX project name
          const projectDir = path.dirname(fullPath);
          let nxProjectName = projectNameFromFile;

          const projectJsonPath = path.join(projectDir, "project.json");
          if (fs.existsSync(projectJsonPath)) {
            try {
              const projectJson = JSON.parse(
                fs.readFileSync(projectJsonPath, "utf8"),
              );
              if (projectJson.name) {
                nxProjectName = projectJson.name;
              }
            } catch (err) {
              // If there's an error reading project.json, just use the file name
            }
          }

          projects.push({
            projectName: nxProjectName,
            projectFile: fullPath,
            projectDir: projectDir,
          });
        }
      }
    } catch (err) {
      console.error(`Error searching directory ${dir}:`, err);
    }
  }

  // Start searching from apps and libs directories
  ["apps", "libs"].forEach((rootDir) => {
    const dir = path.join(process.cwd(), rootDir);
    if (fs.existsSync(dir)) {
      searchDirectory(dir);
    }
  });

  return projects;
}

function runDotNetCommand(
  command,
  projectFile,
  packageName,
  version,
  flags = [],
) {
  const versionArg = version ? `--version ${version}` : "";
  const flagsArg = flags.join(" ");

  const fullCommand =
    `dotnet ${command} "${projectFile}" ${packageName} ${versionArg} ${flagsArg}`.trim();
  console.log(`Executing: ${fullCommand}`);

  try {
    const output = execSync(fullCommand, { encoding: "utf8" });
    console.log(output);
    return true;
  } catch (error) {
    console.error(`Error executing command: ${fullCommand}`);
    console.error(error.message);
    return false;
  }
}

function updateDirectoryPackagesProps(packageName, version) {
  // This function updates or adds a package to Directory.Packages.props
  const configsDir = path.join(process.cwd(), "tools", "dotnet", "configs");
  const packagePropsPath = path.join(configsDir, "Directory.Packages.props");

  if (!fs.existsSync(packagePropsPath)) {
    console.error(
      `Error: Directory.Packages.props not found at ${packagePropsPath}`,
    );
    return false;
  }

  let content = fs.readFileSync(packagePropsPath, "utf8");

  // Check if package already exists
  const packageRegex = new RegExp(
    `<PackageVersion\\s+Include="${packageName}"\\s+Version="[^"]+"`,
  );

  if (packageRegex.test(content)) {
    // Update existing package
    content = content.replace(
      new RegExp(
        `(<PackageVersion\\s+Include="${packageName}"\\s+Version=")[^"]+(")`,
        "g",
      ),
      `$1${version}$2`,
    );
  } else {
    // Add new package
    const insertionPoint = content.lastIndexOf("</ItemGroup>");
    if (insertionPoint !== -1) {
      const newPackage = `    <PackageVersion Include="${packageName}" Version="${version}" />\n`;
      content =
        content.slice(0, insertionPoint) +
        newPackage +
        content.slice(insertionPoint);
    } else {
      console.error(
        `Error: Could not find insertion point in Directory.Packages.props`,
      );
      return false;
    }
  }

  // Write updated content back to file (preserve encoding and line endings)
  try {
    // Read original file to detect BOM and line endings
    const originalBuffer = fs.readFileSync(packagePropsPath);
    const hasBOM =
      originalBuffer.length >= 3 &&
      originalBuffer[0] === 0xef &&
      originalBuffer[1] === 0xbb &&
      originalBuffer[2] === 0xbf;

    // Detect line ending style from content
    const hasCRLF = content.includes("\r\n");
    const lineEnding = hasCRLF ? "\r\n" : "\n";

    // Normalize line endings to match original
    if (hasCRLF) {
      content = content.replace(/\r?\n/g, "\r\n");
    } else {
      content = content.replace(/\r\n/g, "\n");
    }

    // Write with same BOM state as original
    const outputBuffer = hasBOM
      ? Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(content, "utf8"),
        ])
      : Buffer.from(content, "utf8");

    fs.writeFileSync(packagePropsPath, outputBuffer);
    console.log(
      `Updated ${packageName} to version ${version} in Directory.Packages.props`,
    );
    return true;
  } catch (error) {
    console.error(`Error updating Directory.Packages.props:`, error);
    return false;
  }
}

// Main functionality
async function main() {
  try {
    switch (command) {
      case "install": {
        if (!packageName) {
          console.error("Error: No package specified for install command");
          console.log(USAGE);
          process.exit(1);
        }

        if (all) {
          // When installing to all projects, update Directory.Packages.props
          if (version) {
            if (updateDirectoryPackagesProps(packageName, version)) {
              console.log(
                `✅ Added ${packageName} (${version}) to central package management`,
              );
            }
          } else {
            console.log(
              "⚠️ Warning: No version specified for centrally managed package",
            );
            console.log(
              "Using latest version (not recommended for production)",
            );
          }

          // Find all .NET projects
          const projects = findDotNetProjects();
          console.log(`Found ${projects.length} .NET projects`);

          // Install package to each project (without specifying version)
          let successCount = 0;
          for (const project of projects) {
            console.log(
              `\nInstalling ${packageName} to ${project.projectName}...`,
            );
            if (
              runDotNetCommand(
                "add",
                project.projectFile,
                "package",
                packageName,
              )
            ) {
              successCount++;
            }
          }

          console.log(
            `\n✅ Installed ${packageName} to ${successCount}/${projects.length} projects`,
          );
        } else {
          // Installing to a specific project
          const projects = findDotNetProjects();
          const project = projects.find((p) => p.projectName === projectName);

          if (!project) {
            console.error(`Error: Project '${projectName}' not found`);
            console.log("Available projects:");
            projects.forEach((p) => console.log(`  - ${p.projectName}`));
            process.exit(1);
          }

          console.log(`Installing ${packageName} to ${projectName}...`);
          const versionFlag = version ? `--version ${version}` : "";
          if (
            runDotNetCommand(
              "add",
              project.projectFile,
              "package",
              packageName,
              version ? ["--version", version] : [],
            )
          ) {
            console.log(`✅ Installed ${packageName} to ${projectName}`);

            // If a version was specified, also update Directory.Packages.props
            if (version) {
              updateDirectoryPackagesProps(packageName, version);
            }
          }
        }
        break;
      }

      case "list": {
        const projects = findDotNetProjects();

        if (all) {
          console.log(
            `Listing packages for all ${projects.length} .NET projects:`,
          );
          for (const project of projects) {
            console.log(
              `\n📦 ${project.projectName} (${path.basename(project.projectFile)}):`,
            );
            try {
              const output = execSync(
                `dotnet list "${project.projectFile}" package`,
                {
                  encoding: "utf8",
                },
              );
              console.log(output);
            } catch (error) {
              console.error(
                `Error listing packages for ${project.projectName}:`,
                error.message,
              );
            }
          }
        } else {
          const project = projects.find((p) => p.projectName === projectName);

          if (!project) {
            console.error(`Error: Project '${projectName}' not found`);
            console.log("Available projects:");
            projects.forEach((p) => console.log(`  - ${p.projectName}`));
            process.exit(1);
          }

          console.log(
            `📦 Packages for ${projectName} (${path.basename(project.projectFile)}):`,
          );
          try {
            const output = execSync(
              `dotnet list "${project.projectFile}" package`,
              {
                encoding: "utf8",
              },
            );
            console.log(output);
          } catch (error) {
            console.error(
              `Error listing packages for ${projectName}:`,
              error.message,
            );
          }
        }
        break;
      }

      case "update": {
        if (!packageName) {
          console.error("Error: No package specified for update command");
          console.log(USAGE);
          process.exit(1);
        }

        if (all) {
          // Check for the latest version of the package
          console.log(`Checking for updates to ${packageName}...`);
          let latestVersion;

          try {
            const previewFlag = preview ? "--prerelease" : "";
            const output = execSync(
              `dotnet nuget list package ${packageName} ${previewFlag}`,
              {
                encoding: "utf8",
              },
            );
            const versionMatch = output.match(/Latest Version:\s+([^\s]+)/);

            if (versionMatch && versionMatch[1]) {
              latestVersion = versionMatch[1];
              console.log(`Latest version of ${packageName}: ${latestVersion}`);

              // Update Directory.Packages.props with the latest version
              if (updateDirectoryPackagesProps(packageName, latestVersion)) {
                console.log(
                  `✅ Updated ${packageName} to version ${latestVersion} in central package management`,
                );
              }
            } else {
              console.error(
                `Error: Could not determine latest version of ${packageName}`,
              );
              process.exit(1);
            }
          } catch (error) {
            console.error(
              `Error checking for updates to ${packageName}:`,
              error.message,
            );
            process.exit(1);
          }

          console.log(
            "\n🔄 Central package version updated. Run the following to update projects:",
          );
          console.log(`dotnet restore`);
        } else {
          // Update a specific project
          const projects = findDotNetProjects();
          const project = projects.find((p) => p.projectName === projectName);

          if (!project) {
            console.error(`Error: Project '${projectName}' not found`);
            console.log("Available projects:");
            projects.forEach((p) => console.log(`  - ${p.projectName}`));
            process.exit(1);
          }

          const flags = [];
          if (preview) flags.push("--prerelease");
          if (exact) flags.push("--exact");

          console.log(`Updating ${packageName} in ${projectName}...`);
          if (
            runDotNetCommand(
              "update",
              project.projectFile,
              "package",
              packageName,
              flags,
            )
          ) {
            console.log(`✅ Updated ${packageName} in ${projectName}`);
          }
        }
        break;
      }

      default:
        console.error(`Error: Unknown command '${command}'`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Run the main function
main();
