#!/usr/bin/env node

/*
 * Local persistent registry for Kind + Podman
 *
 * Goals:
 * - Registry persists across Kind cluster deletes
 * - Cluster setup always ensures registry exists and is running
 * - Separate command to delete registry + data volume
 *
 * Default:
 * - Host: localhost:5001
 * - Container: kind-registry
 * - Volume: kind-registry-data
 */

const { spawnSync } = require("child_process");

const { getLocalRegistryConfig } = require("./registry-settings");

const registryConfig = getLocalRegistryConfig();
const REGISTRY_NAME = registryConfig.name;
const REGISTRY_PORT = registryConfig.hostPort; // host port
const REGISTRY_IMAGE = registryConfig.image;
const REGISTRY_VOLUME = registryConfig.volume;
const KIND_NETWORK = registryConfig.kindNetwork;

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    encoding: "utf-8",
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").toString(),
    stderr: (result.stderr || "").toString(),
  };
}

function mustOk(res, message) {
  if (res.status !== 0) {
    process.stderr.write(res.stderr || res.stdout);
    throw new Error(message);
  }
}

function containerExists() {
  const res = run("podman", ["container", "exists", REGISTRY_NAME]);
  return res.status === 0;
}

function volumeExists() {
  const res = run("podman", ["volume", "exists", REGISTRY_VOLUME]);
  return res.status === 0;
}

function getContainerState() {
  const res = run("podman", ["inspect", "-f", "{{.State.Status}}", REGISTRY_NAME]);
  if (res.status !== 0) {
    return null;
  }
  return res.stdout.trim();
}

function containerHasDeleteEnabled() {
  const res = run("podman", ["inspect", "-f", "{{json .Config.Env}}", REGISTRY_NAME]);
  if (res.status !== 0 || !res.stdout.trim()) {
    return false;
  }

  try {
    const envList = JSON.parse(res.stdout.trim());
    return (
      Array.isArray(envList) && envList.some((e) => String(e).toUpperCase() === "REGISTRY_STORAGE_DELETE_ENABLED=TRUE")
    );
  } catch {
    return false;
  }
}

function ensureVolume() {
  if (volumeExists()) {
    return;
  }
  const res = run("podman", ["volume", "create", REGISTRY_VOLUME], { stdio: "inherit" });
  mustOk(res, "Failed to create registry volume");
}

function ensureContainer() {
  if (containerExists()) {
    // If we created the registry before delete support was enabled, recreate it (preserving the volume).
    // This unlocks pruning/garbage-collection workflows to keep disk usage bounded.
    if (!containerHasDeleteEnabled()) {
      console.log("Registry container exists but delete is not enabled; recreating container (volume preserved)...");
      run("podman", ["rm", "-f", REGISTRY_NAME], { stdio: "inherit" });
    } else {
      return;
    }
  }

  ensureVolume();

  const res = run(
    "podman",
    [
      "run",
      "-d",
      "--name",
      REGISTRY_NAME,
      "--restart=always",
      "-e",
      "REGISTRY_STORAGE_DELETE_ENABLED=true",
      "-p",
      `${REGISTRY_PORT}:5000`,
      "-v",
      `${REGISTRY_VOLUME}:/var/lib/registry`,
      REGISTRY_IMAGE,
    ],
    { stdio: "inherit" },
  );
  mustOk(res, "Failed to create registry container");
}

function ensureRunning() {
  ensureContainer();
  const state = getContainerState();
  if (state === "running") {
    return;
  }
  const res = run("podman", ["start", REGISTRY_NAME], { stdio: "inherit" });
  mustOk(res, "Failed to start registry container");
}

function networkExists() {
  const res = run("podman", ["network", "inspect", KIND_NETWORK]);
  return res.status === 0;
}

function connectToKindNetwork() {
  if (!networkExists()) {
    // Kind network may not exist until the cluster is created.
    return;
  }

  // Idempotent connect.
  const res = run("podman", ["network", "connect", KIND_NETWORK, REGISTRY_NAME]);
  if (res.status === 0) {
    return;
  }

  // Ignore "already exists" kinds of errors.
  const msg = (res.stderr || res.stdout || "").toLowerCase();
  if (msg.includes("already") || msg.includes("exists")) {
    return;
  }

  // Not fatal: registry is still usable from host, but cluster pulls may fail.
  process.stderr.write(res.stderr || res.stdout);
}

function status() {
  const exists = containerExists();
  if (!exists) {
    console.log(`Registry: missing (${REGISTRY_NAME})`);
    console.log(`Host: localhost:${REGISTRY_PORT}`);
    return;
  }

  const state = getContainerState();
  console.log(`Registry: ${REGISTRY_NAME} (${state || "unknown"})`);
  console.log(`Host: localhost:${REGISTRY_PORT}`);
  console.log(`Volume: ${REGISTRY_VOLUME}`);

  const ports = run("podman", ["port", REGISTRY_NAME]);
  if (ports.status === 0 && ports.stdout.trim()) {
    console.log("Ports:");
    process.stdout.write(ports.stdout);
  }
}

function removeRegistry({ removeVolume }) {
  if (containerExists()) {
    run("podman", ["rm", "-f", REGISTRY_NAME], { stdio: "inherit" });
  }

  if (removeVolume) {
    if (volumeExists()) {
      run("podman", ["volume", "rm", "-f", REGISTRY_VOLUME], { stdio: "inherit" });
    }
  }
}

function usage() {
  console.log("Usage: node tools/infra/local-registry.js <ensure|status|delete>");
  console.log("\nCommands:");
  console.log("  ensure   Create/start registry (persistent)");
  console.log("  status   Show registry state");
  console.log("  delete   Delete registry container + volume");
  console.log("\nEnv overrides:");
  console.log(
    "  KIND_LOCAL_REGISTRY_NAME, KIND_LOCAL_REGISTRY_PORT, KIND_LOCAL_REGISTRY_IMAGE, KIND_LOCAL_REGISTRY_VOLUME",
  );
}

async function main() {
  const [command] = process.argv.slice(2);

  if (!command || command === "-h" || command === "--help") {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === "ensure") {
    ensureRunning();
    connectToKindNetwork();
    status();
    return;
  }

  if (command === "status") {
    status();
    return;
  }

  if (command === "delete") {
    removeRegistry({ removeVolume: true });
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
