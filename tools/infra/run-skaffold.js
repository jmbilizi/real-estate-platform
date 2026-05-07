#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const workspaceRoot = path.resolve(__dirname, '../..');
const toolsBinDir = path.join(workspaceRoot, 'tools', 'bin');

let args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node tools/infra/run-skaffold.js <skaffold args...>');
  process.exit(1);
}

const { withDefaultRepoArg } = require('./registry-settings');

// Keep package.json scripts simple, and allow CI to override via env.
args = withDefaultRepoArg(args, args[0]);

function hasArg(argsList, name) {
  return argsList.includes(name) || argsList.some((a) => a.startsWith(`${name}=`));
}

function addLocalRegistrySafetyFlags(argsList) {
  const command = argsList[0];
  const commandsThatBuildOrResolveImages = new Set(['dev', 'debug', 'run', 'build']);
  if (!commandsThatBuildOrResolveImages.has(command)) {
    return argsList;
  }

  // If user already specified these flags, don't override.
  if (hasArg(argsList, '--insecure-registry') && hasArg(argsList, '--digest-source')) {
    return argsList;
  }

  // Only apply for the default local dev registry.
  // (If user overrides --default-repo to something else, they can also specify their own flags.)
  const defaultRepoIndex = argsList.findIndex(
    (a) => a === '--default-repo' || a.startsWith('--default-repo='),
  );
  let defaultRepo = null;
  if (defaultRepoIndex >= 0) {
    const val = argsList[defaultRepoIndex].startsWith('--default-repo=')
      ? argsList[defaultRepoIndex].split('=').slice(1).join('=')
      : argsList[defaultRepoIndex + 1];
    if (typeof val === 'string' && val.trim()) {
      defaultRepo = val.trim().replace(/\/+$/, '');
    }
  }

  const isLocalRegistry = defaultRepo === 'localhost:5001' || defaultRepo === '127.0.0.1:5001';
  if (!isLocalRegistry) {
    return argsList;
  }

  const next = [...argsList];

  // Local registry is plain HTTP.
  if (!hasArg(next, '--insecure-registry')) {
    next.push('--insecure-registry=localhost:5001');
    next.push('--insecure-registry=127.0.0.1:5001');
  }

  // Ensure rebuilds trigger a rollout even when the tag is stable (gitCommit).
  if (!hasArg(next, '--digest-source')) {
    next.push('--digest-source=local');
  }

  return next;
}

args = addLocalRegistrySafetyFlags(args);

function addFastExitFlags(argsList) {
  const command = argsList[0];
  const commandsWithWatchLoop = new Set(['dev', 'debug']);
  if (!commandsWithWatchLoop.has(command)) {
    return argsList;
  }

  // For local watch loops, prefer fast Ctrl+C exit.
  // Cleanup/delete can be done explicitly via `skaffold delete` (see package.json skaffold:delete).
  if (hasArg(argsList, '--cleanup')) {
    return argsList;
  }

  return [...argsList, '--cleanup=false'];
}

args = addFastExitFlags(args);

function spawnOk(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: workspaceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').toString().trim(),
    stderr: (result.stderr || '').toString().trim(),
  };
}

function getLocalKubeContextCandidates() {
  const configPath = path.resolve(
    workspaceRoot,
    'infra/k8s/podman/local/cluster/cluster-config.yaml',
  );
  if (!fs.existsSync(configPath)) {
    return null;
  }

  let config;
  try {
    config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }

  if (!config || typeof config !== 'object') {
    return null;
  }

  const clusterNameRaw = config.cluster_name;
  if (!clusterNameRaw || typeof clusterNameRaw !== 'string' || !clusterNameRaw.trim()) {
    return null;
  }
  const clusterName = clusterNameRaw.trim();

  const candidates = [];
  if (
    config.kubectl_context &&
    typeof config.kubectl_context === 'string' &&
    config.kubectl_context.trim()
  ) {
    candidates.push(config.kubectl_context.trim());
  }
  candidates.push(`kind-${clusterName}`);
  candidates.push(clusterName);
  return candidates;
}

function ensureLocalKubeContext() {
  // If user explicitly targets a context, don't override it.
  if (args.includes('--kube-context') || args.some((a) => a.startsWith('--kube-context='))) {
    return;
  }

  const command = args[0];
  const commandsThatTouchCluster = new Set(['dev', 'debug', 'run', 'delete', 'deploy']);
  if (!commandsThatTouchCluster.has(command)) {
    return;
  }

  const candidates = getLocalKubeContextCandidates();
  if (!candidates) {
    // No local cluster config => don't enforce.
    return;
  }

  const kubectlCheck = spawnOk('kubectl', ['version', '--client']);
  if (!kubectlCheck.ok) {
    console.error('ERROR: kubectl not found (required for local Skaffold deployments).');
    process.exit(1);
  }

  const current = spawnOk('kubectl', ['config', 'current-context']);
  const currentContext = current.ok ? current.stdout : null;

  // If already on a valid candidate, we're good.
  if (currentContext && candidates.includes(currentContext)) {
    return;
  }

  // Try to find an available context among candidates.
  const contexts = spawnOk('kubectl', ['config', 'get-contexts', '-o', 'name']);
  const available = contexts.ok
    ? contexts.stdout
        .split(/\r?\n/)
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  const preferred = candidates.find((c) => available.includes(c)) || candidates[0];
  const switched = spawnSync('kubectl', ['config', 'use-context', preferred], {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell: false,
  });
  if (switched.status !== 0) {
    console.error(
      `ERROR: Refusing to run Skaffold without the intended local kube-context (${preferred}).`,
    );
    process.exit(1);
  }
}

ensureLocalKubeContext();

const env = {
  ...process.env,
  PATH: `${toolsBinDir}${path.delimiter}${process.env.PATH || ''}`,
};

const result = spawnSync('skaffold', args, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: false,
  env,
});

process.exit(result.status ?? 1);
