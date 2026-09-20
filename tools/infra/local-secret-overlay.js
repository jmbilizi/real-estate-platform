#!/usr/bin/env node

/**
 * Build the local secret-injection overlay for the podman/local cluster.
 *
 * For every injectable key that the environment supplies, this writes a Kustomize
 * strategic-merge patch to `infra/k8s/podman/.generated/secrets/`. Kustomize merges `stringData`
 * key by key, so a key the developer omits keeps the value committed in the manifest. That gives
 * the override-or-fallback rule with no conditional code, and it cannot blank a key.
 *
 * That fallback is correct only on an empty cluster. A `kubectl apply` replaces a Secret's whole
 * `stringData` with the rendered manifest, so a key omitted from `.env` renders as the committed
 * placeholder and overwrites whatever the cluster already held (#218). An agent worktree has no
 * `.env`, so every key is omitted, and a worktree deploy against the shared local cluster silently
 * downgraded a real credential to `StrongBase64Password`.
 *
 * The fix: before falling back to the placeholder for an omitted key, read the cluster's current
 * value for that key. A real value found there is preserved by injecting it as if it had been
 * supplied — never demoted to the placeholder. A cluster read that cannot answer (no context, no
 * cluster, RBAC) refuses the whole overlay instead of guessing, because guessing is exactly the
 * silent-downgrade failure mode this exists to close. Set `LOCAL_SECRET_RESET_TO_PLACEHOLDER=1` to
 * skip preservation on purpose, e.g. to test a first-deploy scenario against a real cluster.
 *
 * Real values are written only under `infra/k8s/podman/.generated/`, which
 * `infra/k8s/.gitignore` ignores. The working tree is never modified.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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

/** Raised when the live cluster's secret state cannot be determined. Never carries a value. */
class ClusterSecretReadError extends Error {}

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
 * Read a Secret already applied to the cluster in the current kube context.
 *
 * Returns `null` when the Secret does not exist — the correct signal for a first deploy, where the
 * committed placeholder is the right fallback. Throws `ClusterSecretReadError` when kubectl cannot
 * answer the question at all (no cluster, wrong context, RBAC): that case must never be read as "no
 * existing value", because the guess could be wrong in the one direction that destroys data.
 *
 * @param {string} secretName
 * @returns {Record<string, string>|null}
 */
function readClusterSecret(secretName) {
  const result = spawnSync('kubectl', ['get', 'secret', secretName, '-o', 'json'], {
    encoding: 'utf-8',
  });

  if (result.error) {
    throw new ClusterSecretReadError(
      `kubectl is unavailable to check the existing '${secretName}' Secret: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    if (/\bNotFound\b/i.test(stderr)) {
      return null;
    }
    throw new ClusterSecretReadError(
      `kubectl could not read the existing '${secretName}' Secret: ${stderr || `exit ${result.status}`}`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new ClusterSecretReadError(
      `kubectl returned unparseable JSON for the '${secretName}' Secret: ${error.message}`,
    );
  }

  const data = (parsed && parsed.data) || {};
  const decoded = {};
  for (const [key, base64Value] of Object.entries(data)) {
    decoded[key] = Buffer.from(String(base64Value), 'base64').toString('utf-8');
  }
  return decoded;
}

/** Group records by Secret name, preserving derivation order. */
function groupBySecretName(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.secretName)) {
      groups.set(record.secretName, []);
    }
    groups.get(record.secretName).push(record);
  }
  return groups;
}

/**
 * Write the overlay for the current environment.
 *
 * @param {{
 *   env?: object,
 *   dir?: string,
 *   records?: Array,
 *   baseOverlay?: string,
 *   readClusterSecret?: (secretName: string) => (Record<string, string>|null),
 *   preserveFromCluster?: boolean,
 * }} [options]
 * @returns {{ dir: string|null, overriddenKeys: string[], preservedKeys: string[], totalKeys: number }}
 */
function ensureLocalSecretOverlay(options = {}) {
  const env = options.env || process.env;
  const dir = options.dir || GENERATED_SECRETS_DIR;
  const records = options.records || deriveSecretKeys();
  // The layer this overlay chains onto. Defaults to the committed local overlay; a caller with its
  // own generated layer underneath (e.g. the CA-bundle overlay) passes that layer's relative path
  // instead, so the two generated overlays compose without either one knowing about the other.
  const baseOverlay = options.baseOverlay || '../../local';
  // Explicit opt-out of preservation, e.g. to render against no live cluster, or to deliberately
  // reset an omitted key back to the committed placeholder.
  const preserveFromCluster =
    options.preserveFromCluster !== false && env.LOCAL_SECRET_RESET_TO_PLACEHOLDER !== '1';
  const readCluster = options.readClusterSecret || readClusterSecret;

  const envOverrides = selectOverrides(records, env);
  const envOverrideVars = new Set(envOverrides.map((record) => record.envVar));

  // A key `.env` does not supply is not automatically safe to render as the committed placeholder:
  // the cluster may already hold a real value that a bare `kubectl apply` would silently overwrite
  // (#218). Preserve it by treating the cluster's current value as if it had been supplied.
  const preservedKeys = [];
  const mergedEnv = { ...env };
  if (preserveFromCluster) {
    const omitted = records.filter((record) => !envOverrideVars.has(record.envVar));
    for (const [secretName, group] of groupBySecretName(omitted)) {
      const current = readCluster(secretName); // Throws when undeterminable — never guesses.
      if (!current) continue; // Secret absent: first deploy, the placeholder is correct.
      for (const record of group) {
        const value = current[record.key];
        if (typeof value === 'string' && value.length > 0) {
          mergedEnv[record.envVar] = value;
          preservedKeys.push(record.envVar);
        }
      }
    }
  }

  const overrides = selectOverrides(records, mergedEnv);

  if (overrides.length === 0) {
    // Remove a directory left by an earlier run, so a removed `.env` key stops being injected.
    clearOverlay(dir);
    return { dir: null, overriddenKeys: [], preservedKeys: [], totalKeys: records.length };
  }

  // Group by Secret name, not by file: one manifest may hold several Secret documents.
  const bySecret = groupBySecretName(overrides);

  clearOverlay(dir);
  fs.mkdirSync(dir, { recursive: true });

  const patchPaths = [];
  for (const [secretName, group] of [...bySecret.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const fileName = `${secretName}.secret.yaml`;
    fs.writeFileSync(path.join(dir, fileName), renderPatch(secretName, group, mergedEnv));
    patchPaths.push(fileName);
  }

  const kustomization = [
    BANNER,
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    '',
    'resources:',
    `  - ${baseOverlay}`,
    '',
    'patches:',
    ...patchPaths.map((p) => `  - path: ${p}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'kustomization.yaml'), kustomization);

  return {
    dir,
    overriddenKeys: overrides.map((record) => record.envVar).sort(),
    preservedKeys: preservedKeys.sort(),
    totalKeys: records.length,
  };
}

/** Human-readable summary. Names keys and a count, never a value. */
function describeOverrides(result) {
  const parts = [];
  const fromEnv = result.overriddenKeys.filter((envVar) => !result.preservedKeys.includes(envVar));
  if (fromEnv.length > 0) {
    parts.push(
      `Overriding ${fromEnv.length} of ${result.totalKeys} keys from .env: ${fromEnv.join(', ')}`,
    );
  }
  if (result.preservedKeys.length > 0) {
    parts.push(
      `Preserving ${result.preservedKeys.length} existing cluster value(s) not in .env: ` +
        `${result.preservedKeys.join(', ')}`,
    );
  }
  if (parts.length === 0) {
    return `No local secret overrides found in .env — using the committed values for all ${result.totalKeys} keys.`;
  }
  return parts.join(' ');
}

// `clean` removes the generated plaintext patches without waiting for the next run.
if (require.main === module) {
  if (process.argv[2] === 'clean') {
    clearOverlay();
    console.log('✓ removed infra/k8s/podman/.generated/secrets');
  } else {
    console.error('Usage: node tools/infra/local-secret-overlay.js clean');
    process.exit(1);
  }
}

module.exports = {
  ensureLocalSecretOverlay,
  clearOverlay,
  selectOverrides,
  renderPatch,
  describeOverrides,
  readClusterSecret,
  ClusterSecretReadError,
  GENERATED_SECRETS_DIR,
};
