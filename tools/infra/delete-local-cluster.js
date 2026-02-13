#!/usr/bin/env node

/**
 * Delete Kind + Podman Local Cluster
 *
 * Performs a thorough cleanup:
 * - Deletes Kubernetes resources defined in infra/k8s/podman/local
 * - Removes the Kind cluster (Podman provider)
 * - Cleans up orphaned Kind containers and images
 *
 * Podman machine remains untouched for faster re-creation.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const CONFIG_PATH = path.join(WORKSPACE_ROOT, "infra/k8s/podman/local/cluster/cluster-config.yaml");
const KIND_ENV = { KIND_EXPERIMENTAL_PROVIDER: "podman" };

function getClusterName() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`cluster-config.yaml not found at ${CONFIG_PATH}`);
    process.exit(1);
  }
  const content = fs.readFileSync(CONFIG_PATH, "utf-8");
  const match = content.match(/cluster_name:\s*(.+)/);
  if (!match || !match[1].trim()) {
    console.error("cluster-config.yaml must define cluster_name");
    process.exit(1);
  }
  return match[1].trim();
}

const CLUSTER_NAME = getClusterName();
const KIND_CONTEXT = `kind-${CLUSTER_NAME}`;

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logWarning(message) {
  log(`⚠ ${message}`, "yellow");
}

function logInfo(message) {
  log(`ℹ ${message}`, "cyan");
}

function run(command, options = {}) {
  try {
    const result = execSync(command, {
      cwd: WORKSPACE_ROOT,
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf-8",
      shell: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    return { success: true, output: result };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || error.stderr || error.message,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isKindClusterPresent() {
  const result = run("kind get clusters", { silent: true, env: KIND_ENV });
  if (!result.success) {
    return false;
  }
  return result.output
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .includes(CLUSTER_NAME);
}

async function main() {
  if (!isKindClusterPresent()) {
    logInfo(`No Kind cluster named '${CLUSTER_NAME}' detected. Nothing to delete.`);
    return;
  }

  log("\n╔════════════════════════════════════════════════════════════╗", "cyan");
  log("║         Delete Local Cluster & All Resources              ║", "cyan");
  log("╚════════════════════════════════════════════════════════════╝\n", "cyan");

  logWarning("This will delete the Kind cluster, workloads, and cached images.");
  log("\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n", "yellow");
  await sleep(5000);

  log("\n📋 Deleting Kubernetes resources...", "bright");
  const deleteResources = run(
    "kustomize build infra/k8s/podman/local --enable-alpha-plugins | kubectl delete -f - --wait=false --timeout=10s",
  );
  if (deleteResources.success) {
    logSuccess("Kubernetes resources deletion initiated (non-blocking)");
  } else {
    logWarning("Unable to delete resources automatically (cluster may already be down)");
  }

  log("\n☸️  Deleting Kind cluster...", "bright");
  const deleteCluster = run(`kind delete cluster --name ${CLUSTER_NAME}`, { env: KIND_ENV });
  if (deleteCluster.success) {
    logSuccess("Kind cluster deleted");
  } else {
    logWarning("Kind cluster deletion reported an error. Continuing cleanup.");
  }

  logInfo("Cleaning up orphaned Kind containers...");
  const containerList = run(`podman ps -a --filter label=io.x-k8s.kind.cluster=${CLUSTER_NAME} --format {{.ID}}`, {
    silent: true,
  });
  if (containerList.success && containerList.output.trim()) {
    containerList.output
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((id) => run(`podman rm -f ${id}`, { silent: true }));
    logSuccess("Removed orphaned containers");
  } else {
    logInfo("No orphaned containers detected");
  }

  logInfo("Removing cached Kind images...");
  const imageList = run("podman images --filter reference=kindest/node --format {{.ID}}", { silent: true });
  if (imageList.success && imageList.output.trim()) {
    imageList.output
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((id) => run(`podman rmi -f ${id}`, { silent: true }));
    logSuccess("Removed Kind base images");
  } else {
    logInfo("No cached Kind images found");
  }

  logInfo("Cleaning up workspace certificates...");
  const workspaceCertsPath = path.join(WORKSPACE_ROOT, ".workspace-certs");
  if (fs.existsSync(workspaceCertsPath)) {
    try {
      fs.rmSync(workspaceCertsPath, { recursive: true, force: true });
      logSuccess("Removed .workspace-certs directory");
    } catch (error) {
      logWarning(`Failed to remove .workspace-certs: ${error.message}`);
    }
  } else {
    logInfo("No .workspace-certs directory to clean");
  }

  log("\n✅ Cluster deletion complete", "green");
  logInfo("Podman machine preserved. Recreate later via npm run infra:local:cluster:setup");
}

main().catch((error) => {
  log(`\n❌ Error: ${error.message}`);
  process.exit(1);
});
