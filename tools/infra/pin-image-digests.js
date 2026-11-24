'use strict';

/**
 * Pins the first-party images of the built workloads to the digest the registry serves.
 *
 * One rule for every environment and every workload kind: a deploy never applies a first-party
 * image by tag.
 *
 * A mutable tag (`:dev`, `:test`, `:latest`) does not name one image. The k3s embedded registry
 * mirror answers a tag from the image store of a cluster node. A node then pulls the image
 * another node holds, not the image the registry serves. On the dev cluster a restarted pod
 * kept the old image for 13 days while every deploy reported success.
 *
 * A digest names one image. The mirror cannot answer it with other content. A new image also
 * changes the pod template, so `kubectl apply` starts the rollout. No restart is necessary.
 *
 * The script rewrites `image: <prefix><name>:<tag>` to `image: <prefix><name>:<tag>@sha256:...`
 * in Deployment, StatefulSet and DaemonSet documents. `--scope` limits it to the workloads the
 * run applies. A service that deploy-control gates off can have no image in the registry, and it
 * must not stop the deploy.
 *
 * A pinned StatefulSet restarts when its image changes, and only then. That is the purpose: with
 * a tag and `imagePullPolicy: IfNotPresent`, a rebuilt database image never reached a node that
 * held the tag.
 *
 * A CronJob or Job is not a rollout workload and is not in the scope file. The script names each
 * first-party tag it finds there, so the gap is visible.
 *
 * It fails closed. If one digest does not resolve, it writes nothing and exits 1. A deploy that
 * falls back to the tag can replace a pinned image with an older one.
 *
 * Usage: node pin-image-digests.js --manifests <file> --prefix <ghcr.io/owner/repo/>
 *                                  [--scope <file of KIND|NAMESPACE|NAME lines>]
 */

const fs = require('node:fs');
const { fetchRegistryDigest } = require('./deployment-image-changed');

const DIGEST = /^sha256:[0-9a-f]{64}$/;
// `image: ref`, `- image: ref`, with or without quotes. kustomize writes one image per line.
const IMAGE_LINE = /^(\s*(?:-\s+)?image:\s*)(["']?)([^"'\s#]+)\2(\s*\r?)$/;
const SEPARATOR = /^---\s*$/;
/** The kinds `tools/infra/deploy-scope.js` writes to scope.txt. */
const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
const SCHEDULED_KINDS = ['CronJob', 'Job'];

function scalar(lines, pattern) {
  for (const line of lines) {
    const value = pattern.exec(line)?.[1];
    if (value !== undefined) return value.trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return null;
}

/** `metadata.name` and `metadata.namespace`: the keys two spaces under a column-0 `metadata:`. */
function metadataOf(lines) {
  const start = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (start < 0) return { name: null, namespace: 'default' };
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    block.push(line);
  }
  return {
    name: scalar(block, /^ {2}name:\s*(.+?)\s*$/),
    namespace: scalar(block, /^ {2}namespace:\s*(.+?)\s*$/) ?? 'default',
  };
}

/** Split a multi-document YAML text into documents, with the separator lines kept. */
function splitDocuments(text) {
  const documents = [];
  let current = [];
  for (const line of text.split('\n')) {
    if (SEPARATOR.test(line)) {
      documents.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  documents.push(current);
  return documents.map((lines) => ({
    kind: scalar(lines, /^kind:\s*(.+?)\s*$/),
    ...metadataOf(lines),
    lines,
  }));
}

/** @param {Set<string>} [scope] `KIND|NAMESPACE|NAME` keys. Without it, every workload. */
function inScope(document, scope) {
  if (!WORKLOAD_KINDS.includes(document.kind)) return false;
  return !scope || scope.has(`${document.kind}|${document.namespace}|${document.name}`);
}

function isPinnable(ref, prefix) {
  return ref.startsWith(prefix) && !ref.includes('@');
}

/** The tag references to resolve: first-party, not pinned yet, in an in-scope workload. */
function findPinnableImages(text, { prefix, scope }) {
  const found = new Set();
  for (const document of splitDocuments(text)) {
    if (!inScope(document, scope)) continue;
    for (const line of document.lines) {
      const ref = IMAGE_LINE.exec(line)?.[3];
      if (ref && isPinnable(ref, prefix)) found.add(ref);
    }
  }
  return [...found].sort();
}

/** First-party tag references in a CronJob or Job. The scope file does not list these kinds. */
function findScheduledTagImages(text, { prefix }) {
  const found = [];
  for (const document of splitDocuments(text)) {
    if (!SCHEDULED_KINDS.includes(document.kind)) continue;
    for (const line of document.lines) {
      const ref = IMAGE_LINE.exec(line)?.[3];
      if (ref && isPinnable(ref, prefix)) found.push(`${document.kind}/${document.name}: ${ref}`);
    }
  }
  return found;
}

/**
 * Rewrite each pinnable reference to `<ref>@<digest>`.
 *
 * @param {string} text multi-document YAML.
 * @param {{prefix: string, scope?: Set<string>, digests: Record<string, string>}} options
 * @returns {{text: string, pinned: number}}
 */
function pinManifests(text, { prefix, scope, digests }) {
  let pinned = 0;
  const output = [];
  for (const document of splitDocuments(text)) {
    const scoped = inScope(document, scope);
    for (const line of document.lines) {
      const match = scoped ? IMAGE_LINE.exec(line) : null;
      if (!match || !isPinnable(match[3], prefix)) {
        output.push(line);
        continue;
      }
      const [, lead, quote, ref, trail] = match;
      const digest = digests[ref];
      if (!digest || !DIGEST.test(digest)) {
        throw new Error(`no valid digest for ${ref}: ${digest ?? 'none'}`);
      }
      output.push(`${lead}${quote}${ref}@${digest}${quote}${trail}`);
      pinned += 1;
    }
  }
  return { text: output.join('\n'), pinned };
}

/** Resolve one reference. A registry can fail for a moment, so try three times. */
async function resolveWithRetry(ref, { resolveDigest, attempts = 3, delayMs = 2000 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const digest = await resolveDigest(ref);
      if (!DIGEST.test(digest)) throw new Error(`registry returned digest "${digest}"`);
      return digest;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${ref}: ${lastError.message}`);
}

/**
 * @returns {Promise<{text: string, digests: Record<string, string>, pinned: number}>}
 */
async function pin(text, { prefix, scope, resolveDigest = fetchRegistryDigest, delayMs }) {
  const refs = findPinnableImages(text, { prefix, scope });
  const settled = await Promise.allSettled(
    refs.map((ref) => resolveWithRetry(ref, { resolveDigest, delayMs })),
  );
  // Report every image that fails, not the first one. A new environment can lack them all.
  const failures = settled.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  if (failures.length > 0) {
    const list = failures.map((failure) => `     - ${failure}`).join('\n');
    throw new Error(`${failures.length} of ${refs.length} image(s) did not resolve:\n${list}`);
  }
  const digests = Object.fromEntries(refs.map((ref, i) => [ref, settled[i].value]));
  return { ...pinManifests(text, { prefix, scope, digests }), digests };
}

/** Read `KIND|NAMESPACE|NAME` lines, the format of `scope.txt`. */
function readScope(file) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  return new Set(lines.map((line) => line.trim()).filter(Boolean));
}

function argValue(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv) {
  const file = argValue(argv, 'manifests');
  const prefix = argValue(argv, 'prefix');
  const scopeFile = argValue(argv, 'scope');
  if (!file || !prefix) {
    console.error(
      'Usage: pin-image-digests.js --manifests <file> --prefix <prefix> [--scope <file>]',
    );
    return 1;
  }
  let result;
  let text;
  try {
    text = fs.readFileSync(file, 'utf-8');
    const scope = scopeFile ? readScope(scopeFile) : undefined;
    result = await pin(text, { prefix, scope });
  } catch (error) {
    console.error(`❌ Cannot pin the image digests: ${error.message}`);
    console.error('   Nothing is written. The deploy stops before it applies a manifest.');
    console.error('   A 404 means the registry does not hold that tag. Build and push the image');
    console.error('   for this environment (build-push-images.yml), then run the deploy again.');
    return 1;
  }
  for (const entry of findScheduledTagImages(text, { prefix })) {
    console.log(
      `::warning::${entry} deploys by tag. The digest pin covers rollout workloads only.`,
    );
  }
  if (result.pinned === 0) {
    console.log(`ℹ️  No workload in scope uses a ${prefix} image by tag. Nothing is pinned.`);
    return 0;
  }
  fs.writeFileSync(file, result.text);
  for (const [ref, digest] of Object.entries(result.digests)) {
    console.log(`   📌 ${ref} -> ${digest}`);
  }
  console.log(`✅ Pinned ${result.pinned} image reference(s) in the in-scope workloads`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = {
  findPinnableImages,
  findScheduledTagImages,
  pinManifests,
  pin,
  splitDocuments,
};
