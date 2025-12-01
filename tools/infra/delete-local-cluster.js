#!/usr/bin/env node
// Robust check for Minikube cluster existence (mirrors setup-local-cluster.js)
function isMinikubeClusterExists() {
  const result = run(`minikube status --profile=${CLUSTER_NAME}`, {
    silent: true,
  });
  const output = result.output ? result.output.toLowerCase() : "";
  if (
    output.includes("no such container") ||
    output.includes("does not exist") ||
    output.includes("not found") ||
    output.includes("no cluster") ||
    output.includes("no such profile")
  ) {
    return false;
  }
  return (
    result.success || output.includes("stopped") || output.includes("paused")
  );
}
/**
 * Delete Local Podman Cluster Script
 *
 * Completely removes the local cluster and all related resources:
 * - Deletes Kubernetes resources (pods, services, etc.)
 * - Deletes Minikube cluster
 * - Removes containers
 * - Removes cached images
 * - Cleans up volumes
 *
 * Podman machine is preserved for fast cluster recreation.
 *
 * Usage: npm run infra:local:cluster:delete
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// Load and validate cluster name from config
function getClusterName() {
  const configPath = path.resolve(
    __dirname,
    "../../infra/k8s/podman/local/cluster/cluster-config.yaml"
  );
  if (!fs.existsSync(configPath)) {
    console.error(
      `ERROR: cluster-config.yaml not found at ${configPath}. Please ensure your local cluster config exists and is named correctly.`
    );
    process.exit(1);
  }
  let content;
  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch (error) {
    console.error(
      `ERROR: Failed to read cluster-config.yaml: ${error.message}`
    );
    process.exit(1);
  }
  const match = content.match(/cluster_name:\s*(.+)/);
  if (!match || !match[1].trim()) {
    console.error(
      "ERROR: cluster-config.yaml is missing a valid 'cluster_name' field. Please specify your cluster name, e.g.\ncluster_name: podman-local"
    );
    process.exit(1);
  }
  return match[1].trim();
}

const CLUSTER_NAME = getClusterName();

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
      cwd: path.resolve(__dirname, "../.."),
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf-8",
      shell: true,
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

async function main() {
  // Check if cluster exists before attempting deletion
  if (!isMinikubeClusterExists()) {
    logInfo(
      `No Minikube cluster named '${CLUSTER_NAME}' exists. Nothing to delete.`
    );
    logInfo("Podman machine is preserved.\n");
    return;
  }
  log(
    "\n╔════════════════════════════════════════════════════════════╗",
    "cyan"
  );
  log("║         Delete Local Cluster & All Resources              ║", "cyan");
  log(
    "╚════════════════════════════════════════════════════════════╝\n",
    "cyan"
  );

  logWarning("This will completely delete the cluster and all its data!");
  logWarning(
    "Kubernetes resources, containers, images, and volumes will be removed."
  );
  log("\nPress Ctrl+C to cancel, or wait 5 seconds to continue...\n", "yellow");

  await sleep(5000);

  // Step 1: Delete Kubernetes resources (if cluster is running)
  log("\n📋 Deleting Kubernetes resources...", "bright");
  const deleteResources = run(
    "kustomize build infra/k8s/podman/local --enable-alpha-plugins | kubectl delete -f -",
    { silent: false }
  );

  if (deleteResources.success) {
    logSuccess("Kubernetes resources deleted");
  } else {
    logWarning("Could not delete resources (cluster may not be running)");
  }

  // Step 2: Delete Minikube cluster
  log("\n☸️  Deleting Minikube cluster...", "bright");
  const deleteCluster = run(`minikube delete --profile=${CLUSTER_NAME}`, {
    silent: false,
  });

  if (deleteCluster.success) {
    logSuccess("Cluster deleted successfully");
  } else {
    logWarning("Cluster deletion may have failed - continuing cleanup anyway");
  }

  // Step 3: Remove orphaned containers
  logInfo("Cleaning up orphaned containers...");
  const containers = run(
    `podman ps -a --filter name=${CLUSTER_NAME} --format {{.Names}}`,
    { silent: true }
  );
  if (containers.success && containers.output.trim()) {
    containers.output
      .trim()
      .split("\n")
      .forEach((container) => {
        if (container) {
          run(`podman rm -f ${container}`, { silent: true });
        }
      });
    logSuccess("Orphaned containers removed");
  } else {
    logInfo("No orphaned containers found");
  }

  // Step 4: Remove cluster images
  logInfo("Removing cluster-specific images...");
  const images = run(
    "podman images --filter reference=gcr.io/k8s-minikube/kicbase --format {{.ID}}",
    { silent: true }
  );
  if (images.success && images.output.trim()) {
    images.output
      .trim()
      .split("\n")
      .forEach((imageId) => {
        if (imageId) {
          run(`podman rmi -f ${imageId}`, { silent: true });
        }
      });
    logSuccess("Cluster images removed");
  } else {
    logInfo("No cluster images found");
  }

  // Step 5: Clean up volumes
  logInfo("Removing cluster volumes...");
  run("podman volume prune -f", { silent: true });
  logSuccess("Volumes cleaned up");

  log("\n✅ Complete cluster deletion finished", "green");
  log("\nPodman machine preserved - next setup will be fast (~30s)\n", "cyan");
  log("To recreate cluster: npm run infra:local:cluster:setup\n", "cyan");
}

main().catch((error) => {
  log(`\n❌ Error: ${error.message}`, "red");
  process.exit(1);
});
