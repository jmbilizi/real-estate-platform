#!/usr/bin/env node

/**
 * Kind + Podman local cluster bootstrapper
 * ----------------------------------------
 * - Keeps the toolchain 100% open source (Podman + Kind)
 * - Mirrors infra/k8s/podman/local by default (use --apply to deploy immediately)
 * - Synchronizes the Windows trust store into the Podman VM and every Kind node
 * - Configures containerd hosts.toml entries so image pulls honor enterprise CAs
 */

const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");

const WORKSPACE_ROOT = path.resolve(__dirname, "../..");
const CLUSTER_CONFIG_PATH = path.join(WORKSPACE_ROOT, "infra/k8s/podman/local/cluster/cluster-config.yaml");
const SHOULD_APPLY = process.argv.includes("--apply");
const CONTAINERD_CA_PATH = "/etc/containerd/certs.d/_workspace-ca/workspace-enterprise-roots.pem";
const { getLocalRegistryConfig } = require("./registry-settings");

const localRegistryConfig = getLocalRegistryConfig();
const LOCAL_REGISTRY_NAME = localRegistryConfig.name;
const LOCAL_REGISTRY_PORT = localRegistryConfig.hostPort;
const LOCAL_REGISTRY_INTERNAL_PORT = localRegistryConfig.internalPort;
const LOCAL_REGISTRY_HELP_URL = "https://kind.sigs.k8s.io/docs/user/local-registry/";
const REGISTRY_HOSTS = [
  { name: "docker.io", server: "https://registry-1.docker.io" },
  { name: "ghcr.io", server: "https://ghcr.io" },
  { name: "quay.io", server: "https://quay.io" },
  { name: "gcr.io", server: "https://gcr.io" },
  { name: "k8s.gcr.io", server: "https://registry.k8s.io" },
];
let cachedHostCABundle = null;

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

function logError(message) {
  log(`✗ ${message}`, "red");
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

function ensureLocalRegistry() {
  logInfo(`Ensuring local registry is running at localhost:${LOCAL_REGISTRY_PORT}...`);
  const result = run("node tools/infra/local-registry.js ensure", { silent: false });
  if (!result.success) {
    logError("Failed to ensure local registry. See logs above.");
    process.exit(1);
  }
}

function applyRegistryHostingConfigMap() {
  // This ConfigMap is a Kind convention used for discovery/documentation.
  // It is not strictly required for registry functionality.
  const content = [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: local-registry-hosting",
    "  namespace: kube-public",
    "data:",
    "  localRegistryHosting.v1: |",
    `    host: \"localhost:${LOCAL_REGISTRY_PORT}\"`,
    `    help: \"${LOCAL_REGISTRY_HELP_URL}\"`,
    "",
  ].join("\n");

  const tmpFile = path.join(os.tmpdir(), `kind-local-registry-hosting-${Date.now()}.yaml`);
  try {
    fs.writeFileSync(tmpFile, content, "utf8");
    run(`kubectl apply -f "${tmpFile}"`, { silent: true });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

function loadClusterConfig() {
  if (!fs.existsSync(CLUSTER_CONFIG_PATH)) {
    logError(`cluster-config.yaml not found at ${CLUSTER_CONFIG_PATH}`);
    process.exit(1);
  }

  const raw = yaml.load(fs.readFileSync(CLUSTER_CONFIG_PATH, "utf8"));

  function assertField(condition, message) {
    if (!condition) {
      logError(`cluster-config.yaml: ${message}`);
      process.exit(1);
    }
  }

  assertField(raw.cluster_name && typeof raw.cluster_name === "string", "cluster_name must be defined");
  assertField(raw.nodes && Number.isInteger(raw.nodes) && raw.nodes > 0, "nodes must be a positive integer");
  assertField(raw.resources && typeof raw.resources === "object", "resources section is required");
  assertField(raw.resources.cpus && raw.resources.cpus > 0, "resources.cpus must be > 0");
  assertField(raw.resources.memory && raw.resources.memory > 0, "resources.memory must be > 0 (MB)");
  assertField(
    raw.resources.disk && typeof raw.resources.disk === "string",
    "resources.disk must be a string such as '20g'",
  );
  assertField(
    raw.kubernetes_version && typeof raw.kubernetes_version === "string",
    "kubernetes_version must be defined",
  );

  return {
    clusterName: raw.cluster_name.trim(),
    nodes: raw.nodes,
    cpus: raw.resources.cpus,
    memory: raw.resources.memory,
    diskSize: raw.resources.disk,
    kubernetesVersion: raw.kubernetes_version.startsWith("v") ? raw.kubernetes_version : `v${raw.kubernetes_version}`,
  };
}

const CLUSTER_CONFIG = loadClusterConfig();
const KIND_CLUSTER_NAME = CLUSTER_CONFIG.clusterName;
const KIND_CONTEXT = `kind-${KIND_CLUSTER_NAME}`;
const KIND_ENV = { KIND_EXPERIMENTAL_PROVIDER: "podman" };
const TOTAL_CPUS = CLUSTER_CONFIG.cpus * CLUSTER_CONFIG.nodes;
const TOTAL_MEMORY = CLUSTER_CONFIG.memory * CLUSTER_CONFIG.nodes;

function ensureBinaryExists(binary, installHint) {
  const versionCommand = binary === "kubectl" ? "version --client" : "version";
  const result = run(`${binary} ${versionCommand}`, { silent: true });
  if (!result.success) {
    logError(`${binary} is not available in PATH.`);
    logInfo(installHint);
    process.exit(1);
  }
}

function parseDiskSizeToGB(value) {
  const match = value.match(/(\d+)/);
  if (!match) {
    return 40;
  }
  return Math.max(parseInt(match[1], 10), 40);
}

function getPodmanMachines() {
  const result = run("podman machine list --format json", { silent: true });
  if (!result.success) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.output || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function ensurePodmanMachine() {
  const machines = getPodmanMachines();
  const desiredCpus = Math.max(TOTAL_CPUS + 1, 4);
  const desiredMemory = Math.max(TOTAL_MEMORY + 1024, 4096); // MB
  const desiredDisk = parseDiskSizeToGB(CLUSTER_CONFIG.diskSize);

  if (machines.length === 0) {
    logInfo("No Podman machine found. Initializing a new one...");
    const initResult = run(
      `podman machine init --cpus ${desiredCpus} --memory ${desiredMemory} --disk-size ${desiredDisk} --now`,
      { silent: false },
    );
    if (!initResult.success) {
      logError("Failed to initialize Podman machine. Please run 'podman machine init' manually and retry.");
      process.exit(1);
    }
    return "podman-machine-default";
  }

  const activeMachine = machines.find((machine) => machine.Running) || machines[0];
  const machineName = activeMachine.Name || "podman-machine-default";

  if (!activeMachine.Running) {
    logInfo(`Starting Podman machine '${machineName}'...`);
    const startResult = run(`podman machine start ${machineName}`, { silent: false });
    if (!startResult.success) {
      logError(`Unable to start Podman machine ${machineName}`);
      process.exit(1);
    }
  }

  return machineName;
}

function installCABundleInPodmanMachine(machineName) {
  logInfo("Ensuring CA bundle is installed inside Podman machine (fixes TLS)");
  const remoteScript = [
    "set -euo pipefail",
    "tmp=$(mktemp)",
    'curl -fsSL https://curl.se/ca/cacert.pem -o "$tmp"',
    'sudo mv "$tmp" /etc/pki/ca-trust/source/anchors/workspace-roots.pem',
    "sudo update-ca-trust",
  ].join(" && ");

  const escapedScript = remoteScript.replace(/"/g, '\\"');
  const remoteResult = run(`podman machine ssh ${machineName} "${escapedScript}"`, { silent: true });
  if (remoteResult.success) {
    logSuccess("Podman machine now trusts the Mozilla CA bundle");
  } else {
    logWarning("Remote CA install failed (likely TLS MITM on curl.se). Captured error:");
    logInfo(remoteResult.output.trim());
  }

  const hostCABundle = getHostCABundleBuffer();
  if (!hostCABundle) {
    logWarning("Unable to export Windows trust store. Podman machine may still have TLS issues.");
    return;
  }

  const remoteTempPath = `/tmp/workspace-enterprise-roots.pem`;
  if (!streamBufferToPodmanMachine(machineName, remoteTempPath, hostCABundle)) {
    logWarning("Failed to stream enterprise CA bundle into Podman machine. Try running setup as Administrator.");
    return;
  }

  const installResult = run(
    `podman machine ssh ${machineName} "set -euo pipefail && sudo mv ${remoteTempPath} /etc/pki/ca-trust/source/anchors/workspace-enterprise-roots.pem && sudo update-ca-trust"`,
    { silent: true },
  );

  if (installResult.success) {
    logSuccess("Synchronized Windows trust store with Podman machine");
  } else {
    logWarning("Unable to install enterprise CA bundle automatically. Please add your corporate CA manually.");
  }
}

function getHostCABundleBuffer() {
  if (cachedHostCABundle) {
    return cachedHostCABundle;
  }
  cachedHostCABundle = exportHostRootCertificates();

  // Save CA bundle for Docker builds (once per session)
  if (cachedHostCABundle) {
    saveDockerBuildCABundle(cachedHostCABundle);
  }

  return cachedHostCABundle;
}

function exportHostRootCertificates() {
  switch (process.platform) {
    case "win32":
      return exportWindowsRootCertificates();
    case "darwin":
      return exportMacOSRootCertificates();
    case "linux":
      return exportLinuxRootCertificates();
    default:
      logWarning(`Host trust export not implemented for platform: ${process.platform}. Skipping corporate CA sync.`);
      return null;
  }
}

function exportWindowsRootCertificates() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-ca-"));
  const scriptPath = path.join(tempDir, "export-ca.ps1");
  const pemPath = path.join(tempDir, "workspace-enterprise-roots.pem");
  const psScript = `
$certs = Get-ChildItem -Path Cert:\\LocalMachine\\Root
$sb = New-Object System.Text.StringBuilder
foreach ($cert in $certs) {
  try {
    $bytes = $cert.Export('Cert')
    if ($bytes -eq $null) { continue }
    $base64 = [System.Convert]::ToBase64String($bytes, [System.Base64FormattingOptions]::InsertLineBreaks)
    $sb.AppendLine('-----BEGIN CERTIFICATE-----') | Out-Null
    $sb.AppendLine($base64) | Out-Null
    $sb.AppendLine('-----END CERTIFICATE-----') | Out-Null
  } catch {}
}
Set-Content -Path '${pemPath}' -Value $sb.ToString() -Encoding ascii
`;

  fs.writeFileSync(scriptPath, psScript, "utf8");

  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, { stdio: "ignore" });
    if (!fs.existsSync(pemPath)) {
      return null;
    }
    const buffer = fs.readFileSync(pemPath);
    if (!buffer.length) {
      return null;
    }
    return buffer;
  } catch (error) {
    logWarning("Failed to export Windows trust store. Run VS Code as Administrator or export the CA manually.");
    return null;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // ignore cleanup errors
    }
  }
}

function exportMacOSRootCertificates() {
  try {
    // Export system root certificates from macOS Keychain
    const systemRoots = execSync(
      "security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain",
      { encoding: "utf-8", stdio: "pipe" },
    );

    // Also export from System.keychain (contains user-added enterprise CAs)
    let systemKeychain = "";
    try {
      systemKeychain = execSync("security find-certificate -a -p /Library/Keychains/System.keychain", {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (error) {
      // System.keychain might not exist or be accessible, continue with just system roots
      logInfo("Skipping System.keychain (may require elevated permissions)");
    }

    const combined = systemRoots + systemKeychain;
    if (!combined || !combined.includes("-----BEGIN CERTIFICATE-----")) {
      logWarning("No certificates found in macOS Keychain");
      return null;
    }

    return Buffer.from(combined, "utf-8");
  } catch (error) {
    logWarning(`Failed to export macOS trust store: ${error.message}`);
    return null;
  }
}

function exportLinuxRootCertificates() {
  // Try common Linux CA bundle locations in order of preference
  const caBundlePaths = [
    "/etc/ssl/certs/ca-certificates.crt", // Debian/Ubuntu/Gentoo
    "/etc/pki/tls/certs/ca-bundle.crt", // Fedora/RHEL/CentOS
    "/etc/ssl/ca-bundle.pem", // OpenSUSE
    "/etc/pki/tls/cacert.pem", // OpenELEC
    "/etc/ssl/cert.pem", // Alpine Linux
  ];

  for (const bundlePath of caBundlePaths) {
    if (fs.existsSync(bundlePath)) {
      try {
        const buffer = fs.readFileSync(bundlePath);
        if (buffer.length > 0 && buffer.toString("utf-8").includes("-----BEGIN CERTIFICATE-----")) {
          logInfo(`Using CA bundle from: ${bundlePath}`);
          return buffer;
        }
      } catch (error) {
        logWarning(`Failed to read CA bundle at ${bundlePath}: ${error.message}`);
      }
    }
  }

  logWarning("No CA bundle found at common Linux locations. Skipping corporate CA sync.");
  logInfo("Searched paths: " + caBundlePaths.join(", "));
  return null;
}

function saveDockerBuildCABundle(caBundle) {
  if (!caBundle) {
    logWarning("No CA bundle to save for Docker builds.");
    return;
  }

  const dockerCertsDir = path.join(WORKSPACE_ROOT, ".workspace-certs");
  const dockerCertPath = path.join(dockerCertsDir, "workspace-enterprise-roots.pem");

  try {
    if (!fs.existsSync(dockerCertsDir)) {
      fs.mkdirSync(dockerCertsDir, { recursive: true });
    }
    fs.writeFileSync(dockerCertPath, caBundle);
    logSuccess(`Saved CA bundle for Docker builds: ${path.relative(WORKSPACE_ROOT, dockerCertPath)}`);
  } catch (error) {
    logWarning(`Failed to save Docker build CA bundle: ${error.message}`);
  }
}

function streamBufferToPodmanMachine(machineName, remotePath, buffer) {
  try {
    execSync(`podman machine ssh ${machineName} "cat > ${remotePath}"`, {
      cwd: WORKSPACE_ROOT,
      input: buffer,
      stdio: "pipe",
      shell: true,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function listKindNodes() {
  const result = run(`podman ps --format {{.Names}} --filter label=io.x-k8s.kind.cluster=${KIND_CLUSTER_NAME}`, {
    silent: true,
  });

  if (!result.success) {
    return [];
  }

  return result.output
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function ensureNodeDirectory(nodeName, targetPath) {
  const normalized = targetPath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const dir = lastSlash > 0 ? normalized.slice(0, lastSlash) : "/";
  const result = run(`podman exec ${nodeName} mkdir -p ${dir}`, { silent: true });
  return result.success;
}

function copyBufferToNode(nodeName, buffer, targetPath) {
  const tempPath = path.join(os.tmpdir(), `kind-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  try {
    fs.writeFileSync(tempPath, buffer);
    if (!ensureNodeDirectory(nodeName, targetPath)) {
      return false;
    }
    const copyResult = run(`podman cp "${tempPath}" ${nodeName}:${targetPath}`, { silent: true });
    return copyResult.success;
  } catch (error) {
    return false;
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      // ignore cleanup errors
    }
  }
}

function configureNodeSystemTrust(nodeName, caBuffer) {
  const targetPath = "/usr/local/share/ca-certificates/workspace-enterprise-roots.crt";
  if (!copyBufferToNode(nodeName, caBuffer, targetPath)) {
    logWarning(`Failed to copy enterprise CA bundle into ${nodeName}`);
    return false;
  }
  const updateResult = run(`podman exec ${nodeName} update-ca-certificates`, { silent: true });
  if (!updateResult.success) {
    logWarning(`update-ca-certificates failed on ${nodeName}. TLS for OS utilities may still break.`);
    logInfo(updateResult.output.trim());
    return false;
  }
  return true;
}

function buildHostsToml(server) {
  return [
    `server = "${server}"`,
    "",
    `[host."${server}"]`,
    '  capabilities = ["pull", "resolve"]',
    `  ca = ["${CONTAINERD_CA_PATH}"]`,
    "",
  ].join("\n");
}

function buildLocalRegistryHostsToml(endpoint) {
  return [`server = "${endpoint}"`, "", `[host."${endpoint}"]`, '  capabilities = ["pull", "resolve"]', ""].join("\n");
}

function configureNodeContainerdTrust(nodeName, caBuffer) {
  if (!copyBufferToNode(nodeName, caBuffer, CONTAINERD_CA_PATH)) {
    logWarning(`Failed to copy CA bundle into containerd path on ${nodeName}`);
    return false;
  }

  // Create hosts.toml files for external registries (docker.io, ghcr.io, etc.)
  // so they use the enterprise CA bundle. The local registry mirror is already
  // configured via Kind's containerdConfigPatches, so we don't need hosts.toml for it.
  let hostsFailures = 0;

  REGISTRY_HOSTS.forEach((registry) => {
    const hostsContent = buildHostsToml(registry.server);
    const targetPath = `/etc/containerd/certs.d/${registry.name}/hosts.toml`;
    const wrote = copyBufferToNode(nodeName, Buffer.from(hostsContent, "utf8"), targetPath);
    if (!wrote) {
      hostsFailures += 1;
      logWarning(`Failed to write hosts.toml for ${registry.name} on ${nodeName}`);
    }
  });

  return hostsFailures === 0;
}

function propagateTrustToKindNodes() {
  const caBuffer = getHostCABundleBuffer();
  if (!caBuffer) {
    logWarning("Skipping Kind node trust sync because host CA export failed.");
    return;
  }

  const nodes = listKindNodes();
  if (!nodes.length) {
    logInfo("No Kind nodes detected for CA propagation (cluster may not be running yet).");
    return;
  }

  nodes.forEach((node) => {
    const systemTrustOk = configureNodeSystemTrust(node, caBuffer);
    const containerdTrustOk = configureNodeContainerdTrust(node, caBuffer);
    if (systemTrustOk && containerdTrustOk) {
      logSuccess(`Propagated Windows trust store + containerd config to ${node}`);
    } else {
      logWarning(`Completed trust sync for ${node} with warnings.`);
    }
  });
}

function kindClusterExists() {
  const result = run("kind get clusters", { silent: true, env: KIND_ENV });
  if (!result.success) {
    return false;
  }
  return result.output
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .includes(KIND_CLUSTER_NAME);
}

function kindClusterHealthy() {
  const result = run("kubectl cluster-info", { silent: true, env: KIND_ENV });
  return result.success;
}

function writeKindConfigFile() {
  const config = {
    kind: "Cluster",
    apiVersion: "kind.x-k8s.io/v1alpha4",
    // Enable pulling images from the persistent local registry.
    // This mapping allows any image tag prefixed with localhost:5001/... to be pulled
    // from the registry container via the Kind network.
    containerdConfigPatches: [
      // Mirror localhost:<port> pulls to the in-network registry container.
      // This allows Kubernetes to pull images tagged as localhost:5001/... from the
      // kind-registry container accessible at kind-registry:5000 within the Kind network.
      `[plugins.\"io.containerd.grpc.v1.cri\".registry.mirrors.\"localhost:${LOCAL_REGISTRY_PORT}\"]\n  endpoint = [\"http://${LOCAL_REGISTRY_NAME}:${LOCAL_REGISTRY_INTERNAL_PORT}\"]\n`,
    ],
    nodes: [],
  };

  config.nodes.push({ role: "control-plane" });
  for (let i = 1; i < CLUSTER_CONFIG.nodes; i++) {
    config.nodes.push({ role: "worker" });
  }

  const filePath = path.join(os.tmpdir(), `kind-config-${Date.now()}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(config));
  return filePath;
}

function createKindCluster() {
  const configPath = writeKindConfigFile();
  logInfo(`Creating Kind cluster '${KIND_CLUSTER_NAME}' using kindest/node:${CLUSTER_CONFIG.kubernetesVersion}`);
  const command = [
    "kind create cluster",
    `--name ${KIND_CLUSTER_NAME}`,
    `--image kindest/node:${CLUSTER_CONFIG.kubernetesVersion}`,
    `--config ${configPath}`,
  ].join(" ");

  const result = run(command, { env: KIND_ENV });
  fs.unlinkSync(configPath);

  if (!result.success) {
    logError("Failed to create Kind cluster");
    logInfo("Try running the command above manually for more details.");
    process.exit(1);
  }

  logSuccess("Kind cluster created");
}

function repairKindCluster() {
  logWarning("Cluster exists but failed health checks. Recreating...");
  run(`kind delete cluster --name ${KIND_CLUSTER_NAME}`, { env: KIND_ENV });
  createKindCluster();
}

function ensureKindCluster() {
  if (!kindClusterExists()) {
    createKindCluster();
    return;
  }

  logSuccess(`Kind cluster '${KIND_CLUSTER_NAME}' already exists`);
  if (!kindClusterHealthy()) {
    repairKindCluster();
  }
}

function ensureKubectlContext() {
  const result = run(`kubectl config use-context ${KIND_CONTEXT}`, { silent: true });
  if (result.success) {
    logSuccess(`kubectl context switched to ${KIND_CONTEXT}`);
  } else {
    logWarning(`Could not switch kubectl context to ${KIND_CONTEXT}. You may need to run it manually.`);
  }
}

function applyLocalResources() {
  logInfo("Applying infra/k8s/podman/local manifests...");
  const result = run("kustomize build infra/k8s/podman/local --enable-alpha-plugins | kubectl apply -f -");
  if (result.success) {
    logSuccess("Local resources applied successfully");
  } else {
    logWarning("Failed to apply resources automatically. Run pnpm run infra:local:k8s-resources:apply later.");
  }
}

async function main() {
  log("\n╔══════════════════════════════════════════════════════╗", "cyan");
  log("║    Setting up Kind + Podman local Kubernetes stack   ║", "cyan");
  log("╚══════════════════════════════════════════════════════╝\n", "cyan");

  ensureBinaryExists("podman", "Install Podman Desktop from https://podman-desktop.io/");
  ensureBinaryExists("kind", "Install Kind from https://kind.sigs.k8s.io/docs/user/quick-start/");
  ensureBinaryExists("kubectl", "Install kubectl from https://kubernetes.io/docs/tasks/tools/");
  ensureBinaryExists("kustomize", "Install kustomize from https://kubectl.docs.kubernetes.io/installation/kustomize/");

  const machineName = ensurePodmanMachine();
  logInfo(`Using Podman machine '${machineName}'`);
  installCABundleInPodmanMachine(machineName);

  // Registry is persistent across cluster deletes, so ensure it early.
  ensureLocalRegistry();

  ensureKindCluster();
  // Kind network may only exist after cluster creation, so ensure/connect again.
  ensureLocalRegistry();
  propagateTrustToKindNodes();
  ensureKubectlContext();
  applyRegistryHostingConfigMap();

  if (SHOULD_APPLY) {
    applyLocalResources();
  } else {
    logInfo("Skipping resource deployment (pass --apply to deploy immediately).");
  }

  log("\nKind + Podman environment is ready!", "green");
  logInfo("Next steps:");
  logInfo("  • Deploy manifests: pnpm run skaffold:deploy");
  logInfo("  • Delete cluster:  pnpm run infra:local:cluster:delete");
}

main().catch((error) => {
  logError(`Unexpected error: ${error.message}`);
  process.exit(1);
});
