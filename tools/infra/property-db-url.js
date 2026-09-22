#!/usr/bin/env node

/**
 * Derive the local `property_db` `DATABASE_URL` from the running local cluster and write it to the
 * gitignored root `.env`.
 *
 * `property-service:migrate`, `:migrate-down`, `:seed` and `e2e` all read `DATABASE_URL` and throw
 * when it is absent (`src/db/pool.ts`). Until this script existed, the only documented way to supply
 * it was a human copying a password out of a Secret by hand, which repo rule 1 forbids and which no
 * compliance suite can depend on (#58).
 *
 * Nothing here is hardcoded, on purpose. Every part of the connection string is read from the thing
 * that already owns it:
 *
 * - the user, the database name and the URL shape come from the live `property-service` Deployment,
 *   so this script cannot drift from `infra/k8s/base/deployments/property-service.deployment.yaml`;
 * - the password comes from the `postgres-secret` Secret in the cluster;
 * - the host port comes from the `postgres-svc` `portForward` entry in `skaffold.yaml`, because that
 *   entry is what makes the database reachable from the host at all.
 *
 * The in-cluster host is replaced with `localhost`. That is the only substitution: in the cluster the
 * service resolves as `postgres-svc`, and on the host it arrives through Skaffold's port-forward.
 *
 * Deliberately local-only. It refuses any context that is not the local Kind cluster. Reading a dev
 * or prod credential onto a workstation is not a developer convenience.
 *
 * Usage:
 *   node tools/infra/property-db-url.js [--print] [--env-file <path>]
 *
 * `--print` writes the URL to stdout and leaves the dotenv file alone. It exists for a caller that
 * wants the value in a pipeline. It prints the password in clear text, so it is not the default.
 * Read it into a variable. Never pass it as a command argument, which the process list exposes.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const net = require('net');
const yaml = require('js-yaml');
const { assertLocalKubeContext, LocalKubeContextError } = require('./local-kube-context');
const { readClusterSecret, ClusterSecretReadError } = require('./local-secret-overlay');

const workspaceRoot = path.resolve(__dirname, '../..');
const SKAFFOLD_PATH = path.join(workspaceRoot, 'skaffold.yaml');
const DEFAULT_ENV_FILE = path.join(workspaceRoot, '.env');
const ENV_KEY = 'DATABASE_URL';
const DEPLOYMENT = 'property-service';
const POSTGRES_SERVICE = 'postgres-svc';
const FIX = 'Bring the stack up with: pnpm run skaffold:services';

/** Raised for every failure this script reports. Always carries a message that names the fix. */
class PropertyDbUrlError extends Error {}

/**
 * Read the `property-service` Deployment's first container env as a name/value map.
 *
 * `valueFrom` entries are returned as `null`: their value lives in a Secret, and the caller resolves
 * those separately. A missing Deployment means the stack is not up, which is a refusal, not a
 * default.
 *
 * @returns {Record<string, string|null>}
 */
function readDeploymentEnv(runner = spawnSync) {
  const result = runner('kubectl', ['get', 'deployment', DEPLOYMENT, '-o', 'json'], {
    cwd: workspaceRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  if (!result || result.error) {
    throw new PropertyDbUrlError(
      `kubectl is unavailable, so the '${DEPLOYMENT}' Deployment cannot be read.\n  ${FIX}`,
    );
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').toString().trim();
    throw new PropertyDbUrlError(
      `The '${DEPLOYMENT}' Deployment is not in the local cluster, so there is nothing to derive ` +
        `the connection string from.\n  kubectl said: ${stderr || `exit ${result.status}`}\n  ${FIX}`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse((result.stdout || '').toString());
  } catch (error) {
    throw new PropertyDbUrlError(
      `kubectl returned unparseable JSON for the '${DEPLOYMENT}' Deployment: ${error.message}`,
    );
  }

  const containers = parsed?.spec?.template?.spec?.containers;
  if (!Array.isArray(containers) || containers.length === 0) {
    throw new PropertyDbUrlError(
      `The '${DEPLOYMENT}' Deployment declares no container, so it carries no environment to read.`,
    );
  }

  const env = {};
  for (const entry of containers[0].env || []) {
    if (!entry || typeof entry.name !== 'string') continue;
    env[entry.name] = typeof entry.value === 'string' ? entry.value : null;
  }
  return env;
}

/**
 * Resolve `$(VAR)` references in a Kubernetes env value.
 *
 * Kubernetes expands these itself at container start. On the host nothing does, so the same
 * expansion happens here. An unresolved reference is an error rather than an empty string, because
 * a connection string with a blank password fails later and further away.
 *
 * @param {string} template
 * @param {Record<string, string>} values
 * @returns {string}
 */
function expandKubeRefs(template, values) {
  return template.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (_match, name) => {
    const value = values[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new PropertyDbUrlError(
        `The '${DEPLOYMENT}' Deployment builds ${ENV_KEY} from $(${name}), and that value is ` +
          `empty or absent.\n  ${FIX}`,
      );
    }
    return value;
  });
}

/**
 * The host port Skaffold forwards `postgres-svc` to.
 *
 * Read from `skaffold.yaml` rather than assumed, so changing the forward in one place keeps this
 * script correct.
 *
 * @returns {number}
 */
function readForwardedPostgresPort(skaffoldPath = SKAFFOLD_PATH) {
  let documents;
  try {
    documents = yaml.loadAll(fs.readFileSync(skaffoldPath, 'utf8'));
  } catch (error) {
    throw new PropertyDbUrlError(`Cannot read ${skaffoldPath}: ${error.message}`);
  }

  for (const document of documents) {
    for (const entry of document?.portForward || []) {
      if (entry?.resourceName !== POSTGRES_SERVICE) continue;
      const localPort = Number(entry.localPort ?? entry.port);
      if (Number.isInteger(localPort) && localPort > 0) return localPort;
    }
  }

  throw new PropertyDbUrlError(
    `skaffold.yaml declares no portForward for '${POSTGRES_SERVICE}', so the database has no host ` +
      'port. Add the entry, or the host cannot reach it at all.',
  );
}

/** Resolve whether something accepts a TCP connection on `port` of localhost. */
function probeLocalPort(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const settle = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/**
 * Split the Deployment's URL TEMPLATE into its credential part and the rest.
 *
 * The split runs on the template, before any value is substituted, and that ordering is the whole
 * point. A template holds only `$(VAR)` tokens, so `:`, `@` and `/` in it are structure. A password
 * may contain all three, and once it is substituted no parser can tell a password's `@` from the
 * one that ends the credential. So the structure is read first and the values are attached after.
 *
 * @param {string} template
 * @returns {{ user: string, password: string, rest: string, scheme: string }}
 */
function splitUrlTemplate(template) {
  const match =
    /^(?<scheme>[a-z+]+:\/\/)(?<user>[^:@/]*):(?<password>[^:@/]*)@(?<rest>[^@]*)$/s.exec(template);
  if (!match) {
    throw new PropertyDbUrlError(
      `The '${DEPLOYMENT}' Deployment's ${ENV_KEY} is not a 'scheme://user:password@host/name' ` +
        'template this script can read. Fix the Deployment, or teach this script the new shape.',
    );
  }
  return match.groups;
}

/**
 * Build the host-side URL from the template's parts.
 *
 * `URL` percent-encodes whatever goes into `username` and `password`, so a credential containing
 * `@`, `/`, `:` or `+` survives intact. Building the string by hand does not.
 *
 * @param {{ user: string, password: string, rest: string, scheme: string }} parts
 * @param {Record<string, string>} values
 * @param {string} host
 * @param {number} port
 * @returns {string}
 */
function buildLocalUrl(parts, values, host, port) {
  const url = new URL(`${parts.scheme}${expandKubeRefs(parts.rest, values)}`);
  url.hostname = host;
  url.port = String(port);
  url.username = encodeURIComponent(expandKubeRefs(parts.user, values));
  url.password = encodeURIComponent(expandKubeRefs(parts.password, values));
  return url.toString();
}

/**
 * Set one key in a dotenv file, preserving every other line.
 *
 * A line-level rewrite, not a parse-and-serialise: a developer's `.env` holds comments, ordering and
 * quoting this script has no business normalising. An existing key is replaced in place, so the
 * file's shape survives repeat runs.
 *
 * @param {string} filePath
 * @param {string} key
 * @param {string} value
 * @returns {'created'|'replaced'|'appended'}
 */
function setEnvFileKey(filePath, key, value) {
  const line = `${key}=${value}`;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${line}\n`);
    return 'created';
  }

  const original = fs.readFileSync(filePath, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  // Escape the key: this helper is exported, and a future key holding a regex metacharacter would
  // otherwise match the wrong line or none at all.
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${escapedKey}\\s*=`);

  let replaced = false;
  const updated = lines.map((existing) => {
    if (replaced || !keyPattern.test(existing)) return existing;
    replaced = true;
    return line;
  });

  if (!replaced) {
    // Drop a single trailing empty line so the appended key does not leave a blank gap behind it.
    if (updated.length > 0 && updated[updated.length - 1] === '') updated.pop();
    updated.push(line, '');
  }

  fs.writeFileSync(filePath, updated.join(newline));
  return replaced ? 'replaced' : 'appended';
}

/**
 * Hide the password in a connection string, so a log line can name the target.
 *
 * `URL` is the parser, not a regex. A regex that stops at the first `@` prints the tail of a
 * password that contains one. A value this function cannot parse is replaced whole, because a
 * partial redaction is worse than none.
 */
function redactUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return '<unprintable connection string>';
  }
  if (parsed.password) parsed.password = '***';
  return parsed.toString();
}

/**
 * Derive the URL. Every failure throws `PropertyDbUrlError` with a message that names the fix.
 *
 * @param {{ runner?: Function, readSecret?: Function, skaffoldPath?: string, probe?: Function }} [deps]
 * @returns {Promise<{ url: string, port: number }>}
 */
async function deriveDatabaseUrl(deps = {}) {
  const runner = deps.runner || spawnSync;
  const readSecret = deps.readSecret || readClusterSecret;
  const probe = deps.probe || probeLocalPort;

  try {
    assertLocalKubeContext({ runner, action: 'read the local property_db credential' });
  } catch (error) {
    if (error instanceof LocalKubeContextError) throw new PropertyDbUrlError(error.message);
    throw error;
  }

  const env = readDeploymentEnv(runner);
  const template = env[ENV_KEY];
  if (typeof template !== 'string' || template.length === 0) {
    throw new PropertyDbUrlError(
      `The '${DEPLOYMENT}' Deployment declares no ${ENV_KEY}, so there is no URL shape to follow.`,
    );
  }

  // Every literal env value is already a resolution source. Only the `valueFrom` entries, whose
  // value is `null` here, still need the Secret.
  const values = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string') values[name] = value;
  }

  const secretRefs = Object.entries(env)
    .filter(([, value]) => value === null)
    .map(([name]) => name);
  if (secretRefs.length > 0) {
    let secret;
    try {
      secret = readSecret('postgres-secret');
    } catch (error) {
      if (error instanceof ClusterSecretReadError) throw new PropertyDbUrlError(error.message);
      throw error;
    }
    if (!secret) {
      throw new PropertyDbUrlError(
        "The 'postgres-secret' Secret is not in the local cluster, so the password cannot be " +
          `read.\n  ${FIX}`,
      );
    }
    for (const name of secretRefs) {
      if (typeof secret[name] === 'string') values[name] = secret[name];
    }
  }

  const parts = splitUrlTemplate(template);
  const port = readForwardedPostgresPort(deps.skaffoldPath);

  if (!(await probe(port))) {
    throw new PropertyDbUrlError(
      `Nothing answers on localhost:${port}, so ${POSTGRES_SERVICE} is not port-forwarded.\n  ${FIX}`,
    );
  }

  return { url: buildLocalUrl(parts, values, 'localhost', port), port };
}

function parseArgs(argv) {
  const options = { print: false, envFile: DEFAULT_ENV_FILE };
  const args = argv.filter((arg) => arg !== '--');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--print') options.print = true;
    else if (args[i] === '--env-file') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new PropertyDbUrlError('--env-file requires a value.');
      }
      options.envFile = path.resolve(workspaceRoot, value);
      i++;
    } else {
      throw new PropertyDbUrlError(
        `Unrecognised argument '${args[i]}'.\n` +
          '  Usage: node tools/infra/property-db-url.js [--print] [--env-file <path>]\n' +
          '  --print writes the password to stdout. Read it into a variable, never onto a command line.',
      );
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { url, port } = await deriveDatabaseUrl();

  if (options.print) {
    process.stdout.write(`${url}\n`);
    return;
  }

  const outcome = setEnvFileKey(options.envFile, ENV_KEY, url);
  const relative = path.relative(workspaceRoot, options.envFile) || options.envFile;
  console.log(`✓ ${outcome === 'replaced' ? 'Updated' : 'Wrote'} ${ENV_KEY} in ${relative}`);
  console.log(`  Target: ${redactUrl(url)} (via the localhost:${port} port-forward)`);
  console.log('  Now run: pnpm exec nx run property-service:migrate');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  PropertyDbUrlError,
  deriveDatabaseUrl,
  buildLocalUrl,
  expandKubeRefs,
  parseArgs,
  probeLocalPort,
  readDeploymentEnv,
  readForwardedPostgresPort,
  redactUrl,
  setEnvFileKey,
  splitUrlTemplate,
};
