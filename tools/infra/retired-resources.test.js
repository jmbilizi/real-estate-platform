const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RETIRED_RESOURCES,
  deleteCommands,
  removeRetiredResources,
} = require('./retired-resources');

test('groups the retired Bright CronJobs into one delete that tolerates absence', () => {
  assert.deepEqual(deleteCommands(), [
    [
      'delete',
      'cronjob',
      'bright-mls-ingest',
      'bright-area-refresh',
      'bright-area-reconcile',
      '-n',
      'default',
      '--ignore-not-found',
    ],
  ]);
});

test('every entry names its kind, namespace and reason', () => {
  for (const resource of RETIRED_RESOURCES) {
    assert.ok(resource.kind && resource.name && resource.namespace && resource.reason);
  }
});

test('a failed delete is reported and does not throw', () => {
  const logs = [];
  const ok = removeRetiredResources({
    run: () => ({ status: 1, stdout: '', stderr: 'forbidden' }),
    log: (message) => logs.push(message),
  });
  assert.equal(ok, false);
  assert.match(logs[0], /forbidden/);
});

test('passes the deploy context through to kubectl', () => {
  const calls = [];
  removeRetiredResources({
    context: 'kind-myapp-podman-local',
    run: (args) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    },
    log: () => undefined,
  });
  assert.deepEqual(calls[0].slice(0, 2), ['--context', 'kind-myapp-podman-local']);
});
