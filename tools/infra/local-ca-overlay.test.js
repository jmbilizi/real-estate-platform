'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ensureLocalCaBundleOverlay,
  readCaBundle,
  renderPatch,
  describeCaBundleOverlay,
} = require('./local-ca-overlay');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('a missing source file reads as absent', () => {
  const dir = tempDir('ca-source-');
  try {
    assert.equal(readCaBundle(path.join(dir, 'nope.pem')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a whitespace-only source file reads as absent', () => {
  const dir = tempDir('ca-source-');
  const file = path.join(dir, 'blank.pem');
  fs.writeFileSync(file, '\n  \n');
  try {
    assert.equal(readCaBundle(file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no source bundle generates no overlay at all', () => {
  const parent = tempDir('ca-overlay-');
  const dir = path.join(parent, 'ca-bundle');
  try {
    const result = ensureLocalCaBundleOverlay({
      sourcePath: path.join(parent, 'workspace-enterprise-roots.pem'),
      dir,
    });
    assert.equal(result.dir, null);
    assert.equal(fs.existsSync(dir), false);
    assert.match(describeCaBundleOverlay(result), /No enterprise CA bundle found/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a present bundle writes one patch and chains to the committed overlay', () => {
  const parent = tempDir('ca-overlay-');
  const dir = path.join(parent, 'ca-bundle');
  const sourcePath = path.join(parent, 'workspace-enterprise-roots.pem');
  const pem = '-----BEGIN CERTIFICATE-----\nMIIB...fake...\n-----END CERTIFICATE-----\n';
  fs.writeFileSync(sourcePath, pem);
  try {
    const result = ensureLocalCaBundleOverlay({ sourcePath, dir });
    assert.equal(result.dir, dir);
    assert.deepEqual(fs.readdirSync(dir).sort(), [
      'kustomization.yaml',
      'workspace-ca-bundle.configmap.yaml',
    ]);

    const patch = fs.readFileSync(path.join(dir, 'workspace-ca-bundle.configmap.yaml'), 'utf-8');
    assert.match(patch, /name: workspace-ca-bundle/);
    assert.match(patch, /BEGIN CERTIFICATE/);

    const kustomization = fs.readFileSync(path.join(dir, 'kustomization.yaml'), 'utf-8');
    assert.match(kustomization, /resources:\n {2}- \.\.\/\.\.\/local/);
    assert.match(kustomization, /- path: workspace-ca-bundle\.configmap\.yaml/);
    assert.match(describeCaBundleOverlay(result), /Enterprise CA bundle found/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a custom baseOverlay chains to a different layer', () => {
  const parent = tempDir('ca-overlay-');
  const dir = path.join(parent, 'ca-bundle');
  const sourcePath = path.join(parent, 'workspace-enterprise-roots.pem');
  fs.writeFileSync(sourcePath, '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n');
  try {
    ensureLocalCaBundleOverlay({ sourcePath, dir, baseOverlay: '../secrets' });
    const kustomization = fs.readFileSync(path.join(dir, 'kustomization.yaml'), 'utf-8');
    assert.match(kustomization, /resources:\n {2}- \.\.\/secrets/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('renderPatch never emits a yaml.dump-mangled bundle', () => {
  const patch = renderPatch('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
  assert.match(patch, /data:\n {2}workspace-enterprise-roots\.pem: \|\n {4}-----BEGIN CERTIFICATE/);
});

test('a later run with no source bundle removes the stale overlay', () => {
  const parent = tempDir('ca-overlay-');
  const dir = path.join(parent, 'ca-bundle');
  const sourcePath = path.join(parent, 'workspace-enterprise-roots.pem');
  try {
    fs.writeFileSync(sourcePath, '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n');
    ensureLocalCaBundleOverlay({ sourcePath, dir });
    assert.equal(fs.existsSync(dir), true);

    fs.rmSync(sourcePath);
    ensureLocalCaBundleOverlay({ sourcePath, dir });
    assert.equal(fs.existsSync(dir), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
