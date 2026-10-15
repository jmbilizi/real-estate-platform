'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { planCerts, hasBundle, ensureWorkspaceCerts, bundlePath } = require('./workspace-certs');

const PEM = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n';

test('planCerts skips in CI', () => {
  assert.equal(
    planCerts({ isCi: true, localHasBundle: false, mainBundleFile: null }).action,
    'skip',
  );
});

test('planCerts accepts a local bundle', () => {
  assert.equal(planCerts({ isCi: false, localHasBundle: true, mainBundleFile: null }).action, 'ok');
});

test('planCerts copies from the main checkout when only it has the bundle', () => {
  assert.deepEqual(planCerts({ isCi: false, localHasBundle: false, mainBundleFile: '/m/x.pem' }), {
    action: 'copy',
    from: '/m/x.pem',
  });
});

test('planCerts warns when no bundle exists anywhere', () => {
  assert.equal(
    planCerts({ isCi: false, localHasBundle: false, mainBundleFile: null }).action,
    'warn',
  );
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'certs-test-'));
}

test('hasBundle rejects a missing file and a file with no certificate', () => {
  const root = tempRoot();
  const file = path.join(root, 'x.pem');
  assert.equal(hasBundle(file), false);
  fs.writeFileSync(file, '');
  assert.equal(hasBundle(file), false);
  fs.writeFileSync(file, PEM);
  assert.equal(hasBundle(file), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ensureWorkspaceCerts warns and continues when no bundle exists anywhere', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.workspace-certs'));
  const warnings = [];
  const action = ensureWorkspaceCerts(root, {
    env: {},
    mainRoot: null,
    warn: (m) => warnings.push(m),
  });
  assert.equal(action, 'warn');
  assert.match(warnings[0], /infra:local:cluster:setup/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ensureWorkspaceCerts copies the bundle from the main checkout (#107)', () => {
  const root = tempRoot();
  const main = tempRoot();
  fs.mkdirSync(path.join(main, '.workspace-certs'));
  fs.writeFileSync(bundlePath(main), PEM);
  const action = ensureWorkspaceCerts(root, { env: {}, mainRoot: main, log: () => {} });
  assert.equal(action, 'copy');
  assert.equal(fs.readFileSync(bundlePath(root), 'utf-8'), PEM);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(main, { recursive: true, force: true });
});

test('ensureWorkspaceCerts names the copy command when the copy fails', () => {
  const root = tempRoot();
  const main = tempRoot();
  fs.mkdirSync(path.join(main, '.workspace-certs'));
  fs.writeFileSync(bundlePath(main), PEM);
  // A file where the directory must go makes the copy fail.
  fs.writeFileSync(path.join(root, '.workspace-certs'), 'x');
  assert.throws(
    () => ensureWorkspaceCerts(root, { env: {}, mainRoot: main }),
    /infra:local:certs:ensure/,
  );
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(main, { recursive: true, force: true });
});

test('ensureWorkspaceCerts passes for an existing bundle and skips in CI', () => {
  const root = tempRoot();
  assert.equal(ensureWorkspaceCerts(root, { env: { CI: 'true' } }), 'skip');
  fs.mkdirSync(path.join(root, '.workspace-certs'));
  fs.writeFileSync(bundlePath(root), PEM);
  assert.equal(ensureWorkspaceCerts(root, { env: {} }), 'ok');
  fs.rmSync(root, { recursive: true, force: true });
});
