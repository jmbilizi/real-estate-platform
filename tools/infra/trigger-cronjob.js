#!/usr/bin/env node

/**
 * Trigger a CronJob's job immediately, wait for it, and print its logs.
 *
 * `bright-mls-ingest` (#91) is the repo's first CronJob, and a scheduled job that can only be
 * observed by waiting for its schedule is a job nobody verifies. This is the wrapper that makes
 * "run it now and show me what it logged" a supported operation rather than a hand-typed
 * `kubectl create job --from=...` — which `.agents/hooks/enforce-pnpm-wrappers.js` blocks, and
 * rightly: an ad-hoc mutation carries none of the context safety below.
 *
 * Deliberately local-only. It refuses to run against any context that is not the local Kind
 * cluster, because "trigger this now" against dev or prod is a real deploy-time decision and
 * belongs to the deploy workflow's control flags, not to a developer convenience script.
 *
 * Usage:
 *   node tools/infra/trigger-cronjob.js <cronjob-name> [--name <job-name>] [--timeout <seconds>]
 *                                       [--namespace <ns>] [--keep]
 *
 * Exit code is the job's outcome: 0 when it completed, 1 when it failed or timed out.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const workspaceRoot = path.resolve(__dirname, '../..');

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
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

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { cwd: workspaceRoot, stdio: 'inherit', shell: false });
}

/** Mirrors run-skaffold.js: the local cluster config is the source of truth for the context. */
function localKubeContextCandidates() {
  const configPath = path.resolve(
    workspaceRoot,
    'infra/k8s/podman/local/cluster/cluster-config.yaml',
  );
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

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== '--');
  const options = { namespace: 'default', timeout: 180, keep: false, cronjob: null, name: null };

  // A value-taking flag reads the NEXT argument, so a trailing `--namespace` would otherwise hand
  // `undefined` to spawnSync and surface as an ERR_INVALID_ARG_TYPE stack trace instead of the
  // usage error this function exists to produce.
  const valueFor = (flag, i) => {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('-')) {
      console.error(`ERROR: ${flag} requires a value.`);
      process.exit(1);
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--namespace' || arg === '-n') options.namespace = valueFor(arg, i++);
    else if (arg === '--timeout') options.timeout = Number(valueFor(arg, i++));
    else if (arg === '--name') options.name = valueFor(arg, i++);
    else if (arg === '--keep') options.keep = true;
    else if (!arg.startsWith('-') && options.cronjob === null) options.cronjob = arg;
    else {
      console.error(`ERROR: unrecognised argument '${arg}'.`);
      process.exit(1);
    }
  }

  if (!options.cronjob) {
    console.error(
      'Usage: node tools/infra/trigger-cronjob.js <cronjob-name> [--name <job-name>] ' +
        '[--timeout <seconds>] [--namespace <ns>] [--keep]',
    );
    process.exit(1);
  }
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    console.error('ERROR: --timeout must be a positive number of seconds.');
    process.exit(1);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

const candidates = localKubeContextCandidates();
if (!candidates) {
  console.error('ERROR: no local cluster config found — refusing to guess a target cluster.');
  process.exit(1);
}

const current = capture('kubectl', ['config', 'current-context']);
if (!current.ok || !candidates.includes(current.stdout)) {
  console.error(
    `ERROR: refusing to trigger a job outside the local cluster.\n` +
      `  Current context: ${current.ok ? current.stdout : '<none>'}\n` +
      `  Expected one of: ${candidates.join(', ')}\n` +
      `  Bring the local cluster up with: pnpm run infra:local:cluster:setup`,
  );
  process.exit(1);
}

const exists = capture('kubectl', [
  'get',
  'cronjob',
  options.cronjob,
  '-n',
  options.namespace,
  '-o',
  'name',
]);
if (!exists.ok) {
  console.error(
    `ERROR: CronJob '${options.cronjob}' not found in namespace '${options.namespace}'.\n` +
      `  Deploy it first with: pnpm run skaffold:services:deploy`,
  );
  process.exit(1);
}

// A timestamped default keeps repeat runs from colliding on an existing Job name, which is an
// immutable object and would otherwise fail the second invocation with AlreadyExists.
const jobName = options.name || `${options.cronjob}-manual-${Date.now().toString(36)}`;

console.log(`▶ Creating Job '${jobName}' from cronjob/${options.cronjob}...`);
const created = run('kubectl', [
  'create',
  'job',
  jobName,
  `--from=cronjob/${options.cronjob}`,
  '-n',
  options.namespace,
]);
if (created.status !== 0) {
  console.error(`ERROR: failed to create Job '${jobName}'.`);
  process.exit(1);
}

console.log(`⏳ Waiting up to ${options.timeout}s for completion...`);
const waited = capture('kubectl', [
  'wait',
  `--for=condition=complete`,
  `--timeout=${options.timeout}s`,
  `job/${jobName}`,
  '-n',
  options.namespace,
]);

// `kubectl wait` on a single condition reports a timeout for a job that failed, so read the real
// status rather than inferring the outcome from the wait's exit code.
const succeeded = capture('kubectl', [
  'get',
  `job/${jobName}`,
  '-n',
  options.namespace,
  '-o',
  'jsonpath={.status.succeeded}',
]);
const failed = capture('kubectl', [
  'get',
  `job/${jobName}`,
  '-n',
  options.namespace,
  '-o',
  'jsonpath={.status.failed}',
]);

console.log(`\n── logs (job/${jobName}) ──`);
run('kubectl', [
  'logs',
  `job/${jobName}`,
  '-n',
  options.namespace,
  '--all-containers',
  '--tail=-1',
]);

const succeededCount = Number(succeeded.stdout || '0');
const failedCount = Number(failed.stdout || '0');
console.log(
  `\n── status ──\n  succeeded: ${succeededCount}\n  failed: ${failedCount}\n` +
    `  wait: ${waited.ok ? 'condition met' : waited.stderr || 'not met'}`,
);

if (!options.keep) {
  console.log(`\n🧹 Deleting Job '${jobName}' (pass --keep to retain it).`);
  run('kubectl', ['delete', `job/${jobName}`, '-n', options.namespace, '--wait=false']);
}

if (succeededCount > 0) {
  console.log(`\n✓ Job '${jobName}' completed.`);
  process.exit(0);
}
console.error(`\n✗ Job '${jobName}' did not complete successfully.`);
process.exit(1);
