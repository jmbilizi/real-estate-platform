function checkBinaryAvailable(cmd) {
  try {
    execSync(`${process.platform === "win32" ? "where" : "which"} ${cmd}`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Enforce kubectl context for local Podman+Minikube resource operations
// Usage: node tools/infra/kubectl-local-context.js apply|delete|build
// Ensures kubectl context is set to the intended local cluster before running resource commands

const { execSync, spawnSync } = require("child_process");
const path = require("path");

// Dynamically read and validate the local cluster name from cluster-config.yaml
const fs = require("fs");
const yaml = require("js-yaml");
const configPath = path.resolve(
  __dirname,
  "../../infra/k8s/podman/local/cluster/cluster-config.yaml",
);
if (!fs.existsSync(configPath)) {
  console.error(
    `ERROR: cluster-config.yaml not found at ${configPath}. Please ensure your local cluster config exists and is named correctly.`,
  );
  process.exit(1);
}
let config;
try {
  config = yaml.load(fs.readFileSync(configPath, "utf8"));
} catch (e) {
  console.error(`ERROR: Failed to parse cluster-config.yaml: ${e.message}`);
  process.exit(1);
}
if (
  !config ||
  typeof config !== "object" ||
  !config.cluster_name ||
  typeof config.cluster_name !== "string" ||
  !config.cluster_name.trim()
) {
  console.error(
    "ERROR: cluster-config.yaml is missing a valid 'cluster_name' field. Please specify your cluster name, e.g.\ncluster_name: podman-local",
  );
  process.exit(1);
}
const LOCAL_CONTEXT = config.cluster_name.trim();
function getCurrentContext() {
  try {
    return execSync("kubectl config current-context", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function switchContext(context) {
  try {
    execSync(`kubectl config use-context ${context}`, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

function runKustomizeAndKubectl(op) {
  const kustomizeCmd = [
    "kustomize",
    "build",
    "infra/k8s/podman/local",
    "--enable-alpha-plugins",
  ];
  if (op === "build") {
    const result = spawnSync(kustomizeCmd[0], kustomizeCmd.slice(1), {
      stdio: "inherit",
    });
    process.exit(result.status);
  }
  if (op === "apply") {
    // Error-driven approach: try apply first, handle immutable field errors if they occur
    console.log("🚀 Deploying to local cluster...");

    // Build manifests
    const kustomize = spawnSync(kustomizeCmd[0], kustomizeCmd.slice(1), {
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (kustomize.status !== 0) {
      console.error("❌ Kustomize build failed");
      process.exit(kustomize.status);
    }

    // Try to apply normally first with --prune to remove renamed/deleted resources
    const kubectl = spawnSync(
      "kubectl",
      [
        "apply",
        "-f",
        "-",
        "--prune",
        "-l",
        "app.kubernetes.io/managed-by=kustomize",
      ],
      {
        input: kustomize.stdout,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    if (kubectl.status === 0) {
      console.log("✅ Deployment successful (no immutable field conflicts)");
      process.stdout.write(kubectl.stdout);
      process.exit(0);
    }

    // Check for immutable field errors across multiple resource types
    const errorOutput = kubectl.stderr.toString();

    // Define patterns for all resource types with immutable fields
    const immutableFieldPatterns = [
      {
        pattern: /Forbidden.*updates to statefulset spec.*are forbidden/i,
        resourceType: "statefulset",
        namePattern: /Resource=statefulsets[\s\S]*?Name: "([^"]+)"/g,
        deleteArgs: ["--cascade=orphan"], // Preserve PVCs
        displayName: "StatefulSet",
      },
      {
        pattern: /Forbidden.*updates to deployment spec.*are forbidden/i,
        resourceType: "deployment",
        namePattern: /Resource=deployments[\s\S]*?Name: "([^"]+)"/g,
        deleteArgs: ["--cascade=orphan"], // Preserve Pods during recreation
        displayName: "Deployment",
      },
      {
        pattern: /spec\.clusterIP.*immutable|spec\.type.*immutable/i,
        resourceType: "service",
        namePattern: /Resource=services[\s\S]*?Name: "([^"]+)"/g,
        deleteArgs: [], // Services are stateless
        displayName: "Service",
      },
      {
        pattern: /Forbidden.*updates to daemonset spec.*are forbidden/i,
        resourceType: "daemonset",
        namePattern: /Resource=daemonsets[\s\S]*?Name: "([^"]+)"/g,
        deleteArgs: ["--cascade=orphan"],
        displayName: "DaemonSet",
      },
      {
        pattern:
          /spec\.selector.*immutable|spec\.completions.*cannot be decreased/i,
        resourceType: "job",
        namePattern: /Resource=jobs[\s\S]*?Name: "([^"]+)"/g,
        deleteArgs: [], // Jobs should complete before update
        displayName: "Job",
      },
    ];

    // Check which pattern matches
    const matchedPattern = immutableFieldPatterns.find((p) =>
      p.pattern.test(errorOutput),
    );

    if (matchedPattern) {
      console.log(
        `\n⚠️  Detected immutable ${matchedPattern.displayName} field changes`,
      );
      console.log(`🔍 Identifying affected ${matchedPattern.displayName}s...`);

      // Extract resource names from error message
      const matches = [...errorOutput.matchAll(matchedPattern.namePattern)];
      const failedResources = matches.map((m) => m[1]);

      if (failedResources.length === 0) {
        console.error(
          `❌ Could not identify failed ${matchedPattern.displayName}s from error message`,
        );
        console.error("\nError output:");
        process.stderr.write(kubectl.stderr);
        process.exit(1);
      }

      console.log(`📋 ${matchedPattern.displayName}s requiring recreation:`);
      failedResources.forEach((res) => console.log(`  - ${res}`));

      // Delete each failed resource
      const cascadeInfo = matchedPattern.deleteArgs.includes("--cascade=orphan")
        ? " (preserving dependent resources)"
        : "";
      console.log(
        `\n🗑️  Deleting ${matchedPattern.displayName}s with immutable field conflicts${cascadeInfo}...`,
      );
      failedResources.forEach((res) => {
        console.log(`  Deleting ${matchedPattern.displayName}: ${res}`);
        spawnSync(
          "kubectl",
          [
            "delete",
            matchedPattern.resourceType,
            res,
            ...matchedPattern.deleteArgs,
          ],
          {
            stdio: "inherit",
          },
        );
      });

      // Retry deployment
      console.log(
        `\n🔄 Retrying deployment with recreated ${matchedPattern.displayName}s...`,
      );
      const kustomizeRetry = spawnSync(kustomizeCmd[0], kustomizeCmd.slice(1), {
        stdio: ["ignore", "pipe", "inherit"],
      });
      if (kustomizeRetry.status !== 0) {
        console.error("❌ Kustomize build failed on retry");
        process.exit(kustomizeRetry.status);
      }

      const kubectlRetry = spawnSync(
        "kubectl",
        [
          "apply",
          "-f",
          "-",
          "--prune",
          "-l",
          "app.kubernetes.io/managed-by=kustomize",
        ],
        {
          input: kustomizeRetry.stdout,
          stdio: ["pipe", "inherit", "inherit"],
        },
      );
      process.exit(kubectlRetry.status);
    } else {
      // Non-immutable-field error
      console.error("❌ Deployment failed with non-immutable-field error:");
      process.stderr.write(kubectl.stderr);
      process.exit(kubectl.status);
    }
  } else {
    // delete or build
    const kubectlCmd =
      op === "delete" ? ["kubectl", "delete", "-f", "-"] : null;
    const kustomize = spawnSync(kustomizeCmd[0], kustomizeCmd.slice(1), {
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (kustomize.status !== 0) process.exit(kustomize.status);
    if (kubectlCmd) {
      const kubectl = spawnSync(kubectlCmd[0], kubectlCmd.slice(1), {
        input: kustomize.stdout,
        stdio: ["pipe", "inherit", "inherit"],
      });
      process.exit(kubectl.status);
    }
    process.exit(0);
  }
}

function main() {
  // Pre-check: Ensure kubectl and kustomize are available
  if (!checkBinaryAvailable("kubectl")) {
    console.error(
      "ERROR: 'kubectl' is not available in your PATH. Please install kubectl and ensure it is accessible.",
    );
    process.exit(1);
  }
  if (!checkBinaryAvailable("kustomize")) {
    console.error(
      "ERROR: 'kustomize' is not available in your PATH. Please install kustomize and ensure it is accessible.",
    );
    process.exit(1);
  }
  const op = process.argv[2];
  if (!["apply", "delete", "build"].includes(op)) {
    console.error(
      "Usage: node tools/infra/kubectl-local-context.js apply|delete|build",
    );
    process.exit(1);
  }
  const current = getCurrentContext();
  if (current !== LOCAL_CONTEXT) {
    console.log(
      `Switching kubectl context to '${LOCAL_CONTEXT}' (was '${current}')...`,
    );
    if (!switchContext(LOCAL_CONTEXT)) {
      console.error(
        `Failed to switch kubectl context to '${LOCAL_CONTEXT}'. Aborting.`,
      );
      process.exit(1);
    }
  }
  runKustomizeAndKubectl(op);
}

main();
