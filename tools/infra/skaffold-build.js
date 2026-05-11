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

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const { applyLocalRetention } = require('./registry-retention');

const workspaceRoot = path.resolve(__dirname, '../..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: workspaceRoot,
    stdio: opts.stdio ?? 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf-8',
  });
  return result.status ?? 1;
}

function must(status, message) {
  if (status !== 0) {
    throw new Error(message);
  }
}

/**
 * Extract project name from fully qualified image reference
 * Examples:
 *   localhost:5001/api-gateway:tag -> api-gateway
 *   ghcr.io/owner/repo/messaging-service:dev -> messaging-service
 */
function extractProjectName(image) {
  // Remove tag first (everything after last ':' that's not part of registry port)
  let imageWithoutTag = image;
  const lastColonIndex = image.lastIndexOf(':');
  const lastSlashIndex = image.lastIndexOf('/');

  // If colon is after last slash, it's a tag (not a registry port)
  if (lastColonIndex > lastSlashIndex) {
    imageWithoutTag = image.substring(0, lastColonIndex);
  }

  // Extract last segment (project name)
  const segments = imageWithoutTag.split('/');
  return segments[segments.length - 1];
}

/**
 * Load image-name overrides from the centralized map.
 * Maps image names (from Skaffold) back to project directories
 * when the image name differs from the filesystem directory name.
 */
function loadImagePathOverrides() {
  const mapPath = path.join(workspaceRoot, 'tools/docker/image-name-map.json');
  if (!fs.existsSync(mapPath)) return {};
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  // Invert: imageName → dockerfilePath (skaffold-build receives imageName, needs directory)
  const overrides = {};
  for (const [, entry] of Object.entries(map)) {
    if (entry.imageName && entry.dockerfilePath) {
      overrides[entry.imageName] = entry.dockerfilePath;
    }
  }
  return overrides;
}

/**
 * Detect Dockerfile location for a project (scale-ready)
 * Searches common monorepo patterns
 */
function detectDockerfile(projectName) {
  // Check centralized image-name overrides first
  const overrides = loadImagePathOverrides();
  if (overrides[projectName]) {
    const overridePath = `${overrides[projectName]}/Dockerfile`;
    const abs = path.join(workspaceRoot, overridePath);
    if (fs.existsSync(abs)) {
      return overridePath;
    }
    throw new Error(
      `Dockerfile not found at override path: ${overridePath}\n` +
        `Check tools/docker/image-name-map.json`,
    );
  }

  const searchPatterns = [
    `apps/${projectName}/Dockerfile`,
    `apps/services/${projectName}/Dockerfile`,
    `libs/${projectName}/Dockerfile`,
    `apps/backend/${projectName}/Dockerfile`,
    `apps/frontend/${projectName}/Dockerfile`,
  ];

  for (const pattern of searchPatterns) {
    const dockerfilePath = path.join(workspaceRoot, pattern);
    if (fs.existsSync(dockerfilePath)) {
      return pattern; // Return relative path for podman -f flag
    }
  }

  throw new Error(
    `Dockerfile not found for project: ${projectName}\n` +
      `Searched:\n` +
      searchPatterns.map((p) => `  - ${p}`).join('\n'),
  );
}

function buildImage(image) {
  // Extract project name from image reference
  const projectName = extractProjectName(image);
  console.log(`Building project: ${projectName}`);

  // Auto-detect Dockerfile location (scales to any number of services)
  const dockerfilePath = detectDockerfile(projectName);
  console.log(`Found Dockerfile: ${dockerfilePath}`);

  const args = [
    'build',
    '-f',
    dockerfilePath,
    '--build-arg',
    'BUILD_CONFIGURATION=Release',
    '--build-arg',
    'COPY_CERTS=true', // Local dev needs enterprise certs
    '--build-arg',
    'PRE_DOWNLOAD_MODEL=false', // HuggingFace may be unreachable behind corporate proxy; download at runtime
    '-t',
    image,
    '.',
  ];
  const status = run('podman', args);
  must(status, 'podman build failed');
}

function pushImage(image) {
  // Local dev registry is plain HTTP (no TLS). Podman defaults to HTTPS unless told otherwise.
  // Keep TLS verification enabled for real registries (e.g., GHCR).
  const isLocalHttpRegistry =
    image.startsWith('localhost:5001/') ||
    image.startsWith('127.0.0.1:5001/') ||
    image.startsWith('localhost/');

  const args = ['push'];
  if (isLocalHttpRegistry) {
    args.push('--tls-verify=false');
  }
  args.push(image);

  const status = run('podman', args);
  must(status, 'podman push failed');
}

function cleanupOnFailure(image) {
  // Best-effort cleanup to avoid leaking disk space during failing build loops.
  run('podman', ['rmi', '-f', image], { stdio: ['ignore', 'ignore', 'ignore'] });
  run('podman', ['image', 'prune', '-f'], { stdio: ['ignore', 'ignore', 'ignore'] });
}

async function main() {
  const image = process.env.IMAGE;
  if (!image) {
    throw new Error('Skaffold did not provide IMAGE env var');
  }

  const pushImageRequested = String(process.env.PUSH_IMAGE || '').toLowerCase() === 'true';

  try {
    buildImage(image);

    if (pushImageRequested) {
      pushImage(image);

      const keepLast = Number(process.env.KIND_LOCAL_REGISTRY_KEEP_LAST || '3');
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
