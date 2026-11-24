'use strict';

/**
 * Pins the first-party images of the built Deployments to the digest the registry serves.
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
 * in Deployment documents. `--deployments` limits it to the Deployments the run applies. A
 * service that deploy-control gates off can have no image in the registry, and it must not stop
 * the deploy. Other kinds keep the tag: a StatefulSet template change restarts a database.
 *
 * It fails closed. If one digest does not resolve, it writes nothing and exits 1. A deploy that
 * falls back to the tag can replace a pinned image with an older one.
 *
 * Usage: node pin-image-digests.js --manifests <file> --prefix <ghcr.io/owner/repo/>
 *                                  [--deployments <file of NAMESPACE|NAME lines>]
 */

const fs = require('node:fs');
const { fetchRegistryDigest } = require('./deployment-image-changed');

const DIGEST = /^sha256:[0-9a-f]{64}$/;
// `image: ref`, `- image: ref`, with or without quotes. kustomize writes one image per line.
const IMAGE_LINE = /^(\s*(?:-\s+)?image:\s*)(["']?)([^"'\s#]+)\2(\s*\r?)$/;
const SEPARATOR = /^---\s*$/;

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

/** @param {Set<string>} [deployments] `NAMESPACE|NAME` keys. Without it, every Deployment. */
function inScope(document, deployments) {
  if (document.kind !== 'Deployment') return false;
  return !deployments || deployments.has(`${document.namespace}|${document.name}`);
}

function isPinnable(ref, prefix) {
  return ref.startsWith(prefix) && !ref.includes('@');
}

/** The tag references to resolve: first-party, not pinned yet, in an in-scope Deployment. */
function findPinnableImages(text, { prefix, deployments }) {
  const found = new Set();
  for (const document of splitDocuments(text)) {
    if (!inScope(document, deployments)) continue;
    for (const line of document.lines) {
      const ref = IMAGE_LINE.exec(line)?.[3];
      if (ref && isPinnable(ref, prefix)) found.add(ref);
    }
  }
  return [...found].sort();
}

/**
 * Rewrite each pinnable reference to `<ref>@<digest>`.
 *
 * @param {string} text multi-document YAML.
 * @param {{prefix: string, deployments?: Set<string>, digests: Record<string, string>}} options
 * @returns {{text: string, pinned: number}}
 */
function pinManifests(text, { prefix, deployments, digests }) {
  let pinned = 0;
  const output = [];
  for (const document of splitDocuments(text)) {
    const scoped = inScope(document, deployments);
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
async function pin(text, { prefix, deployments, resolveDigest = fetchRegistryDigest, delayMs }) {
  const refs = findPinnableImages(text, { prefix, deployments });
  const digests = {};
  for (const ref of refs) {
    digests[ref] = await resolveWithRetry(ref, { resolveDigest, delayMs });
  }
  return { ...pinManifests(text, { prefix, deployments, digests }), digests };
}

/** Read `NAMESPACE|NAME` lines, the format of `restart-deployments.txt`. */
function readDeployments(file) {
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
  const deploymentsFile = argValue(argv, 'deployments');
  if (!file || !prefix) {
    console.error(
      'Usage: pin-image-digests.js --manifests <file> --prefix <prefix> [--deployments <file>]',
    );
    return 1;
  }
  let result;
  try {
    const deployments = deploymentsFile ? readDeployments(deploymentsFile) : undefined;
    result = await pin(fs.readFileSync(file, 'utf-8'), { prefix, deployments });
  } catch (error) {
    console.error(`❌ Cannot pin the image digests: ${error.message}`);
    console.error('   Nothing is written. The deploy stops before it applies a manifest.');
    return 1;
  }
  if (result.pinned === 0) {
    console.log(`ℹ️  No Deployment in scope uses a ${prefix} image by tag. Nothing is pinned.`);
    return 0;
  }
  fs.writeFileSync(file, result.text);
  for (const [ref, digest] of Object.entries(result.digests)) {
    console.log(`   📌 ${ref} -> ${digest}`);
  }
  console.log(`✅ Pinned ${result.pinned} image reference(s) in Deployment documents`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

module.exports = { findPinnableImages, pinManifests, pin, splitDocuments };
