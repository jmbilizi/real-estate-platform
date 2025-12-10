#!/usr/bin/env node

/**
 * Podman Desktop & Local Cluster Setup Script
 *
 * Cross-platform automated setup for local Kubernetes development with Podman + Minikube.
 * Uses Minikube with Podman driver for reliable local Kubernetes clusters.
 *
 * What it does:
 * 1. Checks if Podman Desktop is installed
 * 2. Installs Podman Desktop if missing (using platform-specific package managers)
 * 3. Checks if Minikube is installed
 * 4. Installs Minikube if missing (using platform-specific package managers)
 * 5. Validates Podman machine health and applies registry configuration
 * 6. Creates or repairs Minikube cluster:
 *    - Creates new cluster if doesn't exist
 *    - Repairs cluster if corrupted (restarts containers, fixes config)
 *    - Auto-recovers cluster after computer restart
 * 7. Optionally applies local infrastructure resources
 *
 * Features:
 *   - 100% open-source stack (Podman + Minikube)
 *   - Multi-node cluster support (configurable)
 *   - Intelligent cluster repair (no data loss)
 *   - Automatic post-restart recovery
 *   - Cross-platform support (Windows, macOS, Linux)
 *
 * Configuration:
 *   Edit CLUSTER_CONFIG to adjust:
 *   - Number of nodes (1 = single, 2+ = control-plane + workers)
 *   - Resources per node (CPU, memory, disk)
 *   - Kubernetes version
 *
 * Usage:
 *   npm run infra:local:cluster:setup              # Setup only (no resource deployment)
 *   npm run infra:local:cluster:setup -- --apply   # Setup + deploy resources
 */

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const yaml = require("js-yaml");
// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Simple YAML parser for cluster config
 * Supports basic YAML features needed for our config file
 */
function parseYamlConfig(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const config = {};
  let currentSection = config;
  let sectionStack = [];
  let currentKey = null;

  const lines = content.split("\n");

  for (let line of lines) {
    // Skip comments and empty lines
    if (
      line.trim().startsWith("#") ||
      line.trim() === "" ||
      line.trim().startsWith("---")
    ) {
      continue;
    }

    // Calculate indentation level
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Handle key-value pairs
    if (trimmed.includes(":")) {
      const [key, ...valueParts] = trimmed.split(":");
      const value = valueParts.join(":").trim();

      // If value is empty, this is a nested section
      if (value === "") {
        // Adjust section stack based on indentation
        while (
          sectionStack.length > 0 &&
          sectionStack[sectionStack.length - 1].indent >= indent
        ) {
          sectionStack.pop();
        }

        // Create new section
        const newSection = {};
        if (sectionStack.length === 0) {
          config[key] = newSection;
        } else {
          sectionStack[sectionStack.length - 1].section[key] = newSection;
        }

        sectionStack.push({ section: newSection, indent, key });
        currentSection = newSection;
        currentKey = key;
      } else {
        // Parse value
        let parsedValue = value;

        // Handle numbers
        if (/^\d+$/.test(value)) {
          parsedValue = parseInt(value, 10);
        } else if (/^\d+\.\d+$/.test(value)) {
          parsedValue = parseFloat(value);
        }
        // Handle booleans
        else if (value === "true") {
          parsedValue = true;
        } else if (value === "false") {
          parsedValue = false;
        }

        // Set value in appropriate section
        if (sectionStack.length === 0) {
          config[key] = parsedValue;
        } else {
          sectionStack[sectionStack.length - 1].section[key] = parsedValue;
        }
      }
    }
    // Handle list items
    else if (trimmed.startsWith("- ")) {
      const value = trimmed.substring(2).trim();

      // Ensure current section has an array for this key
      if (currentKey && !Array.isArray(currentSection[currentKey])) {
        currentSection[currentKey] = [];
      }

      if (currentKey) {
        currentSection[currentKey].push(value);
      }
    }
  }

  return config;
}

/**
 * Load cluster configuration from YAML file
 */

function validateClusterConfig(rawConfig) {
  // Helper for error reporting
  function fail(msg) {
    throw new Error(`CLUSTER CONFIG ERROR: ${msg}`);
  }

  // Validate minimal, user-friendly config fields
  if (!rawConfig.cluster_name || typeof rawConfig.cluster_name !== "string") {
    fail("'cluster_name' is required and must be a string.");
  }
  if (typeof rawConfig.nodes !== "number" || rawConfig.nodes < 1) {
    fail("'nodes' is required and must be a positive integer.");
  }
  if (!rawConfig.resources || typeof rawConfig.resources !== "object") {
    fail("'resources' section is required and must be an object.");
  }
  if (
    typeof rawConfig.resources.cpus !== "number" ||
    rawConfig.resources.cpus < 1
  ) {
    fail("'resources.cpus' is required and must be a positive integer.");
  }
  if (
    typeof rawConfig.resources.memory !== "number" ||
    rawConfig.resources.memory < 256
  ) {
    fail("'resources.memory' is required and must be a number (MB, >=256).");
  }
  if (
    !rawConfig.resources.disk ||
    typeof rawConfig.resources.disk !== "string"
  ) {
    fail("'resources.disk' is required and must be a string (e.g., '20g').");
  }
  if (
    !rawConfig.kubernetes_version ||
    typeof rawConfig.kubernetes_version !== "string"
  ) {
    fail("'kubernetes_version' is required and must be a string.");
  }
  if (rawConfig.registries && rawConfig.registries.insecure) {
    if (!Array.isArray(rawConfig.registries.insecure)) {
      fail("'registries.insecure' must be an array if present.");
    }
    // Validate each entry is a non-empty string and a valid hostname (basic check)
    for (const reg of rawConfig.registries.insecure) {
      if (typeof reg !== "string" || !reg.trim()) {
        fail(
          `'registries.insecure' contains a non-string or empty value: ${JSON.stringify(reg)}`
        );
      }
      // Basic hostname/registry format: must not contain spaces, must have at least one dot
      if (!/^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(:[0-9]+)?$/.test(reg.trim())) {
        fail(
          `'registries.insecure' contains an invalid registry hostname: ${reg}`
        );
      }
    }
  }
}

function loadClusterConfig() {
  const configPath = path.resolve(
    __dirname,
    "../../infra/k8s/podman/local/cluster/cluster-config.yaml"
  );
  if (!fs.existsSync(configPath)) {
    logError(
      `ERROR: cluster-config.yaml not found at ${configPath}. Please ensure your local cluster config exists and is named correctly.`
    );
    process.exit(1);
  }
  let rawConfig;
  try {
    rawConfig = yaml.load(fs.readFileSync(configPath, "utf8"));
    validateClusterConfig(rawConfig);
  } catch (error) {
    logError(
      `ERROR: Failed to parse or validate cluster-config.yaml: ${error.message}`
    );
    process.exit(1);
  }
  // All fields are validated, so no fallback/defaults
  return {
    clusterName: rawConfig.cluster_name,
    nodes: rawConfig.nodes,
    cpus: rawConfig.resources.cpus,
    memory: rawConfig.resources.memory,
    diskSize: rawConfig.resources.disk,
    kubernetesVersion: rawConfig.kubernetes_version,
    driver: rawConfig.driver,
    containerRuntime: "containerd",
    createTimeout: "5m0s",
    restartTimeout: "3m0s",
    waitFor: "apiserver",
    podmanMachine: {
      totalCpus: 4,
      totalMemory: 8192,
    },
    insecureRegistries: rawConfig.registries?.insecure || [
      "gcr.io",
      "docker.io",
      "registry.k8s.io",
      "ghcr.io",
    ],
  };
}

// Default config for fallback

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

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logError(message) {
  log(`✗ ${message}`, "red");
}

function logWarning(message) {
  log(`⚠ ${message}`, "yellow");
}

function logInfo(message) {
  log(`ℹ ${message}`, "cyan");
}

// Load configuration
const CLUSTER_CONFIG = loadClusterConfig();

// Calculate total resources
const TOTAL_RESOURCES = {
  cpus: CLUSTER_CONFIG.nodes * CLUSTER_CONFIG.cpus,
  memory: CLUSTER_CONFIG.nodes * CLUSTER_CONFIG.memory,
};

function run(command, options = {}) {
  try {
    const result = execSync(command, {
      cwd: path.resolve(__dirname, "../.."),
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf-8",
      shell: true,
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return {
      success: false,
      error,
      output: error.stdout || error.stderr || error.message,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Platform Detection
// ============================================================================

function getPlatform() {
  const platform = os.platform();
  const arch = os.arch();
  return {
    platform,
    arch,
    isWindows: platform === "win32",
    isMac: platform === "darwin",
    isLinux: platform === "linux",
  };
}

// ============================================================================
// Installation Checks
// ============================================================================

function isPodmanInstalled() {
  const result = run("podman --version", { silent: true });
  return result.success;
}

function isMinikubeInstalled() {
  const result = run("minikube version", { silent: true });
  return result.success;
}

function isPodmanDesktopInstalled() {
  const { platform } = getPlatform();

  if (platform === "win32") {
    const checkPaths = [
      "C:\\Program Files\\Podman Desktop\\Podman Desktop.exe",
      `${process.env.LOCALAPPDATA}\\Programs\\Podman Desktop\\Podman Desktop.exe`,
    ];

    for (const checkPath of checkPaths) {
      if (fs.existsSync(checkPath)) {
        return true;
      }
    }
  }

  if (platform === "darwin") {
    const result = run("test -d /Applications/Podman\\ Desktop.app", {
      silent: true,
    });
    return result.success;
  }

  if (platform === "linux") {
    const result = run("which podman-desktop", { silent: true });
    return result.success;
  }

  return false;
}

// ============================================================================
// Podman Desktop Installation
// ============================================================================

function installPodmanDesktop() {
  const { platform, isWindows, isMac, isLinux } = getPlatform();

  log("\n📦 Installing Podman Desktop...\n", "bright");

  if (isWindows) {
    return installPodmanWindows();
  } else if (isMac) {
    return installPodmanMac();
  } else if (isLinux) {
    return installPodmanLinux();
  } else {
    logError(`Unsupported platform: ${platform}`);
    return false;
  }
}

function installPodmanWindows() {
  logInfo("Detected: Windows");

  logInfo("Attempting installation via winget...");
  const wingetResult = run(
    "winget install -e --id RedHat.Podman-Desktop --silent --accept-package-agreements --accept-source-agreements",
    { silent: false }
  );

  if (wingetResult.success) {
    logSuccess("Podman Desktop installed via winget");
    return true;
  }

  logWarning("Winget installation failed, trying Chocolatey...");

  const chocoCheck = run("choco --version", { silent: true });
  if (chocoCheck.success) {
    const chocoResult = run(
      "choco install podman-desktop -y --yes --no-progress",
      { silent: false }
    );
    if (chocoResult.success) {
      logSuccess("Podman Desktop installed via Chocolatey");
      return true;
    }
  }

  logError("Automatic installation failed");
  logWarning(
    "Please install Podman Desktop manually from: https://podman-desktop.io/downloads"
  );
  return false;
}

function installPodmanMac() {
  logInfo("Detected: macOS");

  const brewCheck = run("which brew", { silent: true });
  if (!brewCheck.success) {
    logError("Homebrew not found");
    logWarning("Please install Homebrew from: https://brew.sh/");
    return false;
  }

  logInfo("Installing Podman Desktop via Homebrew...");
  const result = run("brew install --cask podman-desktop", { silent: false });

  if (result.success) {
    logSuccess("Podman Desktop installed via Homebrew");
    return true;
  } else {
    logError("Homebrew installation failed");
    return false;
  }
}

function installPodmanLinux() {
  logInfo("Detected: Linux");

  const osRelease = run("cat /etc/os-release", { silent: true });
  let distro = "unknown";

  if (osRelease.success) {
    if (
      osRelease.output.includes("Ubuntu") ||
      osRelease.output.includes("Debian")
    ) {
      distro = "debian";
    } else if (osRelease.output.includes("Fedora")) {
      distro = "fedora";
    } else if (osRelease.output.includes("Arch")) {
      distro = "arch";
    }
  }

  logInfo(`Installing Podman Desktop for ${distro}...`);

  if (distro === "debian") {
    const flatpakCheck = run("which flatpak", { silent: true });
    if (flatpakCheck.success) {
      run("flatpak install -y flathub io.podman_desktop.PodmanDesktop", {
        silent: false,
      });
      return true;
    } else {
      logWarning("Flatpak not found. Installing Flatpak first...");
      run("sudo apt-get update && sudo apt-get install -y flatpak", {
        silent: false,
      });
      run(
        "flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo",
        { silent: false }
      );
      run("flatpak install -y flathub io.podman_desktop.PodmanDesktop", {
        silent: false,
      });
      return true;
    }
  } else if (distro === "fedora") {
    run("sudo dnf install -y podman-desktop", { silent: false });
    return true;
  } else if (distro === "arch") {
    run("yay -S podman-desktop", { silent: false });
    return true;
  }

  logWarning("Automatic installation not available for your distribution");
  return false;
}

// ============================================================================
// Minikube Installation
// ============================================================================

function installMinikube() {
  log("\n📦 Installing Minikube (Kubernetes with Podman)...\n", "bright");

  const platform = getPlatform();

  if (platform.isWindows) {
    return installMinikubeWindows();
  } else if (platform.isMac) {
    return installMinikubeMac();
  } else if (platform.isLinux) {
    return installMinikubeLinux();
  }

  logError("Unsupported platform for automatic Minikube installation");
  return false;
}

function installMinikubeWindows() {
  logInfo("Detected: Windows");

  logInfo("Attempting installation via winget...");
  const wingetResult = run(
    "winget install -e --id Kubernetes.minikube --silent --accept-package-agreements --accept-source-agreements",
    { silent: false }
  );

  if (wingetResult.success) {
    logSuccess("Minikube installed via winget");

    try {
      const { spawnSync } = require("child_process");

      const userPathResult = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path', 'User')",
        ],
        { encoding: "utf-8" }
      );

      const systemPathResult = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path', 'Machine')",
        ],
        { encoding: "utf-8" }
      );

      if (userPathResult.status === 0 && systemPathResult.status === 0) {
        const userPath = userPathResult.stdout.trim();
        const systemPath = systemPathResult.stdout.trim();
        process.env.PATH = `${userPath};${systemPath}`;
        logInfo("PATH refreshed - Minikube should now be available");
      }
    } catch (error) {
      logWarning("Could not refresh PATH automatically");
    }

    return true;
  }

  logWarning("Winget installation failed, trying Chocolatey...");

  const chocoCheck = run("choco --version", { silent: true });
  if (chocoCheck.success) {
    const chocoResult = run("choco install minikube -y --yes --no-progress", {
      silent: false,
    });
    if (chocoResult.success) {
      logSuccess("Minikube installed via Chocolatey");
      return true;
    }
  }

  logError("Automatic installation failed");
  logWarning(
    "Please install Minikube manually from: https://minikube.sigs.k8s.io/docs/start/"
  );
  return false;
}

function installMinikubeMac() {
  logInfo("Detected: macOS");

  const brewCheck = run("which brew", { silent: true });
  if (!brewCheck.success) {
    logError("Homebrew not found");
    return false;
  }

  logInfo("Installing Minikube via Homebrew...");
  const result = run("brew install minikube", { silent: false });

  if (result.success) {
    logSuccess("Minikube installed via Homebrew");
    return true;
  } else {
    logError("Homebrew installation failed");
    return false;
  }
}

function installMinikubeLinux() {
  logInfo("Detected: Linux");

  logInfo("Installing Minikube...");
  const downloadResult = run(
    "curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64 && sudo install minikube-linux-amd64 /usr/local/bin/minikube && rm minikube-linux-amd64",
    { silent: false }
  );

  if (downloadResult.success) {
    logSuccess("Minikube installed successfully");
    return true;
  }

  logError("Automatic installation failed");
  return false;
}

// ============================================================================
// Podman Machine Management
// ============================================================================

function getMachineStatus() {
  const result = run("podman machine list --format json", { silent: true });

  if (!result.success) {
    return { exists: false, running: false };
  }

  try {
    const machines = JSON.parse(result.output);
    if (machines && machines.length > 0) {
      const machine = machines[0];
      return {
        exists: true,
        running: machine.Running || false,
        name: machine.Name,
      };
    }
  } catch (e) {
    const output = result.output.toLowerCase();
    return {
      exists:
        output.includes("currently running") || output.includes("last up"),
      running: output.includes("currently running"),
    };
  }

  return { exists: false, running: false };
}

function isPodmanMachineBroken() {
  const result = run("podman version", { silent: true });

  if (
    !result.success &&
    (result.output.includes("failed to read identity") ||
      result.output.includes("cannot find the file specified") ||
      result.output.includes("unable to connect to Podman socket"))
  ) {
    return true;
  }

  return false;
}

function initializePodmanMachine() {
  log("\n🔧 Initializing Podman machine...\n", "bright");

  logInfo("Removing any existing machine...");
  run("podman machine stop podman-machine-default", { silent: true });
  run("podman machine rm -f podman-machine-default", { silent: true });

  // Initialize with rootful mode and more resources for better compatibility
  logInfo(
    "Creating Podman machine with rootful mode (better Kubernetes compatibility)..."
  );
  const initResult = run(
    "podman machine init --rootful --cpus 4 --memory 8192 --disk-size 50",
    { silent: false }
  );

  if (initResult.success) {
    logSuccess("Podman machine initialized in rootful mode");
    return true;
  } else {
    logError("Failed to initialize Podman machine");
    return false;
  }
}

function startPodmanMachine() {
  log("\n▶️  Starting Podman machine...\n", "bright");

  const result = run("podman machine start", { silent: false });

  if (result.success) {
    logSuccess("Podman machine started");

    logInfo("Waiting for machine to fully initialize...");
    const platform = getPlatform();
    if (platform.isWindows) {
      execSync("ping 127.0.0.1 -n 6 >nul", { stdio: "ignore" });
    } else {
      execSync("sleep 5", { stdio: "ignore" });
    }

    return true;
  } else {
    logError("Failed to start Podman machine");
    return false;
  }
}

function configurePodmanRegistries() {
  logInfo(
    "Configuring registries for development (fixing certificate issues)..."
  );

  // Always overwrite registries.conf with correct insecure registries (including docker.io)
  const insecureRegs =
    CLUSTER_CONFIG.registries &&
    CLUSTER_CONFIG.registries.insecure &&
    Array.isArray(CLUSTER_CONFIG.registries.insecure)
      ? CLUSTER_CONFIG.registries.insecure
      : ["gcr.io", "docker.io", "registry.k8s.io", "ghcr.io"];
  // Always include docker.io in [registries.search] and all insecure registries in [registries.insecure]
  const toml = [
    "[registries.search]",
    'registries = ["docker.io"]',
    "",
    "[registries.insecure]",
    `registries = [${insecureRegs.map((r) => `\"${r}\"`).join(", ")}]`,
    "",
  ].join("\n");

  // Write TOML to a temp file on the host
  const tmp = require("os").tmpdir();
  const tmpFile = path.join(tmp, "registries.conf");
  fs.writeFileSync(tmpFile, toml, "utf-8");

  // Copy the file into the VM using podman machine cp (Podman 4.2+)
  const cpResult = run(
    `podman machine cp "${tmpFile}" podman-machine-default:/tmp/registries.conf`,
    { silent: false }
  );
  if (!cpResult.success) {
    logError("Failed to copy registry config into Podman VM.");
    process.exit(1);
  }

  // Move it into place with sudo
  const mvResult = run(
    `podman machine ssh "sudo mv /tmp/registries.conf /etc/containers/registries.conf"`,
    { silent: false }
  );
  if (!mvResult.success) {
    logError("Failed to move registry config into place in Podman VM.");
    process.exit(1);
  }
  // Clean up temp file
  try {
    fs.unlinkSync(tmpFile);
  } catch (e) {}
  logSuccess(
    "Registry config written with [registries.insecure] including docker.io"
  );
}

// ============================================================================
// Minikube Cluster Management
// ============================================================================

function isMinikubeClusterExists() {
  // Check Minikube profile status
  const result = run(
    `minikube status --profile=${CLUSTER_CONFIG.clusterName}`,
    {
      silent: true,
    }
  );
  const output = result.output.toLowerCase();
  const profileExists =
    !output.includes("no such container") &&
    !output.includes("does not exist") &&
    !output.includes("not found") &&
    !output.includes("no cluster") &&
    !output.includes("no such profile");

  if (!profileExists) {
    return false;
  }

  // Check Podman container existence
  const containerCheck = run(
    `podman ps -a --filter name=${CLUSTER_CONFIG.clusterName} --format {{.Names}}`,
    { silent: true }
  );
  const containerExists =
    containerCheck.success && containerCheck.output.trim().length > 0;

  return profileExists && containerExists;
}

function isClusterFunctional() {
  // First check if container exists
  const containerCheck = run(
    `podman container inspect ${CLUSTER_CONFIG.clusterName}`,
    {
      silent: true,
    }
  );

  if (!containerCheck.success) {
    return false; // Container missing = not functional
  }

  // Then check API
  const result = run("kubectl get --raw /healthz", { silent: true });
  return result.success && result.output.includes("ok");
}

async function repairCluster() {
  log("\n🔧 Attempting cluster repair...", "bright");

  // Repair 1: Check if containers exist but are stopped/corrupted
  logInfo("Checking cluster containers...");
  const containers = run(
    `podman ps -a --filter name=${CLUSTER_CONFIG.clusterName} --format {{.Names}}`,
    { silent: true }
  );

  if (containers.success && containers.output.trim()) {
    const containerList = containers.output
      .trim()
      .split("\n")
      .filter((c) => c);
    logInfo(`Found ${containerList.length} cluster container(s)`);

    // Check container state
    containerList.forEach((container) => {
      const inspect = run(
        `podman container inspect ${container} --format {{.State.Status}}`,
        { silent: true }
      );
      if (inspect.success) {
        const state = inspect.output.trim();
        logInfo(`Container ${container}: ${state}`);

        if (state === "exited" || state === "stopped") {
          logInfo(`Attempting to restart container ${container}...`);
          run(`podman start ${container}`, { silent: true });
        }
      }
    });
  } else {
    // No containers found, but profile may exist (corrupted state)
    logWarning(
      "No cluster containers found for profile, possible corruption. Deleting Minikube profile to allow clean recreation..."
    );
    const deleteResult = run(
      `minikube delete -p ${CLUSTER_CONFIG.clusterName}`,
      { silent: false }
    );
    if (deleteResult.success) {
      logSuccess(
        "Deleted Minikube profile due to missing/corrupted Podman container. Please re-run setup to create a fresh cluster."
      );
      return false;
    } else {
      logError(
        "Failed to delete Minikube profile automatically. Please delete it manually and re-run setup."
      );
      return false;
    }
  }

  // Repair 2: Verify Minikube profile configuration exists
  logInfo("Verifying Minikube profile configuration...");
  const profileCheck = run("minikube profile list", { silent: true });
  if (!profileCheck.output.includes(CLUSTER_CONFIG.clusterName)) {
    logWarning(
      "Profile configuration missing - will need full cluster recreation"
    );
    return false;
  }

  // Repair 3: Try to update cluster configuration (non-destructive)
  logInfo("Updating cluster configuration...");
  const updateResult = run(
    `minikube start --profile=${CLUSTER_CONFIG.clusterName} --wait=none`,
    { silent: true }
  );

  // Give it a moment to apply changes
  logInfo("Waiting for configuration to apply...");
  await sleep(5000);

  // Repair 4: Verify kubectl context
  logInfo("Verifying kubectl context...");
  const contextCheck = run("kubectl config current-context", { silent: true });
  if (!contextCheck.output.includes(CLUSTER_CONFIG.clusterName)) {
    logInfo(`Switching kubectl context to ${CLUSTER_CONFIG.clusterName}...`);
    run(`kubectl config use-context ${CLUSTER_CONFIG.clusterName}`, {
      silent: true,
    });
  }

  // Repair 5: Check if API server is responding after repairs
  logInfo("Testing cluster connectivity...");
  const healthCheck = run("kubectl get --raw /healthz", { silent: true });

  if (healthCheck.success && healthCheck.output.includes("ok")) {
    logSuccess("Cluster repair successful!");
    return true;
  }

  logWarning(
    "Repair attempts completed, but cluster still not fully functional"
  );
  return false;
}

function createMinikubeCluster() {
  log(
    "\n🏗️  Creating Minikube cluster (Kubernetes using Podman)...\n",
    "bright"
  );

  const config = [
    `--profile=${CLUSTER_CONFIG.clusterName}`,
    `--driver=${CLUSTER_CONFIG.driver}`,
    `--container-runtime=${CLUSTER_CONFIG.containerRuntime}`,
    `--nodes=${CLUSTER_CONFIG.nodes}`,
    `--cpus=${CLUSTER_CONFIG.cpus}`,
    `--memory=${CLUSTER_CONFIG.memory}`,
    `--disk-size=${CLUSTER_CONFIG.diskSize}`,
    `--kubernetes-version=${CLUSTER_CONFIG.kubernetesVersion}`,
    `--wait=${CLUSTER_CONFIG.waitFor}`,
    `--wait-timeout=${CLUSTER_CONFIG.createTimeout}`,
    "--force",
  ];

  // Workaround: Pre-pull kicbase image with --tls-verify=false for Podman TLS issues (Windows)
  if (CLUSTER_CONFIG.driver === "podman") {
    const pullCmd =
      "podman pull --tls-verify=false gcr.io/k8s-minikube/kicbase:v0.0.48";
    logInfo(
      "Pre-pulling kicbase image with --tls-verify=false to avoid Podman TLS errors..."
    );
    run(pullCmd, { silent: false });
  }

  logInfo("Creating cluster with Podman rootful driver...");
  logInfo(
    `Nodes: ${CLUSTER_CONFIG.nodes} (${CLUSTER_CONFIG.nodes === 1 ? "single node" : "1 control-plane + " + (CLUSTER_CONFIG.nodes - 1) + " worker(s)"})`
  );
  logInfo(
    `Resources per node: ${CLUSTER_CONFIG.cpus} CPU, ${CLUSTER_CONFIG.memory}MB RAM, ${CLUSTER_CONFIG.diskSize} disk`
  );
  logInfo(
    `Total resources: ${TOTAL_RESOURCES.cpus} CPU, ${TOTAL_RESOURCES.memory}MB RAM`
  );
  logInfo(`Kubernetes version: ${CLUSTER_CONFIG.kubernetesVersion}`);
  logInfo("This may take 3-5 minutes (Minikube will pull images as needed)...");

  const result = run(`minikube start ${config.join(" ")}`, { silent: false });

  if (result.success) {
    logSuccess("Minikube cluster created successfully");

    // Show node status
    log("\n📊 Cluster nodes:", "bright");
    run("kubectl get nodes -o wide", { silent: false });

    return true;
  } else {
    logError("Failed to create Minikube cluster");
    logWarning("Podman + Minikube on Windows has known compatibility issues");
    logInfo("Checking cluster logs...");
    run("minikube logs --problems", { silent: false });
    return false;
  }
}

// ============================================================================
// Resource Deployment
// ============================================================================

function applyLocalResources() {
  log("\n📋 Deploying local Kubernetes resources...\n", "bright");

  const result = run("npm run infra:local:k8s-resources:apply", {
    silent: false,
  });

  if (result.success) {
    logSuccess("Resources deployed successfully");
    return true;
  } else {
    logError("Failed to deploy resources");
    return false;
  }
}

// ============================================================================
// Main Setup Flow
// ============================================================================

async function main() {
  const config = loadClusterConfig();
  const args = process.argv.slice(2);
  const shouldApply = args.includes("--apply");

  log(
    "\n╔════════════════════════════════════════════════════════════╗",
    "cyan"
  );
  log("║  Podman Desktop & Local Kubernetes Cluster Setup          ║", "cyan");
  log(
    "╚════════════════════════════════════════════════════════════╝\n",
    "cyan"
  );

  const platform = getPlatform();
  logInfo(`Platform: ${platform.platform} (${platform.arch})`);

  // Step 0: Refresh PATH on Windows
  if (platform.isWindows) {
    try {
      // Use child_process.spawn with array args to avoid command injection warnings
      const { spawnSync } = require("child_process");

      const userPathResult = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path', 'User')",
        ],
        { encoding: "utf-8" }
      );

      const systemPathResult = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "[Environment]::GetEnvironmentVariable('Path', 'Machine')",
        ],
        { encoding: "utf-8" }
      );

      if (userPathResult.status === 0 && systemPathResult.status === 0) {
        const userPath = userPathResult.stdout.trim();
        const systemPath = systemPathResult.stdout.trim();
        process.env.PATH = `${userPath};${systemPath}`;
      }
    } catch (error) {
      // Ignore
    }
  }

  // Step 1: Check Podman installation
  log("\n📦 Checking Podman installation...", "bright");

  if (!isPodmanInstalled()) {
    logWarning("Podman CLI not found");

    if (!isPodmanDesktopInstalled()) {
      logWarning("Podman Desktop not found");
      const installed = installPodmanDesktop();

      if (!installed) {
        process.exit(1);
      }

      logInfo("Waiting for installation to complete (5 seconds)...");
      await sleep(5000);

      if (!isPodmanInstalled()) {
        logError("Podman CLI still not available after installation");
        logWarning("Please restart your terminal and run this script again");
        process.exit(1);
      }
    } else {
      logSuccess("Podman Desktop is installed");
      logWarning("But Podman CLI is not in PATH");
      logWarning("Please restart your terminal and run this script again");
      process.exit(1);
    }
  } else {
    logSuccess("Podman is installed");
  }

  // Step 2: Check Minikube installation
  log("\n📦 Checking Minikube installation...", "bright");

  if (!isMinikubeInstalled()) {
    logWarning("Minikube not found");
    const installed = installMinikube();

    if (!installed) {
      process.exit(1);
    }

    logInfo("Waiting for installation to complete (3 seconds)...");
    await sleep(3000);

    if (!isMinikubeInstalled()) {
      logError("Minikube still not available after installation");
      logWarning("Please restart your terminal and run this script again");
      process.exit(1);
    }
  } else {
    logSuccess("Minikube is installed");
  }

  // Step 3: Check/Initialize/Start Podman machine
  log("\n🖥️  Checking Podman machine status...", "bright");

  // Validate cluster resources don't exceed Podman machine limits
  if (TOTAL_RESOURCES.cpus > CLUSTER_CONFIG.podmanMachine.totalCpus) {
    logError(
      `Cluster requires ${TOTAL_RESOURCES.cpus} CPUs but Podman machine only has ${CLUSTER_CONFIG.podmanMachine.totalCpus}`
    );
    logWarning(
      `Reduce nodes.count or nodes.resources.cpus in infra/k8s/podman/local/cluster/cluster-config.yaml`
    );
    process.exit(1);
  }

  if (TOTAL_RESOURCES.memory > CLUSTER_CONFIG.podmanMachine.totalMemory) {
    logError(
      `Cluster requires ${TOTAL_RESOURCES.memory}MB RAM but Podman machine only has ${CLUSTER_CONFIG.podmanMachine.totalMemory}MB`
    );
    logWarning(
      `Reduce nodes.count or nodes.resources.memory in infra/k8s/podman/local/cluster/cluster-config.yaml`
    );
    process.exit(1);
  }

  if (
    TOTAL_RESOURCES.cpus > CLUSTER_CONFIG.podmanMachine.totalCpus * 0.8 ||
    TOTAL_RESOURCES.memory > CLUSTER_CONFIG.podmanMachine.totalMemory * 0.8
  ) {
    logWarning(
      `Cluster will use ${Math.round((TOTAL_RESOURCES.cpus / CLUSTER_CONFIG.podmanMachine.totalCpus) * 100)}% of CPU and ${Math.round((TOTAL_RESOURCES.memory / CLUSTER_CONFIG.podmanMachine.totalMemory) * 100)}% of RAM`
    );
    logWarning("High resource usage may affect system performance");
  }

  let machineStatus = getMachineStatus();
  let needsRegistryConfig = false;

  // If machine exists, validate it's usable
  if (machineStatus.exists) {
    logSuccess(`Podman machine exists: ${machineStatus.name || "default"}`);

    // Check if machine is broken first (before checking config)
    if (isPodmanMachineBroken()) {
      logWarning(
        "Podman machine is broken (connection/identity issues) - recreating..."
      );
      if (!initializePodmanMachine()) {
        process.exit(1);
      }
      machineStatus = getMachineStatus();
      needsRegistryConfig = true;
    } else {
      // Check if machine is in rootful mode
      const rootfulCheck = run(
        "podman machine inspect podman-machine-default --format {{.Rootful}}",
        { silent: true }
      );

      if (rootfulCheck.success && !rootfulCheck.output.includes("true")) {
        logWarning(
          "Machine exists but not in rootful mode - recreating for Kubernetes compatibility..."
        );
        if (!initializePodmanMachine()) {
          process.exit(1);
        }
        machineStatus = getMachineStatus();
        needsRegistryConfig = true;
      }
    }
  } else {
    logWarning("No Podman machine found - creating...");
    if (!initializePodmanMachine()) {
      process.exit(1);
    }
    machineStatus = getMachineStatus();
    if (!machineStatus.exists) {
      logError(
        "Machine initialization succeeded but machine still not detected"
      );
      process.exit(1);
    }
    needsRegistryConfig = true;
  }

  // Ensure machine is running
  if (!machineStatus.running) {
    logWarning("Podman machine is not running - starting...");
    if (!startPodmanMachine()) {
      process.exit(1);
    }
  }

  // Always re-apply and log registry configuration for debugging
  logInfo("Forcing registry configuration update for debug...");
  configurePodmanRegistries();

  // Always restart Podman machine after registry config changes to ensure config is picked up
  logInfo("Restarting Podman machine to apply registry config changes...");
  run("podman machine stop", { silent: false });
  run("podman machine start", { silent: false });

  // If Minikube cluster exists, restart it to reload CNI and pick up registry config
  if (isMinikubeClusterExists()) {
    logInfo("Restarting Minikube cluster to reload CNI and registry config...");
    run(`minikube stop --profile=${CLUSTER_CONFIG.clusterName}`, {
      silent: false,
    });
    run(
      `minikube start --profile=${CLUSTER_CONFIG.clusterName} --wait=${CLUSTER_CONFIG.waitFor} --wait-timeout=${CLUSTER_CONFIG.restartTimeout}`,
      { silent: false }
    );
  }

  // Check Podman health and auto-restore registry config if TOML error detected or config is empty/missing
  let needsRegistryRepair = false;
  // 1. Check for TOML error
  const podmanInfo = run("podman system info --format json", { silent: true });
  if (
    !podmanInfo.success &&
    podmanInfo.output &&
    podmanInfo.output.includes("registries configuration")
  ) {
    needsRegistryRepair = true;
    logWarning(
      "Podman registry config appears broken (TOML error). Attempting to restore default config automatically..."
    );
  } else {
    // 2. Check if /etc/containers/registries.conf is empty or missing
    const checkFileCmd =
      'if [ ! -s /etc/containers/registries.conf ]; then echo "EMPTY_OR_MISSING"; fi';
    const fileCheck = run(`podman machine ssh "${checkFileCmd}"`, {
      silent: true,
    });
    if (fileCheck.success && fileCheck.output.includes("EMPTY_OR_MISSING")) {
      needsRegistryRepair = true;
      logWarning(
        "Podman registry config is empty or missing. Attempting to restore default config automatically..."
      );
    }
  }

  if (needsRegistryRepair) {
    // Try to restore from default location first
    const restoreCmd =
      "sudo cp /usr/share/containers/registries.conf /etc/containers/registries.conf";
    let restoreResult = run(`podman machine ssh "${restoreCmd}"`, {
      silent: false,
    });
    if (!restoreResult.success) {
      logWarning(
        "Default registry config not found. Creating minimal valid TOML config (temp file + scp)..."
      );
      // Remove all drop-in configs before restoring main config
      const cleanDropins =
        "sudo rm -f /etc/containers/registries.conf.d/*.conf";
      run(`podman machine ssh "${cleanDropins}"`, { silent: false });

      // Dynamically generate TOML config from YAML (use insecure registries from config if present)
      const insecureRegs =
        CLUSTER_CONFIG.registries &&
        CLUSTER_CONFIG.registries.insecure &&
        Array.isArray(CLUSTER_CONFIG.registries.insecure)
          ? CLUSTER_CONFIG.registries.insecure
          : ["gcr.io", "docker.io", "registry.k8s.io", "ghcr.io"];
      const toml = [
        "[registries.search]",
        'registries = ["docker.io"]',
        "",
        "[registries.insecure]",
        `registries = [${insecureRegs.map((r) => `"${r}"`).join(", ")}]`,
        "",
      ].join("\n");

      // Write TOML to a temp file on the host
      const tmp = require("os").tmpdir();
      const tmpFile = path.join(tmp, "registries.conf");
      fs.writeFileSync(tmpFile, toml, "utf-8");

      // Copy the file into the VM using podman machine cp (Podman 4.2+)
      const cpResult = run(
        `podman machine cp "${tmpFile}" podman-machine-default:/tmp/registries.conf`,
        { silent: false }
      );
      if (!cpResult.success) {
        logError("Failed to copy registry config into Podman VM.");
        process.exit(1);
      }

      // Move it into place with sudo
      const mvResult = run(
        `podman machine ssh "sudo mv /tmp/registries.conf /etc/containers/registries.conf"`,
        { silent: false }
      );
      if (!mvResult.success) {
        logError("Failed to move registry config into place in Podman VM.");
        process.exit(1);
      }
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch (e) {}
      restoreResult = { success: true };
    }
    if (restoreResult.success) {
      logSuccess(
        "Registry config restored (default or valid TOML). Restarting Podman machine..."
      );
      run("podman machine stop", { silent: false });
      run("podman machine start", { silent: false });
    } else {
      logError(
        "Failed to restore or create registry config automatically. Please restore it manually."
      );
      process.exit(1);
    }
  }

  // Step 4: Create Minikube cluster
  log("\n☸️  Checking Minikube cluster...", "bright");

  const clusterExists = isMinikubeClusterExists();

  if (clusterExists) {
    logSuccess("Minikube cluster exists - checking if functional...");

    if (!isClusterFunctional()) {
      logWarning("Cluster exists but is not functional - attempting repair...");

      // Step 1: Try repair first (fix common issues)
      const repaired = await repairCluster();

      if (repaired && isClusterFunctional()) {
        logSuccess("Cluster repaired and functional!");
      } else {
        // Step 2: If repair didn't work, try restart
        logInfo("Repair incomplete - attempting full restart...");
        const restartResult = run(
          `minikube start --profile=${CLUSTER_CONFIG.clusterName} --wait=${CLUSTER_CONFIG.waitFor} --wait-timeout=${CLUSTER_CONFIG.restartTimeout}`,
          { silent: false }
        );

        if (restartResult.success && isClusterFunctional()) {
          logSuccess("Cluster restarted successfully");
        } else {
          // Step 3: Both repair and restart failed
          logError("Unable to repair or restart cluster");
          log(
            "\n⚠️  Cluster is corrupted and cannot be automatically repaired.",
            "yellow"
          );
          log("\nTo fix this issue:", "cyan");
          log(
            "  1. Delete corrupted cluster:  npm run infra:local:cluster:delete",
            "cyan"
          );
          log(
            "  2. Recreate fresh cluster:    npm run infra:local:cluster:setup\n",
            "cyan"
          );
          logWarning("Note: This will delete all data in the cluster");
          process.exit(1);
        }
      }
    } else {
      logSuccess("Cluster is functional");
    }
  } else {
    logInfo("Creating Minikube cluster...");
    const created = createMinikubeCluster();

    if (!created) {
      logError("Failed to create Minikube cluster");
      logWarning(
        `Try manually: minikube start --profile=${CLUSTER_CONFIG.clusterName} --driver=podman`
      );
      process.exit(1);
    }
  }

  // Step 5: Optional resource deployment
  if (shouldApply) {
    const deploySuccess = applyLocalResources();
    if (!deploySuccess) {
      logWarning(
        "Resource deployment failed - cluster is ready but resources not deployed"
      );
      logInfo(
        "You can deploy manually: npm run infra:local:k8s-resources:apply"
      );
    }
  } else {
    logInfo("\nSkipping resource deployment (use --apply to deploy)");
    logInfo(
      "To deploy resources manually: npm run infra:local:k8s-resources:apply"
    );
  }

  // Success summary
  log(
    "\n╔════════════════════════════════════════════════════════════════╗",
    "green"
  );
  log(
    "║  ✓ Podman + Minikube local environment is ready!              ║",
    "green"
  );
  log(
    "╚════════════════════════════════════════════════════════════════╝\n",
    "green"
  );

  logInfo("Next steps:");
  logInfo("  • Deploy resources:     npm run infra:local:k8s-resources:apply");
  logInfo("  • Check status:         kubectl get pods");
  logInfo("  • View logs:            kubectl logs <pod-name>");
  logInfo("  • Port forward:         kubectl port-forward <pod> <port>:<port>");
  logInfo("  • Delete cluster:       npm run infra:local:cluster:delete\n");
}

(async () => {
  try {
    await main();
  } catch (error) {
    logError(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
})();
