#!/usr/bin/env node

/**
 * Deletes workloads that the manifests no longer describe.
 *
 * Neither deploy path prunes: CI applies each service with a label selector, and a local Skaffold
 * deploy applies only what it renders. A workload removed from `infra/k8s/` therefore stays in
 * every cluster that ever ran it. List it here in the same change that removes it. Remove the
 * entry once no cluster can hold it.
 *
 * Used by `run-skaffold.js` before a local deploy and by the CI deploy action
 * (`node tools/infra/retired-resources.js`). Absent resources are not an error.
 */

const { spawnSync } = require('child_process');

/** @type {ReadonlyArray<{ kind: string, name: string, namespace: string, reason: string }>} */
const RETIRED_RESOURCES = Object.freeze([
  {
    kind: 'cronjob',
    name: 'bright-mls-ingest',
    namespace: 'default',
    reason: '#338: replaced by the bright-sync-worker Deployment',
  },
  {
    kind: 'cronjob',
    name: 'bright-area-refresh',
    namespace: 'default',
    reason: '#338: replaced by the bright-sync-worker Deployment',
  },
  {
    kind: 'cronjob',
    name: 'bright-area-reconcile',
    namespace: 'default',
    reason: '#338: replaced by the bright-sync-worker Deployment',
  },
]);

/** The `kubectl delete` argument lists, one per namespace and kind. */
function deleteCommands(resources = RETIRED_RESOURCES) {
  const groups = new Map();
  for (const resource of resources) {
    const key = `${resource.namespace}\u0000${resource.kind}`;
    const group = groups.get(key) ?? {
      namespace: resource.namespace,
      kind: resource.kind,
      names: [],
    };
    group.names.push(resource.name);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => [
    'delete',
    group.kind,
    ...group.names,
    '-n',
    group.namespace,
    '--ignore-not-found',
  ]);
}

/**
 * Runs every delete. Returns `false` when one fails, after it prints the reason. A failed delete
 * does not stop a deploy: the retired workload only keeps failing, as it did before.
 */
function removeRetiredResources(options = {}) {
  const run = options.run ?? ((args) => spawnSync('kubectl', args, { encoding: 'utf8' }));
  const contextArgs = options.context === undefined ? [] : ['--context', options.context];
  const log = options.log ?? ((message) => console.error(message));
  let ok = true;
  for (const args of deleteCommands(options.resources)) {
    const result = run([...contextArgs, ...args]);
    if (result.status !== 0) {
      ok = false;
      log(`WARNING: kubectl ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
      continue;
    }
    const output = (result.stdout || '').trim();
    if (output.length > 0) log(output);
  }
  return ok;
}

module.exports = { RETIRED_RESOURCES, deleteCommands, removeRetiredResources };

if (require.main === module) {
  removeRetiredResources();
}
