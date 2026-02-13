#!/usr/bin/env node

/*
 * Local registry + Podman image retention
 *
 * Goal: keep disk usage bounded during skaffold dev.
 *
 * Behavior (local dev registry only):
 * - Track successful pushes per repo
 * - Keep only the last N tags that successfully pushed
 * - Delete older tags from the registry (requires REGISTRY_STORAGE_DELETE_ENABLED=true)
 * - Run registry garbage-collect when deletes occur
 * - Remove corresponding local Podman images for deleted tags
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { getLocalRegistryConfig } = require("./registry-settings");

const registryConfig = getLocalRegistryConfig();
const REGISTRY_NAME = registryConfig.name;
const REGISTRY_PORT = registryConfig.hostPort;
const RETENTION_FILE_IN_CONTAINER = "/var/lib/registry/retention.json";

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

function podmanOk(args, opts = {}) {
  return run("podman", args, opts).status === 0;
}

function isLocalDevRegistry(registryHost) {
  return registryHost === `localhost:${REGISTRY_PORT}` || registryHost === `127.0.0.1:${REGISTRY_PORT}`;
}

function parseImageRef(image) {
  const noDigest = String(image).split("@")[0];
  const firstSlash = noDigest.indexOf("/");
  if (firstSlash <= 0) {
    throw new Error(`Invalid IMAGE reference: ${image}`);
  }

  const registryHost = noDigest.slice(0, firstSlash);
  const remainder = noDigest.slice(firstSlash + 1);

  const lastSlash = noDigest.lastIndexOf("/");
  const lastColon = noDigest.lastIndexOf(":");
  if (lastColon <= lastSlash) {
    throw new Error(`IMAGE must include a tag: ${image}`);
  }

  const repo = remainder.slice(0, lastColon - (firstSlash + 1));
  const tag = noDigest.slice(lastColon + 1);

  if (!repo || !tag) {
    throw new Error(`Invalid IMAGE reference: ${image}`);
  }

  return { registryHost, repo, tag };
}

function readRetentionState() {
  if (!podmanOk(["container", "exists", REGISTRY_NAME])) {
    return { version: 1, repos: {} };
  }

  const tmpFile = path.join(os.tmpdir(), `rep-registry-retention-${Date.now()}.json`);
  const cpRes = run("podman", ["cp", `${REGISTRY_NAME}:${RETENTION_FILE_IN_CONTAINER}`, tmpFile]);
  if (cpRes.status !== 0) {
    return { version: 1, repos: {} };
  }

  try {
    const raw = fs.readFileSync(tmpFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, repos: {} };
    }
    return {
      version: 1,
      repos: parsed.repos && typeof parsed.repos === "object" ? parsed.repos : {},
    };
  } catch {
    return { version: 1, repos: {} };
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

function writeRetentionState(state) {
  if (!podmanOk(["container", "exists", REGISTRY_NAME])) {
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `rep-registry-retention-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({ version: 1, repos: state.repos || {} }, null, 2) + "\n", "utf8");

  const cpRes = run("podman", ["cp", tmpFile, `${REGISTRY_NAME}:${RETENTION_FILE_IN_CONTAINER}`]);
  if (cpRes.status !== 0) {
    process.stderr.write(cpRes.stderr || cpRes.stdout);
  }

  try {
    fs.unlinkSync(tmpFile);
  } catch {
    // ignore
  }
}

function httpRequest({ method, path: requestPath, headers }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: Number(REGISTRY_PORT),
        method,
        path: requestPath,
        headers: headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

async function getManifestDigest(repo, tag) {
  const res = await httpRequest({
    method: "GET",
    path: `/v2/${repo}/manifests/${encodeURIComponent(tag)}`,
    headers: {
      Accept: "application/vnd.docker.distribution.manifest.v2+json",
    },
  });

  if (res.statusCode !== 200) {
    return null;
  }

  const digest = res.headers["docker-content-digest"];
  return digest ? String(digest) : null;
}

async function deleteManifest(repo, digest) {
  const res = await httpRequest({
    method: "DELETE",
    path: `/v2/${repo}/manifests/${encodeURIComponent(digest)}`,
  });

  // 202 accepted is success; 404 means already gone.
  return res.statusCode === 202 || res.statusCode === 404;
}

function deleteLocalPodmanImage(imageRef) {
  // Ignore failures (image might be in use or already removed).
  run("podman", ["rmi", "-f", imageRef], { stdio: ["ignore", "ignore", "ignore"] });
}

function garbageCollectRegistry() {
  if (!podmanOk(["container", "exists", REGISTRY_NAME])) {
    return;
  }

  // Best-effort; if this fails, disk usage may not shrink until the registry volume is reset.
  const res = run(
    "podman",
    ["exec", REGISTRY_NAME, "registry", "garbage-collect", "--delete-untagged", "/etc/docker/registry/config.yml"],
    {
      stdio: "inherit",
    },
  );

  if (res.status !== 0) {
    // Don't fail skaffold for GC issues.
    console.warn("WARN: registry garbage-collect failed; consider resetting local registry volume if disk grows.");
  }
}

async function applyLocalRetention({ image, keepLast }) {
  const { registryHost, repo, tag } = parseImageRef(image);

  // Never attempt remote pruning (GHCR, etc.).
  if (!isLocalDevRegistry(registryHost)) {
    return;
  }

  if (!podmanOk(["container", "exists", REGISTRY_NAME])) {
    return;
  }

  const keep = Number.isFinite(keepLast) && keepLast > 0 ? keepLast : 3;

  const state = readRetentionState();
  const list = Array.isArray(state.repos[repo]) ? state.repos[repo] : [];

  // Record this successful tag as the newest.
  const deduped = list.filter((t) => t !== tag);
  deduped.push(tag);

  const toDelete = deduped.slice(0, Math.max(0, deduped.length - keep));
  const keepList = deduped.slice(Math.max(0, deduped.length - keep));

  let deletedAny = false;

  for (const oldTag of toDelete) {
    try {
      const digest = await getManifestDigest(repo, oldTag);
      if (!digest) {
        continue;
      }

      const ok = await deleteManifest(repo, digest);
      if (ok) {
        deletedAny = true;
        deleteLocalPodmanImage(`${registryHost}/${repo}:${oldTag}`);
      }
    } catch {
      // Ignore per-tag failures.
    }
  }

  state.repos[repo] = keepList;
  writeRetentionState(state);

  if (deletedAny) {
    garbageCollectRegistry();
  }
}

module.exports = {
  applyLocalRetention,
};

// CLI mode (optional)
if (require.main === module) {
  const image = process.env.IMAGE;
  const keepLast = Number(process.env.KIND_LOCAL_REGISTRY_KEEP_LAST || "3");
  if (!image) {
    console.error("ERROR: IMAGE env var is required");
    process.exit(1);
  }

  applyLocalRetention({ image, keepLast })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`ERROR: ${e.message || e}`);
      process.exit(1);
    });
}
