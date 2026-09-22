#!/usr/bin/env node

/**
 * Resolve the local Kind cluster's kube context, and refuse any other context.
 *
 * Every local-only tool needs the same guard: a convenience script that mutates or reads the local
 * cluster must never reach dev, test or prod because the caller left a context selected. The local
 * cluster config is the source of truth for the name, so the guard cannot drift from the cluster the
 * setup script actually creates.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const workspaceRoot = path.resolve(__dirname, '../..');
const CLUSTER_CONFIG_PATH = path.resolve(
  workspaceRoot,
  'infra/k8s/podman/local/cluster/cluster-config.yaml',
);

/** Raised when the current context is not the local cluster, or cannot be determined. */
class LocalKubeContextError extends Error {}

/**
 * Context names that identify the local cluster.
 *
 * Kind prefixes the context with `kind-`, but a config may name the context outright. Both forms
 * are accepted, plus the bare cluster name, because all three appear in real kubeconfigs.
 *
 * @param {string} [configPath]
 * @returns {string[]|null} Candidate names, or `null` when no local cluster config exists.
 */
function localKubeContextCandidates(configPath = CLUSTER_CONFIG_PATH) {
  if (!fs.existsSync(configPath)) return null;

  let config;
  try {
    config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
  if (!config || typeof config !== 'object') return null;

  const clusterName = typeof config.cluster_name === 'string' ? config.cluster_name.trim() : '';
  if (!clusterName) return null;

  const candidates = [];
  if (typeof config.kubectl_context === 'string' && config.kubectl_context.trim()) {
    candidates.push(config.kubectl_context.trim());
  }
  candidates.push(`kind-${clusterName}`, clusterName);
  return candidates;
}

/** Read the selected context name. Returns `null` when kubectl cannot answer. */
function currentKubeContext(runner = spawnSync) {
  const result = runner('kubectl', ['config', 'current-context'], {
    cwd: workspaceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (!result || result.status !== 0) return null;
  return (result.stdout || '').toString().trim() || null;
}

/**
 * Assert the local cluster is the selected context.
 *
 * Throws `LocalKubeContextError` with a message that names the fix. The caller prints the message
 * and exits, so every local tool refuses the same way for the same reason.
 *
 * @param {{ configPath?: string, runner?: Function, action?: string }} [options]
 * @returns {string} The resolved context name.
 */
function assertLocalKubeContext(options = {}) {
  const action = options.action || 'run this command';
  const candidates = localKubeContextCandidates(options.configPath);
  if (!candidates) {
    throw new LocalKubeContextError(
      `No local cluster config found, so there is no target to ${action} against.\n` +
        '  Expected: infra/k8s/podman/local/cluster/cluster-config.yaml\n' +
        '  Create the cluster with: pnpm run infra:local:cluster:setup',
    );
  }

  const current = currentKubeContext(options.runner);
  if (!current || !candidates.includes(current)) {
    throw new LocalKubeContextError(
      `Refusing to ${action} outside the local cluster.\n` +
        `  Current context: ${current || '<none>'}\n` +
        `  Expected one of: ${candidates.join(', ')}\n` +
        '  Bring the local cluster up with: pnpm run infra:local:cluster:setup',
    );
  }
  return current;
}

module.exports = {
  CLUSTER_CONFIG_PATH,
  LocalKubeContextError,
  assertLocalKubeContext,
  currentKubeContext,
  localKubeContextCandidates,
};
