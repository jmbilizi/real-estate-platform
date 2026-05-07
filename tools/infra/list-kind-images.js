#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const workspaceRoot = path.resolve(__dirname, '../..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: workspaceRoot,
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    encoding: 'utf-8',
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || '').toString(),
    stderr: (result.stderr || '').toString(),
  };
}

function binaryAvailable(cmd) {
  const probeArgs =
    process.platform === 'win32' ? ['/c', 'where', cmd] : ['-lc', `command -v ${cmd}`];
  const probe = process.platform === 'win32' ? run('cmd', probeArgs) : run('bash', probeArgs);
  return probe.status === 0;
}

function readClusterNameFromConfig() {
  const configPath = path.resolve(
    workspaceRoot,
    'infra/k8s/podman/local/cluster/cluster-config.yaml',
  );

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  if (!config || typeof config !== 'object') {
    return null;
  }

  const name = config.cluster_name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return null;
  }

  return name.trim();
}

function getContainerRuntime() {
  // Kind+Podman uses podman-managed node containers.
  // Fallback to docker for non-podman setups.
  if (binaryAvailable('podman')) {
    return 'podman';
  }
  if (binaryAvailable('docker')) {
    return 'docker';
  }
  return null;
}

function usageAndExit(code) {
  console.log('Usage: node tools/infra/list-kind-images.js [--cluster <name>] [--filter <text>]');
  console.log('\nLists images inside Kind node containerd (what Kubernetes can run).\n');
  console.log('Examples:');
  console.log('  node tools/infra/list-kind-images.js');
  console.log('  node tools/infra/list-kind-images.js --filter jaeger');
  console.log('  node tools/infra/list-kind-images.js --cluster myapp-podman-local');
  process.exit(code);
}

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  usageAndExit(0);
}

let clusterName = null;
let filterText = null;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--cluster') {
    clusterName = argv[i + 1];
    i++;
  } else if (arg.startsWith('--cluster=')) {
    clusterName = arg.split('=').slice(1).join('=');
  } else if (arg === '--filter') {
    filterText = argv[i + 1];
    i++;
  } else if (arg.startsWith('--filter=')) {
    filterText = arg.split('=').slice(1).join('=');
  }
}

if (!clusterName) {
  clusterName = readClusterNameFromConfig();
}

if (!clusterName) {
  console.error(
    'ERROR: Could not determine cluster name. Provide --cluster <name> or set cluster_name in infra/k8s/podman/local/cluster/cluster-config.yaml.',
  );
  process.exit(1);
}

if (!binaryAvailable('kind')) {
  console.error('ERROR: kind not found in PATH.');
  process.exit(1);
}

const runtime = getContainerRuntime();
if (!runtime) {
  console.error(
    'ERROR: Neither podman nor docker was found in PATH. Need one to exec into Kind nodes.',
  );
  process.exit(1);
}

const nodesResult = run('kind', ['get', 'nodes', '--name', clusterName]);
if (nodesResult.status !== 0) {
  console.error(`ERROR: Failed to list Kind nodes for cluster '${clusterName}'.`);
  process.stderr.write(nodesResult.stderr);
  process.exit(nodesResult.status);
}

const nodes = nodesResult.stdout
  .split(/\r?\n/)
  .map((n) => n.trim())
  .filter(Boolean);

if (nodes.length === 0) {
  console.error(`ERROR: No nodes found for cluster '${clusterName}'. Is the cluster running?`);
  process.exit(1);
}

console.log(`Kind cluster: ${clusterName}`);
console.log(`Node runtime: ${runtime}`);

let exitCode = 0;
for (const node of nodes) {
  console.log('\n========================================');
  console.log(`Node: ${node}`);
  console.log('----------------------------------------');

  // crictl is present on kindest/node images and talks to containerd.
  const imagesResult = run(runtime, ['exec', node, 'crictl', 'images']);
  if (imagesResult.status !== 0) {
    exitCode = imagesResult.status;
    console.error(`ERROR: Failed to list images via 'crictl images' on node ${node}.`);
    process.stderr.write(imagesResult.stderr);
    continue;
  }

  let output = imagesResult.stdout;
  if (filterText && typeof filterText === 'string' && filterText.trim()) {
    const needle = filterText.trim().toLowerCase();
    const lines = output.split(/\r?\n/);
    output = lines.filter((l) => l.toLowerCase().includes(needle)).join('\n') + '\n';
  }

  process.stdout.write(output);
}

process.exit(exitCode);
