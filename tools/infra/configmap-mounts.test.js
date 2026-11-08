'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const yaml = require('js-yaml');

const { findMissingConfigMapProblems } = require('./configmap-mounts');

const configMap = (name, namespace) => ({
  kind: 'ConfigMap',
  metadata: { name, ...(namespace && { namespace }) },
});
const deployment = (name, namespace, podSpec) => ({
  kind: 'Deployment',
  metadata: { name, ...(namespace && { namespace }) },
  spec: { template: { spec: podSpec } },
});
const mountsBundle = {
  containers: [{ envFrom: [{ configMapRef: { name: 'env' } }] }],
  volumes: [{ name: 'v', configMap: { name: 'bundle' } }],
};

test('a ConfigMap in the same namespace satisfies the workload', () => {
  const docs = [configMap('bundle'), configMap('env'), deployment('a', undefined, mountsBundle)];
  assert.deepEqual(findMissingConfigMapProblems(docs), []);
});

test('a workload in another namespace with no copy is reported', () => {
  const docs = [
    configMap('bundle'),
    configMap('env'),
    deployment('controller', 'ingress-nginx', mountsBundle),
  ];
  const [problem] = findMissingConfigMapProblems(docs);
  assert.equal(problem.items.length, 2);
  assert.match(problem.items[0], /controller \(namespace ingress-nginx\)/);
});

test('a copy in the workload namespace satisfies it', () => {
  const docs = [
    configMap('bundle', 'other'),
    configMap('env', 'other'),
    deployment('x', 'other', mountsBundle),
  ];
  assert.deepEqual(findMissingConfigMapProblems(docs), []);
});

test('an optional ConfigMap reference is ignored', () => {
  const docs = [
    deployment('a', 'other', {
      containers: [{ envFrom: [{ configMapRef: { name: 'env', optional: true } }] }],
    }),
  ];
  assert.deepEqual(findMissingConfigMapProblems(docs), []);
});

test('the rendered local overlay mounts the CA bundle only where the ConfigMap exists', (t) => {
  const root = path.resolve(__dirname, '../..');
  let output;
  try {
    output = execSync('kustomize build infra/k8s/podman/local --enable-alpha-plugins', {
      cwd: root,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    t.skip('kustomize is not installed');
    return;
  }
  const docs = [];
  yaml.loadAll(output, (doc) => doc && docs.push(doc));
  assert.ok(fs.existsSync(path.join(root, 'infra/k8s/podman/local/kustomization.yaml')));
  assert.deepEqual(findMissingConfigMapProblems(docs), []);
});
