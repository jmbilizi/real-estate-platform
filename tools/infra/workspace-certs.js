#!/usr/bin/env node

/**
 * Make sure the enterprise CA bundle exists before a local image build.
 *
 * `.workspace-certs/workspace-enterprise-roots.pem` is git-ignored. `infra:local:cluster:setup`
 * writes it in one checkout. A new git worktree starts without it. An empty `.workspace-certs/`
 * directory makes the Dockerfile skip the enterprise CA step, and the build later fails with an
 * opaque `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` error. See ticket #107.
 *
 * A local build always needs the bundle. CI does not, so CI skips this check.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BUNDLE_DIR = '.workspace-certs';
const BUNDLE_FILE = 'workspace-enterprise-roots.pem';
const SETUP_COMMAND = 'pnpm run infra:local:cluster:setup';
const ENSURE_COMMAND = 'pnpm run infra:local:certs:ensure';

function bundlePath(root) {
  return path.join(root, BUNDLE_DIR, BUNDLE_FILE);
}

/** True when the file exists and holds at least one certificate. */
function hasBundle(file) {
  try {
    return fs.readFileSync(file, 'utf-8').includes('-----BEGIN CERTIFICATE-----');
  } catch {
    return false;
  }
}

/**
 * Find the main checkout root through `git rev-parse --git-common-dir`.
 * Returns null when git cannot answer.
 */
function findMainCheckoutRoot(root) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf-8',
  });
  if (result.error || result.status !== 0) return null;
  const commonDir = result.stdout.trim();
  return commonDir ? path.dirname(commonDir) : null;
}

/**
 * Decide what a build must do about the bundle. Pure.
 *
 * @param {{ isCi: boolean, localHasBundle: boolean, mainBundleFile: string | null }} state
 * @returns {{ action: 'skip' | 'ok' | 'copy' | 'fail', from?: string }}
 */
function planCerts(state) {
  if (state.isCi) return { action: 'skip' };
  if (state.localHasBundle) return { action: 'ok' };
  if (state.mainBundleFile) return { action: 'copy', from: state.mainBundleFile };
  return { action: 'fail' };
}

function missingMessage(root) {
  return (
    `Enterprise CA bundle not found: ${bundlePath(root)}\n` +
    'A local image build needs it behind SSL inspection. Without it the build fails later with\n' +
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY.\n' +
    `Create it with: ${SETUP_COMMAND}\n` +
    `A worktree copies it from the main checkout with: ${ENSURE_COMMAND}`
  );
}

/**
 * Ensure the bundle exists in `root`. Copies it from the main checkout when only that has it.
 * Throws with an actionable message when no bundle is available. Does nothing in CI.
 *
 * @param {string} root workspace root of the building tree
 * @param {{ env?: NodeJS.ProcessEnv, log?: (m: string) => void }} [options]
 * @returns {'skip' | 'ok' | 'copy'}
 */
function ensureWorkspaceCerts(root, options = {}) {
  const env = options.env || process.env;
  const log = options.log || console.log;

  const mainRoot = findMainCheckoutRoot(root);
  const mainFile =
    mainRoot && path.resolve(mainRoot) !== path.resolve(root) ? bundlePath(mainRoot) : null;

  const plan = planCerts({
    isCi: Boolean(env.CI) && env.CI !== 'false',
    localHasBundle: hasBundle(bundlePath(root)),
    mainBundleFile: mainFile && hasBundle(mainFile) ? mainFile : null,
  });

  if (plan.action === 'fail') throw new Error(missingMessage(root));
  if (plan.action === 'copy') {
    fs.mkdirSync(path.join(root, BUNDLE_DIR), { recursive: true });
    fs.copyFileSync(plan.from, bundlePath(root));
    log(`Copied enterprise CA bundle from the main checkout: ${plan.from}`);
  }
  return plan.action;
}

function main() {
  const root = path.resolve(__dirname, '../..');
  try {
    const action = ensureWorkspaceCerts(root);
    console.log(`Enterprise CA bundle: ${action}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { planCerts, hasBundle, bundlePath, ensureWorkspaceCerts, missingMessage };
