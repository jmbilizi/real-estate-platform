'use strict';

/**
 * Decides whether a Deployment needs `kubectl rollout restart` (#954).
 *
 * Our images use mutable tags, so the restart exists to pull a newer image. A restart with no
 * newer image only churns pods. This script compares the digest the registry serves for each
 * first-party image with the digest each running pod reports in `imageID`.
 *
 * Fail-safe rule: any doubt means restart. A failed probe never reads as "unchanged".
 *
 * Usage: node deployment-image-changed.js --deployment-json <f> --pods-json <f> --prefix <p>
 * Output: one line, `restart <reason>` or `skip <reason>`. Exit 0 on a decision.
 */

const fs = require('node:fs');

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

/** Split `ghcr.io/owner/repo/name:tag` into registry, repository and tag. */
function parseImageRef(image) {
  const slash = image.indexOf('/');
  if (slash < 0) return null;
  const registry = image.slice(0, slash);
  let rest = image.slice(slash + 1);
  if (rest.includes('@')) return null;
  let tag = 'latest';
  const colon = rest.lastIndexOf(':');
  if (colon > rest.lastIndexOf('/')) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
  }
  return { registry, repository: rest, tag };
}

/** Anonymous pull token, then the digest the tag points to. Throws on any failure. */
async function fetchRegistryDigest(image, fetchImpl = fetch) {
  const ref = parseImageRef(image);
  if (!ref) throw new Error(`cannot parse image reference ${image}`);
  const tokenUrl = `https://${ref.registry}/token?service=${ref.registry}&scope=repository:${ref.repository}:pull`;
  const tokenRes = await fetchImpl(tokenUrl);
  if (!tokenRes.ok) throw new Error(`token request returned ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  if (!token) throw new Error('token response has no token');
  const res = await fetchImpl(`https://${ref.registry}/v2/${ref.repository}/manifests/${ref.tag}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
  });
  if (!res.ok) throw new Error(`manifest request returned ${res.status}`);
  const digest = res.headers.get('docker-content-digest');
  if (!digest) throw new Error('manifest response has no digest header');
  return digest;
}

function firstPartyImages(deployment, prefix) {
  const spec = deployment?.spec?.template?.spec ?? {};
  const all = [...(spec.initContainers ?? []), ...(spec.containers ?? [])];
  return [...new Set(all.map((c) => c.image).filter((i) => i && i.startsWith(prefix)))];
}

function runningPods(pods) {
  const running = [];
  for (const pod of pods?.items ?? []) {
    if (pod.metadata?.deletionTimestamp || pod.status?.phase !== 'Running') continue;
    const statuses = [
      ...(pod.status.containerStatuses ?? []),
      ...(pod.status.initContainerStatuses ?? []),
    ];
    running.push({ pod: pod.metadata.name, statuses });
  }
  return running;
}

/**
 * @returns {Promise<{restart: boolean, reason: string}>}
 */
async function decide({ deployment, pods, prefix, resolveDigest = fetchRegistryDigest }) {
  const images = firstPartyImages(deployment, prefix);
  if (images.length === 0) return { restart: true, reason: 'no first-party image found in spec' };
  const running = runningPods(pods);
  if (running.length === 0) return { restart: true, reason: 'no running pod to compare' };

  for (const image of images) {
    let digest;
    try {
      digest = await resolveDigest(image);
    } catch (error) {
      return { restart: true, reason: `registry probe failed for ${image}: ${error.message}` };
    }
    for (const { pod, statuses } of running) {
      const matching = statuses.filter((s) => s.image === image);
      if (matching.length === 0) {
        return { restart: true, reason: `pod ${pod} reports no status for ${image}` };
      }
      for (const status of matching) {
        if (!status.imageID || !status.imageID.endsWith(`@${digest}`)) {
          return {
            restart: true,
            reason: `pod ${pod} runs ${status.imageID || 'unknown image id'}, registry serves ${digest}`,
          };
        }
      }
    }
  }
  return {
    restart: false,
    reason: `all running pods use the registry digest for ${images.join(', ')}`,
  };
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
  const deploymentFile = argValue(argv, 'deployment-json');
  const podsFile = argValue(argv, 'pods-json');
  const prefix = argValue(argv, 'prefix');
  if (!deploymentFile || !podsFile || !prefix) {
    console.log('restart missing arguments');
    return 0;
  }
  try {
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf-8'));
    const pods = JSON.parse(fs.readFileSync(podsFile, 'utf-8'));
    const { restart, reason } = await decide({ deployment, pods, prefix });
    console.log(`${restart ? 'restart' : 'skip'} ${reason}`);
  } catch (error) {
    console.log(`restart unreadable input: ${error.message}`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = { parseImageRef, fetchRegistryDigest, decide, firstPartyImages };
