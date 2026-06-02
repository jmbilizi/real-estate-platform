#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
  // Use 'remote' instead of 'local' so Skaffold queries the registry for the digest
  // after the custom build script pushes the image there. The 'local' option queries
  // the Docker/Podman daemon, which can return inconsistent results with Podman's
  // Docker-compatible API for images pushed to a separate local registry.
  if (!hasArg(next, '--digest-source')) {
    next.push('--digest-source=remote');
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

/**
 * Ensure the local Podman registry is running before Skaffold starts.
 * Without this, Skaffold hangs indefinitely at "Checking cache..." because it tries
 * to reach localhost:5001 to check for cached images and never gets a response.
 * After starting/recreating the registry we poll /v2/ until it responds so we
 * don't hand off to Skaffold while the container is still initialising.
 */
function ensureLocalRegistry() {
  const command = args[0];
  const commandsThatPushImages = new Set(['dev', 'debug', 'run', 'build']);
  if (!commandsThatPushImages.has(command)) {
    return;
  }

  // Only relevant when targeting the local registry.
  const usesLocalRepo =
    args.includes('localhost:5001') ||
    args.some((a) => a.includes('localhost:5001')) ||
    !args.some((a) => a.startsWith('--default-repo'));

  if (!usesLocalRepo) {
    return;
  }

  console.log('Ensuring local registry is running...');
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'local-registry.js'), 'ensure'],
    { cwd: workspaceRoot, stdio: 'inherit', shell: false },
  );
  if (result.status !== 0) {
    console.error(
      'ERROR: Failed to start local registry. Run: pnpm run infra:local:registry:ensure',
    );
    process.exit(1);
  }

  // Poll the registry API until it responds. After a container restart there is
  // a brief window where the port is bound but the HTTP server is not yet ready,
  // which causes Skaffold's cache check to hang indefinitely.
  const maxWaitMs = 15000;
  const intervalMs = 500;
  const deadline = Date.now() + maxWaitMs;
  let ready = false;
  process.stdout.write('Waiting for registry to be ready...');
  while (!ready && Date.now() < deadline) {
    const poll = spawnSync(
      process.execPath,
      [
        '-e',
        "require('http').get('http://localhost:5001/v2/',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))",
      ],
      { stdio: 'ignore', shell: false, timeout: intervalMs },
    );
    if (poll.status === 0) {
      ready = true;
    }
  }
  console.log(ready ? ' ready.' : ' timed out (continuing anyway).');
}

ensureLocalRegistry();

/**
 * Point Skaffold at Podman's socket so it doesn't hang looking for Docker.
 * On Windows, Podman exposes a named pipe; on Linux/macOS, a Unix socket.
 * Only set if DOCKER_HOST isn't already overridden by the user.
 */
function resolvePodmanDockerHost() {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST;

  if (process.platform === 'win32') {
    // Podman machine on Windows exposes a named pipe
    return 'npipe:////./pipe/podman-machine-default';
  }

  if (process.platform === 'darwin') {
    // Podman machine on macOS exposes a Unix socket under ~/.local/share/containers/podman
    const macSocket = path.join(
      os.homedir(),
      '.local/share/containers/podman/machine/podman-machine-default/podman.sock',
    );
    if (fs.existsSync(macSocket)) return `unix://${macSocket}`;
    // Fallback: rootless socket via XDG_RUNTIME_DIR
    const xdgRuntime = process.env.XDG_RUNTIME_DIR || `/var/folders`;
    const xdgSocket = `${xdgRuntime}/podman/podman.sock`;
    if (fs.existsSync(xdgSocket)) return `unix://${xdgSocket}`;
    return undefined;
  }

  // Linux: rootless (per-user) first, then rootful
  const uid = process.getuid?.() ?? 1000;
  const candidates = [`/run/user/${uid}/podman/podman.sock`, '/run/podman/podman.sock'];
  for (const p of candidates) {
    if (fs.existsSync(p)) return `unix://${p}`;
  }
  return undefined;
}

const podmanDockerHost = resolvePodmanDockerHost();

const env = {
  ...process.env,
  PATH: `${toolsBinDir}${path.delimiter}${process.env.PATH || ''}`,
  ...(podmanDockerHost ? { DOCKER_HOST: podmanDockerHost } : {}),
};

const result = spawnSync('skaffold', args, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  shell: false,
  env,
});

process.exit(result.status ?? 1);
