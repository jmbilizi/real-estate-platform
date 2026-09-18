#!/usr/bin/env node

/**
 * Render `.env.example` from the secret-key derivation.
 *
 * `.env.example` is a rendered view of `tools/infra/secret-keys.js`, never a registry. No tool
 * learns key names by reading it. It carries key names and comments only, so it never carries a
 * realistic sample value.
 *
 * Drift is reported by `pnpm run infra:validate`, which compares this render against the committed
 * file. This script only writes.
 *
 * Usage: pnpm run infra:secrets:example
 */

const fs = require('fs');
const path = require('path');
const { deriveSecretKeys, groupByFile } = require('./secret-keys');

const workspaceRoot = path.resolve(__dirname, '../..');
const ENV_EXAMPLE_PATH = path.join(workspaceRoot, '.env.example');

const HEADER = [
  '# ─────────────────────────────────────────────────────────────────────────────',
  '# Local cluster secret overrides — GENERATED FILE, do not edit by hand.',
  '#',
  '# Source of truth: infra/k8s/base/secrets/*.secret.yaml, read by',
  '# tools/infra/secret-keys.js. Regenerate with:',
  '#   pnpm run infra:secrets:example',
  '# `pnpm run infra:validate` fails when this file and the manifests disagree.',
  '#',
  '# HOW TO USE',
  '# Copy this file to `.env` and set only the keys you need. `.gitignore` ignores',
  '# `.env`, so a real value never reaches Git.',
  '#',
  '# OVERRIDE OR FALLBACK',
  '# `pnpm run skaffold ...` injects each key you set into the local cluster Secret.',
  '# A key you omit, comment out, or leave empty keeps the value committed in the',
  '# manifest. A variable already set in your shell wins over this file.',
  '#',
  '# Real values are written only under infra/k8s/podman/.generated/, which',
  '# infra/k8s/.gitignore ignores. The working tree is never modified.',
  '#',
  '# SCOPE',
  '# Local podman/local deploys only. Hetzner environments take their values from',
  '# GitHub Environment Secrets. Ingress domains and KUBECONFIG are not secret',
  '# manifest keys, so they are not listed here.',
  '# ─────────────────────────────────────────────────────────────────────────────',
];

/** Build the full `.env.example` contents from the derivation. */
function renderEnvExample(records) {
  const lines = [...HEADER];

  for (const [file, group] of groupByFile(records)) {
    const secretNames = [...new Set(group.map((record) => record.secretName))];
    lines.push('');
    lines.push(`# ${file} → Secret ${secretNames.join(', ')}`);
    for (const record of group) {
      // Name the manifest key whenever the variable name differs from it, so the mapping is
      // readable without opening the manifest.
      if (record.envVar !== record.key) {
        lines.push(`# stringData key: ${record.key}`);
      }
      lines.push(`${record.envVar}=`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function main() {
  const records = deriveSecretKeys();
  fs.writeFileSync(ENV_EXAMPLE_PATH, renderEnvExample(records));
  console.log(`✓ wrote .env.example (${records.length} keys)`);
}

if (require.main === module) {
  main();
}

module.exports = { renderEnvExample, ENV_EXAMPLE_PATH };
