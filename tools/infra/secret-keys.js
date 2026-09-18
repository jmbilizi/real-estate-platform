#!/usr/bin/env node

/**
 * Source of truth for the injectable secret keys.
 *
 * Every `stringData` key in `infra/k8s/base/secrets/*.secret.yaml` is injectable. This module
 * derives the list from those manifests, so no tool in the repo carries a hand-maintained key
 * list. `.env.example`, the local injection in `run-skaffold.js`, and the CI drift gate all read
 * this one derivation.
 *
 * The derivation deliberately does NOT match the `StrongBase64Password` sentinel. That keeps the
 * jaeger `auth` key — whose committed value is a local htpasswd default, not the sentinel — in the
 * set, and it survives a future rename of the placeholder text.
 *
 * Domain substitution (`*_DOMAIN_PLACEHOLDER`) and `KUBECONFIG` are out of scope by construction:
 * neither appears in a secret manifest, so a derivation over `stringData` cannot return them.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const workspaceRoot = path.resolve(__dirname, '../..');
const SECRETS_DIR = path.join(workspaceRoot, 'infra', 'k8s', 'base', 'secrets');

/** The committed sentinel value. Used by the guards, never by the derivation. */
const PLACEHOLDER = 'StrongBase64Password';

/**
 * Derive the environment variable name for one key.
 *
 * A key that is already SCREAMING_SNAKE is used as-is, which covers 11 of the 12 keys today and
 * keeps `.env` names identical to the GitHub Secret names. Any other key is qualified with the
 * secret's own identity, because a bare lowercase key is too generic to put in `process.env`: the
 * jaeger key is literally `auth`, and `process.loadEnvFile()` merges into `process.env` where a
 * pre-existing shell variable wins. An unqualified `auth` would let an unrelated shell export
 * inject a wrong value into a cluster Secret with no visible cause.
 *
 * The qualifier is derived from `metadata.name`, so this rule adds no hand-maintained mapping.
 */
function envVarForKey(secretName, key) {
  if (/^[A-Z][A-Z0-9_]*$/.test(key)) {
    return key;
  }
  const prefix = String(secretName)
    .replace(/-secret$/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
  const suffix = String(key)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
  return prefix ? `${prefix}_${suffix}` : suffix;
}

/**
 * Read every secret manifest and return one record per `stringData` key.
 *
 * Records are sorted by file then key, so every consumer renders and compares in a stable order.
 *
 * @param {{ secretsDir?: string }} [options]
 * @returns {Array<{ file: string, secretName: string, key: string, envVar: string, value: string }>}
 */
function deriveSecretKeys(options = {}) {
  const secretsDir = options.secretsDir || SECRETS_DIR;
  if (!fs.existsSync(secretsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(secretsDir)
    .filter((name) => name.endsWith('.secret.yaml'))
    .sort();

  const records = [];

  for (const file of files) {
    const contents = fs.readFileSync(path.join(secretsDir, file), 'utf-8');

    // A manifest may hold several documents. `loadAll` also yields null for an empty document,
    // which a leading `---` produces.
    const documents = yaml.loadAll(contents).filter((doc) => doc && typeof doc === 'object');

    for (const doc of documents) {
      const secretName = doc.metadata?.name;
      const stringData = doc.stringData;
      if (!secretName || !stringData || typeof stringData !== 'object') {
        // A manifest with no `stringData` block contributes no keys.
        continue;
      }

      for (const key of Object.keys(stringData).sort()) {
        records.push({
          file,
          secretName,
          key,
          envVar: envVarForKey(secretName, key),
          value: String(stringData[key]),
        });
      }
    }
  }

  return records;
}

/** Group records by manifest file, preserving the derivation order. */
function groupByFile(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.file)) {
      groups.set(record.file, []);
    }
    groups.get(record.file).push(record);
  }
  return groups;
}

module.exports = { deriveSecretKeys, envVarForKey, groupByFile, PLACEHOLDER, SECRETS_DIR };
