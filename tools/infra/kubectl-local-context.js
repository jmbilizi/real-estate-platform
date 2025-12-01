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
  "../../infra/k8s/podman/local/cluster/cluster-config.yaml"
);
if (!fs.existsSync(configPath)) {
  console.error(
    `ERROR: cluster-config.yaml not found at ${configPath}. Please ensure your local cluster config exists and is named correctly.`
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
    "ERROR: cluster-config.yaml is missing a valid 'cluster_name' field. Please specify your cluster name, e.g.\ncluster_name: podman-local"
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
    // Pre-check for immutable field changes
    try {
      // Only handle postgres StatefulSet auto-delete for volumeClaimTemplates
      const stsName = "postgres";
      const ns = "default";
      const getSts = spawnSync(
        "kubectl",
        ["get", "statefulset", stsName, "-n", ns, "-o", "json"],
        { encoding: "utf-8" }
      );
      if (getSts.status === 0 && getSts.stdout) {
        const current = JSON.parse(getSts.stdout);
        const kustomizePreview = spawnSync(
          kustomizeCmd[0],
          kustomizeCmd.slice(1),
          { encoding: "utf-8" }
        );
        if (kustomizePreview.status === 0 && kustomizePreview.stdout) {
          const docs = kustomizePreview.stdout
            .split(/^---$/m)
            .map((s) => s.trim())
            .filter(Boolean);
          const yaml = require("js-yaml");
          // StatefulSet: auto-delete if volumeClaimTemplates changes
          const desiredStsDoc = docs.find(
            (doc) =>
              doc.includes("kind: StatefulSet") &&
              doc.includes("name: postgres")
          );
          if (desiredStsDoc) {
            const desired = yaml.load(desiredStsDoc);
            const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
            const curVct = current.spec.volumeClaimTemplates || [];
            const desVct =
              (desired.spec && desired.spec.volumeClaimTemplates) || [];
            if (!deepEqual(curVct, desVct)) {
              console.log(
                "Detected immutable StatefulSet spec change (volumeClaimTemplates). Deleting StatefulSet 'postgres' before apply..."
              );
              spawnSync(
                "kubectl",
                ["delete", "statefulset", stsName, "-n", ns],
                { stdio: "inherit" }
              );
              // Also check and delete the associated PVC if storageClassName or accessModes differ
              if (
                desVct.length > 0 &&
                desVct[0].metadata &&
                desVct[0].metadata.name
              ) {
                const pvcName = `${desVct[0].metadata.name}-${stsName}-0`;
                const getPvc = spawnSync(
                  "kubectl",
                  ["get", "pvc", pvcName, "-n", ns, "-o", "json"],
                  { encoding: "utf-8" }
                );
                if (getPvc.status === 0 && getPvc.stdout) {
                  const curPvc = JSON.parse(getPvc.stdout);
                  const desiredPvcSpec = desVct[0].spec || {};
                  const pvcNeedsDelete =
                    curPvc.spec.storageClassName !==
                      desiredPvcSpec.storageClassName ||
                    JSON.stringify(curPvc.spec.accessModes) !==
                      JSON.stringify(desiredPvcSpec.accessModes);
                  if (pvcNeedsDelete) {
                    console.log(
                      `Deleting PVC '${pvcName}' due to storageClassName or accessModes change...`
                    );
                    spawnSync("kubectl", ["delete", "pvc", pvcName, "-n", ns], {
                      stdio: "inherit",
                    });
                  }
                }
              }
            }
          }
          // Deployment: warn if selector changes
          const desiredDepDoc = docs.find((doc) =>
            doc.includes("kind: Deployment")
          );
          if (desiredDepDoc) {
            const depNameMatch = desiredDepDoc.match(/name:\s*(\S+)/);
            const depName = depNameMatch ? depNameMatch[1] : "<unknown>";
            const getDep = spawnSync(
              "kubectl",
              ["get", "deployment", depName, "-n", ns, "-o", "json"],
              { encoding: "utf-8" }
            );
            if (getDep.status === 0 && getDep.stdout) {
              const curDep = JSON.parse(getDep.stdout);
              const desiredDep = yaml.load(desiredDepDoc);
              if (
                JSON.stringify(curDep.spec.selector) !==
                JSON.stringify(desiredDep.spec.selector)
              ) {
                console.warn(
                  `Warning: Deployment '${depName}' spec.selector is immutable and has changed. Manual delete required.`
                );
              }
            }
          }
          // Service: warn if clusterIP or type changes
          const desiredSvcDoc = docs.find((doc) =>
            doc.includes("kind: Service")
          );
          if (desiredSvcDoc) {
            const svcNameMatch = desiredSvcDoc.match(/name:\s*(\S+)/);
            const svcName = svcNameMatch ? svcNameMatch[1] : "<unknown>";
            const getSvc = spawnSync(
              "kubectl",
              ["get", "service", svcName, "-n", ns, "-o", "json"],
              { encoding: "utf-8" }
            );
            if (getSvc.status === 0 && getSvc.stdout) {
              const curSvc = JSON.parse(getSvc.stdout);
              const desiredSvc = yaml.load(desiredSvcDoc);
              if (curSvc.spec.clusterIP !== desiredSvc.spec.clusterIP) {
                console.warn(
                  `Warning: Service '${svcName}' spec.clusterIP is immutable and has changed. Manual delete required.`
                );
              }
              if (curSvc.spec.type !== desiredSvc.spec.type) {
                console.warn(
                  `Warning: Service '${svcName}' spec.type is immutable and has changed. Manual delete required.`
                );
              }
            }
          }
          // PVC: warn if storageClassName or accessModes changes
          const desiredPvcDoc = docs.find((doc) =>
            doc.includes("kind: PersistentVolumeClaim")
          );
          if (desiredPvcDoc) {
            const pvcNameMatch = desiredPvcDoc.match(/name:\s*(\S+)/);
            const pvcName = pvcNameMatch ? pvcNameMatch[1] : "<unknown>";
            const getPvc = spawnSync(
              "kubectl",
              ["get", "pvc", pvcName, "-n", ns, "-o", "json"],
              { encoding: "utf-8" }
            );
            if (getPvc.status === 0 && getPvc.stdout) {
              const curPvc = JSON.parse(getPvc.stdout);
              const desiredPvc = yaml.load(desiredPvcDoc);
              if (
                curPvc.spec.storageClassName !==
                desiredPvc.spec.storageClassName
              ) {
                console.warn(
                  `Warning: PVC '${pvcName}' storageClassName is immutable and has changed. Manual delete required.`
                );
              }
              if (
                JSON.stringify(curPvc.spec.accessModes) !==
                JSON.stringify(desiredPvc.spec.accessModes)
              ) {
                console.warn(
                  `Warning: PVC '${pvcName}' accessModes is immutable and has changed. Manual delete required.`
                );
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(
        "Warning: Could not auto-detect immutable spec changes:",
        e.message
      );
    }
    // Now run kustomize build and kubectl apply as before
    const kustomize = spawnSync(kustomizeCmd[0], kustomizeCmd.slice(1), {
      stdio: ["ignore", "pipe", "inherit"],
    });
    if (kustomize.status !== 0) process.exit(kustomize.status);
    const kubectl = spawnSync("kubectl", ["apply", "-f", "-"], {
      input: kustomize.stdout,
      stdio: ["pipe", "inherit", "inherit"],
    });
    process.exit(kubectl.status);
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
      "ERROR: 'kubectl' is not available in your PATH. Please install kubectl and ensure it is accessible."
    );
    process.exit(1);
  }
  if (!checkBinaryAvailable("kustomize")) {
    console.error(
      "ERROR: 'kustomize' is not available in your PATH. Please install kustomize and ensure it is accessible."
    );
    process.exit(1);
  }
  const op = process.argv[2];
  if (!["apply", "delete", "build"].includes(op)) {
    console.error(
      "Usage: node tools/infra/kubectl-local-context.js apply|delete|build"
    );
    process.exit(1);
  }
  const current = getCurrentContext();
  if (current !== LOCAL_CONTEXT) {
    console.log(
      `Switching kubectl context to '${LOCAL_CONTEXT}' (was '${current}')...`
    );
    if (!switchContext(LOCAL_CONTEXT)) {
      console.error(
        `Failed to switch kubectl context to '${LOCAL_CONTEXT}'. Aborting.`
      );
      process.exit(1);
    }
  }
  runKustomizeAndKubectl(op);
}

main();
