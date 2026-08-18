'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { findDeployControlProblems } = require('./validate-kustomize');

const FIXTURE = path.join(__dirname, 'fixtures/hetzner-dev.manifests.yaml');
const devManifest = () => fs.readFileSync(FIXTURE, 'utf-8');

/**
 * The validator's job is drift detection between the rendered manifests and the KEYS in
 * infra/deploy-control.yaml. It must be blind to `enabled` / `auto_deploy`, because those
 * express intent, not drift — the whole point of #45.
 */

test('every hetzner environment is fully accounted for by deploy-control.yaml', () => {
  // All three overlays reference ../../base with no removals, so they render the same
  // workloads. Each environment must therefore register the same nine identities —
  // regardless of which of them that environment currently has switched on.
  for (const environment of ['dev', 'test', 'prod']) {
    assert.deepEqual(
      findDeployControlProblems(devManifest(), environment),
      [],
      `hetzner/${environment} has deploy-control drift`,
    );
  }
});

test('a gated-off service is never reported as drift', () => {
  // test and prod deliberately hold most services at enabled: false. If gating leaked into
  // this check, those environments would be un-deployable by construction.
  const control = require('js-yaml').load(
    fs.readFileSync(path.resolve(__dirname, '../..', 'infra/deploy-control.yaml'), 'utf-8'),
  );
  const disabled = Object.entries(control.environments.test.services).filter(
    ([, config]) => config.enabled !== true,
  );

  assert.ok(disabled.length > 0, 'expected the test environment to gate some services off');
  assert.deepEqual(findDeployControlProblems(devManifest(), 'test'), []);
});

test('a workload with no deploy-control entry fails validation', () => {
  const withStray = `${devManifest()}\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: messaging-service\n  labels:\n    app: messaging-service\n`;

  const problems = findDeployControlProblems(withStray, 'dev');
  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /Unmanaged workloads/);
  assert.deepEqual(problems[0].items, [
    'Deployment default messaging-service (labels: app=messaging-service)',
  ]);
});

test('an unknown environment is rejected rather than silently passing', () => {
  const problems = findDeployControlProblems(devManifest(), 'staging');
  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /no environments\.staging\.services entries/);
});
