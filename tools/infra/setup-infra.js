#!/usr/bin/env node

/**
 * Infrastructure Development Setup Script
 *
 * Installs required infrastructure tools (Kustomize, kubectl) for local development
 * and CI/CD validation.
 *
 * Usage:
 *   npm run infra:setup
 *   node tools/infra/setup-infra.js
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step) {
  log(`\n${"=".repeat(80)}`, "cyan");
  log(`  ${step}`, "bright");
  log("=".repeat(80), "cyan");
}

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logError(message) {
  log(`✗ ${message}`, "red");
}

function logWarning(message) {
  log(`⚠ ${message}`, "yellow");
}

function run(command, options = {}) {
  try {
    const result = execSync(command, {
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf-8",
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error, output: error.stdout || error.stderr };
  }
}

function checkKustomize() {
  const result = run("kustomize version", { silent: true });
  if (result.success) {
    const version = result.output.match(/v[\d.]+/)?.[0] || "unknown";
    logSuccess(`Kustomize already installed: ${version}`);
    return true;
  }
  return false;
}

function addToPath(binDir) {
  const isWindows = os.platform() === "win32";

  if (isWindows) {
    try {
      log("Adding to Windows PATH...", "blue");

      // Normalize path for comparison (lowercase, no trailing slash)
      const normalizedBinDir = binDir.toLowerCase().replace(/[\\\/]+$/, "");

      // Check if already in PATH
      const { spawnSync } = require("child_process");
      const currentPathResult = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[System.Environment]::GetEnvironmentVariable('PATH', 'User')",
        ],
        { encoding: "utf8" },
      );

      if (currentPathResult.status !== 0) {
        logWarning("Failed to read current PATH");
        return false;
      }

      const currentPath = currentPathResult.stdout.trim();

      // Split and normalize existing paths for comparison
      const existingPaths = currentPath
        .split(";")
        .map((p) =>
          p
            .trim()
            .toLowerCase()
            .replace(/[\\\/]+$/, ""),
        )
        .filter((p) => p.length > 0);

      if (existingPaths.includes(normalizedBinDir)) {
        logSuccess("Already in PATH");
        refreshPath();
        return true;
      }

      // Add to User PATH (permanent)
      const setPathResult = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `[System.Environment]::SetEnvironmentVariable('PATH', '${binDir};' + [System.Environment]::GetEnvironmentVariable('PATH', 'User'), 'User')`,
        ],
        { stdio: "inherit" },
      );

      if (setPathResult.status !== 0) {
        throw new Error("Failed to set PATH variable");
      }

      logSuccess("Added to Windows User PATH (permanent)");

      // Refresh PATH for current process
      refreshPath();

      return true;
    } catch (error) {
      logWarning(`Failed to add to PATH automatically: ${error.message}`);
      logWarning(
        `Manually add "${binDir}" to your System Environment Variables`,
      );
      return false;
    }
  } else {
    // Unix systems
    const shellProfile = process.env.SHELL?.includes("zsh")
      ? path.join(os.homedir(), ".zshrc")
      : path.join(os.homedir(), ".bashrc");

    try {
      const exportLine = `export PATH="${binDir}:$PATH"`;

      // Check if already in profile
      if (fs.existsSync(shellProfile)) {
        const content = fs.readFileSync(shellProfile, "utf8");
        if (content.includes(exportLine) || content.includes(binDir)) {
          logSuccess("Already in shell profile");
          return true;
        }
      }

      // Add to shell profile
      fs.appendFileSync(shellProfile, `\n# Kustomize\n${exportLine}\n`);
      logSuccess(`Added to ${shellProfile}`);
      logWarning("Run: source " + shellProfile + " (or restart terminal)");

      return true;
    } catch (error) {
      logWarning(`Failed to add to shell profile: ${error.message}`);
      logWarning(`Manually add: export PATH="${binDir}:$PATH"`);
      return false;
    }
  }
}

function refreshPath() {
  if (os.platform() !== "win32") {
    return;
  }

  try {
    // Refresh PATH from registry (Windows)
    const { spawnSync } = require("child_process");
    const refreshPathCmd =
      "[System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH', 'User')";

    const result = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", refreshPathCmd],
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );

    if (result.status === 0 && result.stdout) {
      const newPath = result.stdout.trim();
      process.env.PATH = newPath;
      logSuccess("PATH refreshed - Kustomize is now available in this session");
    }
  } catch (error) {
    logWarning(`Failed to refresh PATH: ${error.message}`);
  }
}

function getLatestKustomizeVersion() {
  try {
    // Try to get latest version from GitHub API
    const result = run(
      'curl -s "https://api.github.com/repos/kubernetes-sigs/kustomize/releases" | findstr /C:"\\"tag_name\\"" | findstr /C:"kustomize/v" | findstr /V /C:"alpha" | findstr /V /C:"beta"',
      { silent: true },
    );

    if (result.success && result.output) {
      const match = result.output.match(/kustomize\/(v[\d.]+)/);
      if (match) {
        return match[1];
      }
    }
  } catch (error) {
    // Fallback to known stable version
  }
  return "v5.5.0"; // Fallback to known stable version
}

function installKustomize() {
  logStep("Installing Kustomize");

  // Check if already installed and in PATH
  if (checkKustomize()) {
    return true;
  }

  const platform = os.platform();
  const arch = os.arch();
  const binDir =
    platform === "win32"
      ? path.join(os.homedir(), ".local", "bin")
      : path.join(os.homedir(), ".local", "bin");
  const binaryName = platform === "win32" ? "kustomize.exe" : "kustomize";
  const binaryPath = path.join(binDir, binaryName);

  // Check if binary exists but not in PATH
  if (fs.existsSync(binaryPath)) {
    log("Kustomize binary found but not in PATH", "yellow");
    addToPath(binDir);

    // Verify it's now accessible
    if (checkKustomize()) {
      return true;
    }
  }

  // Download and install
  const version = getLatestKustomizeVersion();

  // Determine platform-specific download URL
  let downloadUrl;
  let isZip = false;

  if (platform === "win32") {
    downloadUrl = `https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2F${version}/kustomize_${version}_windows_amd64.zip`;
    isZip = true;
  } else if (platform === "darwin") {
    const macArch = arch === "arm64" ? "arm64" : "amd64";
    downloadUrl = `https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2F${version}/kustomize_${version}_darwin_${macArch}.tar.gz`;
  } else {
    // Linux
    const linuxArch = arch === "arm64" ? "arm64" : "amd64";
    downloadUrl = `https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2F${version}/kustomize_${version}_linux_${linuxArch}.tar.gz`;
  }

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
    logSuccess(`Created ${binDir}`);
  }

  const tempDir = path.join(binDir, "kustomize-temp");
  const archiveFile = isZip
    ? path.join(binDir, "kustomize.zip")
    : path.join(binDir, "kustomize.tar.gz");

  try {
    log(`Downloading Kustomize ${version} for ${platform}...`, "blue");

    // Download the archive
    const downloadCmd = `curl -L -o "${archiveFile}" "${downloadUrl}"`;
    const downloadResult = run(downloadCmd, { silent: true });
    if (!downloadResult.success) {
      throw new Error("Download failed");
    }

    logSuccess("Download completed");

    // Extract the archive
    log("Extracting...", "blue");

    // Create temp directory for extraction
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let extractResult;
    if (isZip) {
      // Windows: use PowerShell's Expand-Archive
      const extractCmd = `powershell -Command "Expand-Archive -Path '${archiveFile}' -DestinationPath '${tempDir}' -Force"`;
      extractResult = run(extractCmd, { silent: true });
    } else {
      // Unix: use tar
      const extractCmd = `tar -xzf "${archiveFile}" -C "${tempDir}"`;
      extractResult = run(extractCmd, { silent: true });
    }

    if (!extractResult.success) {
      throw new Error("Extraction failed");
    }

    // Move binary to bin directory
    const extractedBinary = path.join(tempDir, binaryName);
    if (fs.existsSync(extractedBinary)) {
      fs.renameSync(extractedBinary, binaryPath);

      // Make executable on Unix systems
      if (platform !== "win32") {
        fs.chmodSync(binaryPath, "755");
      }

      logSuccess(`Kustomize installed to ${binaryPath}`);
    } else {
      throw new Error("Binary not found in extracted files");
    }

    // Clean up
    fs.unlinkSync(archiveFile);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Add to PATH
    addToPath(binDir);

    // Verify installation
    if (checkKustomize()) {
      return true;
    }

    // If still not accessible, provide manual instructions
    if (platform === "win32") {
      logWarning("Kustomize installed but not yet in PATH");
      logWarning("Restart your terminal or run: refreshenv");
    }

    return true;
  } catch (error) {
    logError(`Failed to install Kustomize: ${error.message}`);

    // Clean up on failure
    if (fs.existsSync(archiveFile)) {
      fs.unlinkSync(archiveFile);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    logWarning("Fallback: Install manually");
    logWarning("Windows: choco install kustomize");
    logWarning("macOS: brew install kustomize");
    logWarning(
      `Linux/Manual: Download from https://github.com/kubernetes-sigs/kustomize/releases/tag/kustomize%2F${version}`,
    );

    return false;
  }
}

function checkKubectl() {
  const result = run("kubectl version --client", { silent: true });
  if (result.success) {
    const version = result.output.match(/v[\d.]+/)?.[0] || "unknown";
    logSuccess(`kubectl already installed: ${version}`);
    return true;
  }
  return false;
}

function installKubectl() {
  logStep("Installing kubectl (optional - for dry-run validation)");

  if (checkKubectl()) {
    return true;
  }

  logWarning("kubectl not found - install for advanced validation");
  logWarning("Windows: choco install kubernetes-cli");
  logWarning("macOS: brew install kubectl");
  logWarning("Linux: https://kubernetes.io/docs/tasks/tools/");

  return false;
}

function main() {
  logStep("Infrastructure Development Setup");

  log(
    "\nThis script installs tools for Kubernetes infrastructure development:",
    "blue",
  );
  log("  • Kustomize - Kubernetes manifest templating", "blue");
  log(
    "  • kubectl (optional) - Kubernetes CLI for dry-run validation\n",
    "blue",
  );

  const kustomizeInstalled = installKustomize();
  const kubectlInstalled = installKubectl();

  logStep("Setup Summary");

  if (kustomizeInstalled) {
    logSuccess("Kustomize is ready");
  } else {
    logError("Kustomize installation failed - manual installation required");
  }

  if (kubectlInstalled) {
    logSuccess("kubectl is ready (optional)");
  } else {
    logWarning(
      "kubectl not installed (optional - skip if you don't need dry-run validation)",
    );
  }

  logStep("Next Steps");

  log("\n1. Validate Kustomize files:", "cyan");
  log("   npm run infra:validate", "bright");

  log("\n2. Build manifests for local testing:", "cyan");
  log(
    "   kustomize build infra/k8s/{provider}/{env} --enable-alpha-plugins",
    "bright",
  );
  log(
    "   Example: kustomize build infra/k8s/hetzner/dev --enable-alpha-plugins",
    "blue",
  );

  log(
    "\n3. Git hooks will automatically validate Kustomize files on commit/push\n",
    "cyan",
  );

  if (!kustomizeInstalled && os.platform() === "win32") {
    log(
      "\n⚠ Windows users: Install Kustomize manually and re-run this script\n",
      "yellow",
    );
    process.exit(1);
  }

  process.exit(kustomizeInstalled ? 0 : 1);
}

main();
