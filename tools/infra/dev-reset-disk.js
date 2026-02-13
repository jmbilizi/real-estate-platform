#!/usr/bin/env node

/*
 * dev-reset-disk
 *
 * One-stop local dev disk cleanup for the Kind + Podman + local registry workflow.
 *
 * What it does:
 * - Best-effort: `skaffold delete` via the repo wrapper (removes k8s resources)
 * - Delete the local registry container + its data volume (biggest disk hog)
 * - Recreate an empty registry (so the next `skaffold` just works)
 * - Prune Podman images/cache (best-effort)
 *
 * This is intentionally conservative: it does NOT delete arbitrary Podman volumes.
 */

const { spawnSync } = require("child_process");
const path = require("path");

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

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function logStep(title) {
  process.stdout.write(`\n=== ${title} ===\n`);
}

function warn(message) {
  process.stderr.write(`WARN: ${message}\n`);
}

async function main() {
  const argv = process.argv.slice(2);

  const skipSkaffoldDelete = hasFlag(argv, "--skip-skaffold-delete");
  const skipRegistryReset = hasFlag(argv, "--skip-registry-reset");
  const skipRegistryEnsure = hasFlag(argv, "--no-ensure-registry") || hasFlag(argv, "--skip-registry-ensure");
  const skipPodmanPrune = hasFlag(argv, "--skip-podman-prune");

  if (!skipSkaffoldDelete) {
    logStep("Deleting k8s resources (skaffold delete)");
    const status = run("node", ["tools/infra/run-skaffold.js", "delete"], { stdio: "inherit" });
    if (status !== 0) {
      warn("skaffold delete failed (continuing cleanup anyway)");
    }
  }

  if (!skipRegistryReset) {
    logStep("Resetting local registry (delete container + volume)");
    const delStatus = run("node", ["tools/infra/local-registry.js", "delete"], { stdio: "inherit" });
    if (delStatus !== 0) {
      warn("local registry delete failed (continuing cleanup anyway)");
    }

    if (!skipRegistryEnsure) {
      logStep("Recreating empty local registry");
      const ensureStatus = run("node", ["tools/infra/local-registry.js", "ensure"], { stdio: "inherit" });
      if (ensureStatus !== 0) {
        warn("local registry ensure failed (you may need to run `npm run infra:local:registry:ensure` manually)");
      }
    }
  }

  if (!skipPodmanPrune) {
    logStep("Pruning Podman images/cache (best-effort)");
    // These are safe defaults for reclaiming space without deleting arbitrary named volumes.
    run("podman", ["image", "prune", "-f"], { stdio: "inherit" });
    run("podman", ["system", "prune", "-f"], { stdio: "inherit" });
  }

  logStep("Done");
  process.stdout.write("Disk cleanup complete. Next: `node tools/infra/dev-skaffold.js`\n");
}

main().catch((e) => {
  console.error(e && (e.stack || e.message) ? e.stack || e.message : e);
  process.exit(1);
});
