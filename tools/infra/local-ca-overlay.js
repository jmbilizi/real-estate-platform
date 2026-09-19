#!/usr/bin/env node

/**
 * Build the local enterprise-CA overlay for the podman/local cluster (#180).
 *
 * A pod has its own filesystem, so the enterprise root `setup-local-cluster.js` installs on every
 * Kind node's OS trust store never reaches a container. This writes a Kustomize strategic-merge
 * patch to `infra/k8s/podman/.generated/ca-bundle/` that overrides the committed, empty
 * `workspace-ca-bundle` ConfigMap (`infra/k8s/podman/local/configmaps/`) with the real bundle, so a
 * workload's `NODE_EXTRA_CA_CERTS` (or runtime equivalent) mount has something to trust.
 *
 * Single extraction path: the bundle comes from `.workspace-certs/workspace-enterprise-roots.pem`,
 * the same file `setup-local-cluster.js` already writes for the Dockerfile `COPY_CERTS` build arg
 * (#160's convention — no second place that reads the host trust store).
 *
 * When the file is absent or empty — a workstation with no TLS-intercepting proxy — the overlay
 * directory is removed and the caller keeps the committed render path, which mounts an empty CA
 * file. `NODE_EXTRA_CA_CERTS` pointing at an empty file adds zero extra trusted roots and does not
 * disable the runtime's built-in CA store, so this is a true no-op there.
 *
 * Real values are written only under `infra/k8s/podman/.generated/`, which
 * `infra/k8s/.gitignore` ignores. The working tree is never modified.
 */

const fs = require('fs');
const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../..');
const CA_BUNDLE_SOURCE = path.join(
  workspaceRoot,
  '.workspace-certs',
  'workspace-enterprise-roots.pem',
);
const GENERATED_CA_DIR = path.join(
  workspaceRoot,
  'infra',
  'k8s',
  'podman',
  '.generated',
  'ca-bundle',
);
const CONFIG_MAP_NAME = 'workspace-ca-bundle';
const BUNDLE_KEY = 'workspace-enterprise-roots.pem';

const BANNER =
  '# AUTO-GENERATED — do not edit. Source: .workspace-certs/workspace-enterprise-roots.pem.';

/** Read the bundle, treating a missing or whitespace-only file as absent. */
function readCaBundle(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    return null;
  }
  const contents = fs.readFileSync(sourcePath, 'utf8');
  return contents.trim().length > 0 ? contents : null;
}

/** Render one strategic-merge patch document overriding the placeholder ConfigMap's data. */
function renderPatch(bundle) {
  // A literal YAML block scalar, not yaml.dump: the bundle is PEM text (its own line structure),
  // and dumping it through a YAML string encoder would escape the newlines into one unreadable line.
  const indented = bundle
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : ''))
    .join('\n');
  return [
    BANNER,
    'apiVersion: v1',
    'kind: ConfigMap',
    `metadata:`,
    `  name: ${CONFIG_MAP_NAME}`,
    'data:',
    `  ${BUNDLE_KEY}: |`,
    indented,
    '',
  ].join('\n');
}

/** Remove the generated overlay directory, if it exists. */
function clearOverlay(dir = GENERATED_CA_DIR) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Write the overlay for the current workstation.
 *
 * @param {{ sourcePath?: string, dir?: string, baseOverlay?: string }} [options]
 * @returns {{ dir: string|null }}
 */
function ensureLocalCaBundleOverlay(options = {}) {
  const sourcePath = options.sourcePath || CA_BUNDLE_SOURCE;
  const dir = options.dir || GENERATED_CA_DIR;
  const baseOverlay = options.baseOverlay || '../../local';

  const bundle = readCaBundle(sourcePath);

  if (!bundle) {
    clearOverlay(dir);
    return { dir: null };
  }

  clearOverlay(dir);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(path.join(dir, `${CONFIG_MAP_NAME}.configmap.yaml`), renderPatch(bundle));

  const kustomization = [
    BANNER,
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    '',
    'resources:',
    `  - ${baseOverlay}`,
    '',
    'patches:',
    `  - path: ${CONFIG_MAP_NAME}.configmap.yaml`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'kustomization.yaml'), kustomization);

  return { dir };
}

/** Human-readable summary. Names nothing but presence — the bundle content is never logged. */
function describeCaBundleOverlay(result) {
  return result.dir
    ? 'Enterprise CA bundle found — injecting it into local pods via workspace-ca-bundle.'
    : 'No enterprise CA bundle found — local pods trust only public CAs (no-op on an unaffected workstation).';
}

// `clean` removes the generated overlay without waiting for the next run.
if (require.main === module) {
  if (process.argv[2] === 'clean') {
    clearOverlay();
    console.log('✓ removed infra/k8s/podman/.generated/ca-bundle');
  } else {
    console.error('Usage: node tools/infra/local-ca-overlay.js clean');
    process.exit(1);
  }
}

module.exports = {
  ensureLocalCaBundleOverlay,
  clearOverlay,
  readCaBundle,
  renderPatch,
  describeCaBundleOverlay,
  GENERATED_CA_DIR,
  CA_BUNDLE_SOURCE,
  CONFIG_MAP_NAME,
  BUNDLE_KEY,
};
