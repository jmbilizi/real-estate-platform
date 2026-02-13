#!/usr/bin/env node

/**
 * Skaffold custom build script
 *
 * Contract:
 * - Skaffold sets IMAGE env var to the fully qualified image name + tag it expects.
 * - This script must ensure that image is available to the cluster.
 *
 * This repo's local workflow uses a registry-first image distribution model.
 *
 * Contract:
 * - IMAGE is the fully qualified image reference Skaffold expects.
 * - This script builds that image and pushes it to the registry implied by IMAGE.
 *
 * Local dev typically uses localhost:5001.
 * CI/CD can later use GHCR (ghcr.io/...) with the same build/push logic.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const { applyLocalRetention } = require("./registry-retention");

const workspaceRoot = path.resolve(__dirname, "../..");

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: workspaceRoot,
    stdio: opts.stdio ?? "inherit",
    shell: process.platform === "win32",
    encoding: "utf-8",
  });
  return result.status ?? 1;
}

function must(status, message) {
  if (status !== 0) {
    throw new Error(message);
  }
}

function buildImage(image) {
  // Keep the build explicit and repo-root anchored.
  // NOTE: We currently have a single artifact (api-gateway) so a fixed Dockerfile is OK.
  const status = run("podman", ["build", "-f", "apps/api-gateway/Dockerfile", "-t", image, "."]);
  must(status, "podman build failed");
}

function pushImage(image) {
  // Local dev registry is plain HTTP (no TLS). Podman defaults to HTTPS unless told otherwise.
  // Keep TLS verification enabled for real registries (e.g., GHCR).
  const isLocalHttpRegistry =
    image.startsWith("localhost:5001/") || image.startsWith("127.0.0.1:5001/") || image.startsWith("localhost/");

  const args = ["push"];
  if (isLocalHttpRegistry) {
    args.push("--tls-verify=false");
  }
  args.push(image);

  const status = run("podman", args);
  must(status, "podman push failed");
}

function cleanupOnFailure(image) {
  // Best-effort cleanup to avoid leaking disk space during failing build loops.
  run("podman", ["rmi", "-f", image], { stdio: ["ignore", "ignore", "ignore"] });
  run("podman", ["image", "prune", "-f"], { stdio: ["ignore", "ignore", "ignore"] });
}

async function main() {
  const image = process.env.IMAGE;
  if (!image) {
    throw new Error("Skaffold did not provide IMAGE env var");
  }

  const pushImageRequested = String(process.env.PUSH_IMAGE || "").toLowerCase() === "true";

  try {
    buildImage(image);

    if (pushImageRequested) {
      pushImage(image);

      const keepLast = Number(process.env.KIND_LOCAL_REGISTRY_KEEP_LAST || "3");
      await applyLocalRetention({ image, keepLast }).catch(() => {
        // Never fail the build because retention couldn't run.
      });
    }
  } catch (e) {
    cleanupOnFailure(image);
    throw e;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
