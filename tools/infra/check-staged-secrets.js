#!/usr/bin/env node

/**
 * Pre-commit guard for the committed secret manifests.
 *
 * Local secret injection writes real values only under `infra/k8s/podman/.generated/`. This guard
 * closes the older path that is still open: a hand-edit of a committed manifest, or a working-tree
 * file left over from an aborted experiment.
 *
 * The rule is "do not change a committed value", not "every value must be the sentinel". The
 * jaeger `auth` key holds a committed local htpasswd default that is deliberately not the
 * sentinel, so a sentinel-only rule would fail every commit that touches that file. Comparing the
 * staged value against the value in HEAD catches the real threat — a credential appearing where a
 * placeholder was — and leaves the intentional defaults alone.
 *
 * Set ALLOW_SECRET_VALUE_CHANGE=1 to commit a deliberate change to a committed default. That is a
 * documented, auditable flag, not a hook bypass.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { PLACEHOLDER } = require('./secret-keys');

const workspaceRoot = path.resolve(__dirname, '../..');
const SECRETS_PREFIX = 'infra/k8s/base/secrets/';
const OVERRIDE_ENV = 'ALLOW_SECRET_VALUE_CHANGE';

function git(gitArgs, options = {}) {
  return execFileSync('git', gitArgs, {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

/** Staged secret manifests, ignoring a deletion. */
function stagedSecretManifests() {
  const output = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((file) => file.startsWith(SECRETS_PREFIX) && file.endsWith('.secret.yaml'));
}

/** Read a blob, returning null when the path does not exist at that revision. */
function readBlob(revision, file) {
  try {
    return git(['show', `${revision}:${file}`]);
  } catch {
    return null;
  }
}

/** Flatten a manifest's documents to a `secretName.key -> value` map. */
function stringDataEntries(text) {
  const entries = new Map();
  if (typeof text !== 'string') {
    return entries;
  }
  let documents;
  try {
    documents = yaml.loadAll(text);
  } catch {
    // A manifest that does not parse fails `pnpm run infra:validate` with a better message.
    return entries;
  }
  for (const doc of documents) {
    if (!doc || typeof doc !== 'object' || !doc.stringData || typeof doc.stringData !== 'object') {
      continue;
    }
    const secretName = doc.metadata?.name || '';
    for (const [key, value] of Object.entries(doc.stringData)) {
      entries.set(`${secretName}.${key}`, String(value));
    }
  }
  return entries;
}

/**
 * Compare one manifest's staged content against its committed content.
 *
 * @returns {Array<{ file: string, field: string, reason: string }>}
 */
function findChangedValues(file, stagedText, headText) {
  const staged = stringDataEntries(stagedText);
  const head = stringDataEntries(headText);
  const findings = [];

  for (const [field, value] of staged) {
    if (value === PLACEHOLDER) {
      continue;
    }
    if (!head.has(field)) {
      findings.push({ file, field, reason: 'a new key must be committed with the placeholder' });
      continue;
    }
    if (head.get(field) !== value) {
      findings.push({ file, field, reason: 'the committed value was changed' });
    }
  }

  return findings;
}

/** Run the guard and return the process exit code. */
function main() {
  let files;
  try {
    files = stagedSecretManifests();
  } catch {
    // No git index available (a fresh clone, or a non-repository checkout). Nothing to guard.
    return 0;
  }

  if (files.length === 0) {
    return 0;
  }

  const findings = [];
  for (const file of files) {
    findings.push(...findChangedValues(file, readBlob('', file), readBlob('HEAD', file)));
  }

  if (findings.length === 0) {
    console.log(`✓ ${files.length} staged secret manifest(s) carry no changed value`);
    return 0;
  }

  if (process.env[OVERRIDE_ENV] === '1') {
    console.warn(`⚠ ${OVERRIDE_ENV}=1 — allowing ${findings.length} changed secret value(s)`);
    for (const finding of findings) {
      console.warn(`    ${finding.file}: ${finding.field}`);
    }
    return 0;
  }

  console.error('✗ a staged secret manifest carries a changed stringData value');
  for (const finding of findings) {
    console.error(`    ${finding.file}: ${finding.field} — ${finding.reason}`);
  }
  console.error('');
  console.error('  Committed manifests hold placeholders only. To give the local cluster a real');
  console.error('  value, put it in `.env` instead — see .env.example. Restore the manifest with:');
  console.error('    git checkout HEAD -- <file>');
  console.error(`  To change a committed default on purpose, re-run with ${OVERRIDE_ENV}=1.`);
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  findChangedValues,
  stringDataEntries,
  stagedSecretManifests,
  SECRETS_PREFIX,
};
