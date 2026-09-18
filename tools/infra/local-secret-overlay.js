#!/usr/bin/env node

/**
 * Build the local secret-injection overlay for the podman/local cluster.
 *
 * For every injectable key that the environment supplies, this writes a Kustomize
 * strategic-merge patch to `infra/k8s/podman/.generated/secrets/`. Kustomize merges `stringData`
 * key by key, so a key the developer omits keeps the value committed in the manifest. That gives
 * the override-or-fallback rule with no conditional code, and it cannot blank a key.
 *
 * When the environment supplies no key, the overlay directory is removed and the caller keeps the
 * committed render path. The render then stays byte-identical to a checkout with no `.env`.
 *
 * Real values are written only under `infra/k8s/podman/.generated/`, which
 * `infra/k8s/.gitignore` ignores. The working tree is never modified.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { deriveSecretKeys } = require('./secret-keys');

const workspaceRoot = path.resolve(__dirname, '../..');
const GENERATED_SECRETS_DIR = path.join(
  workspaceRoot,
  'infra',
  'k8s',
  'podman',
  '.generated',
  'secrets',
);

const BANNER = '# AUTO-GENERATED — do not edit. Source: infra/k8s/base/secrets/ plus your .env.';

/**
 * Select the records the environment overrides.
 *
 * An unset or empty variable is not an override. Empty is treated as absent on purpose: it is what
 * a developer leaves behind after copying `.env.example`, and it must not blank a cluster Secret.
 */
function selectOverrides(records, env) {
  return records.filter((record) => {
    const value = env[record.envVar];
    return typeof value === 'string' && value.length > 0;
  });
}

/** Render one strategic-merge patch document for a single Secret. */
function renderPatch(secretName, overrides, env) {
  const stringData = {};
  for (const record of overrides) {
    stringData[record.key] = env[record.envVar];
  }
  const body = yaml.dump(
    { apiVersion: 'v1', kind: 'Secret', metadata: { name: secretName }, stringData },
    { lineWidth: -1, noRefs: true },
  );
  return `${BANNER}\n${body}`;
}

/** Remove the generated overlay directory, if it exists. */
function clearOverlay(dir = GENERATED_SECRETS_DIR) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Write the overlay for the current environment.
 *
 * @param {{ env?: object, dir?: string, records?: Array }} [options]
 * @returns {{ dir: string|null, overriddenKeys: string[], totalKeys: number }}
 */
function ensureLocalSecretOverlay(options = {}) {
  const env = options.env || process.env;
  const dir = options.dir || GENERATED_SECRETS_DIR;
  const records = options.records || deriveSecretKeys();

  const overrides = selectOverrides(records, env);

  if (overrides.length === 0) {
    // Remove a directory left by an earlier run, so a removed `.env` key stops being injected.
    clearOverlay(dir);
    return { dir: null, overriddenKeys: [], totalKeys: records.length };
  }

  // Group by Secret name, not by file: one manifest may hold several Secret documents.
  const bySecret = new Map();
  for (const record of overrides) {
    if (!bySecret.has(record.secretName)) {
      bySecret.set(record.secretName, []);
    }
    bySecret.get(record.secretName).push(record);
  }

  clearOverlay(dir);
  fs.mkdirSync(dir, { recursive: true });

  const patchPaths = [];
  for (const [secretName, group] of [...bySecret.entries()].sort()) {
    const fileName = `${secretName}.secret.yaml`;
    fs.writeFileSync(path.join(dir, fileName), renderPatch(secretName, group, env));
    patchPaths.push(fileName);
  }

  const kustomization = [
    BANNER,
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    '',
    'resources:',
    '  - ../../local',
    '',
    'patches:',
    ...patchPaths.map((p) => `  - path: ${p}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'kustomization.yaml'), kustomization);

  return {
    dir,
    overriddenKeys: overrides.map((record) => record.envVar).sort(),
    totalKeys: records.length,
  };
}

/** Human-readable summary. Names keys and a count, never a value. */
function describeOverrides(result) {
  if (result.overriddenKeys.length === 0) {
    return `No local secret overrides found in .env — using the committed values for all ${result.totalKeys} keys.`;
  }
  return `Overriding ${result.overriddenKeys.length} of ${result.totalKeys} keys: ${result.overriddenKeys.join(', ')}`;
}

module.exports = {
  ensureLocalSecretOverlay,
  clearOverlay,
  selectOverrides,
  renderPatch,
  describeOverrides,
  GENERATED_SECRETS_DIR,
};
