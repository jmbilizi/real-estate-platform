#!/usr/bin/env node

'use strict';

/**
 * Launcher for `pnpm run cribstop:web`.
 *
 * An agent worktree has no git-ignored `apps/clients/cribstop/next/.env.local`. That file carries
 * API_GATEWAY_URL and API_GATEWAY_BASIC_AUTH for the deployed dev gateway (#408). A permission hook
 * blocks agents from reading or copying credential files, so a worktree lane cannot set the file up
 * itself.
 *
 * Fix, matching the root `.env` pattern (`tools/infra/run-skaffold.js`): when the app directory has
 * no `.env.local` and this runs from a linked worktree, load the primary checkout's file into the
 * process with `process.loadEnvFile()`. That call never overrides a variable already set in the
 * shell. The file itself is never read into a log, printed, written, copied, or symlinked — only
 * its key names are reported.
 *
 * When the app directory already has its own `.env.local`, this changes nothing: Next.js loads it
 * as it always has.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parsePorcelain } = require('./worktree-reclaim');

const workspaceRoot = path.resolve(__dirname, '../..');
const APP_ENV_LOCAL_RELATIVE = path.join('apps', 'clients', 'cribstop', 'next', '.env.local');

/** Run `git`, returning trimmed stdout, or null on any failure. Never throws. */
function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.trim();
}

/**
 * The primary checkout is the parent of the shared `.git` directory. A linked worktree's
 * `--git-common-dir` still points at the primary checkout's `.git`, so this resolves the same
 * path whether `cwd` is the primary checkout or a worktree.
 */
function resolvePrimaryCheckoutFromCommonDir(cwd, gitRunner = runGit) {
  const commonDir = gitRunner(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!commonDir) return null;
  return path.dirname(commonDir);
}

/**
 * Fallback: the first entry `git worktree list` reports is always the primary checkout. Reuses
 * `worktree-reclaim.js`'s porcelain parser so the two tools share one source of truth for the
 * format.
 */
function resolvePrimaryCheckoutFromWorktreeList(cwd, gitRunner = runGit) {
  const output = gitRunner(['worktree', 'list', '--porcelain'], cwd);
  if (!output) return null;
  const [first] = parsePorcelain(output);
  return first?.path || null;
}

function resolvePrimaryCheckout(cwd, gitRunner = runGit) {
  return (
    resolvePrimaryCheckoutFromCommonDir(cwd, gitRunner) ||
    resolvePrimaryCheckoutFromWorktreeList(cwd, gitRunner)
  );
}

/**
 * Which `.env.local` to load, decided from facts the caller already checked. Kept pure — no git,
 * no filesystem — so the resolution rule is unit-testable on its own.
 */
function selectEnvLocalPath({ appHasOwnEnvLocal, primaryCheckoutRoot, primaryHasEnvLocal }) {
  if (appHasOwnEnvLocal) return null;
  if (!primaryCheckoutRoot || !primaryHasEnvLocal) return null;
  return path.join(primaryCheckoutRoot, APP_ENV_LOCAL_RELATIVE);
}

/** Key names only, in file order. Never returns a value — callers must never log one. */
function readEnvKeyNames(envFilePath) {
  const contents = fs.readFileSync(envFilePath, 'utf8');
  const keys = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/** Load the primary checkout's `.env.local` into this process, if there is one to load. */
function loadPrimaryEnvLocal(cwd) {
  const appEnvLocalPath = path.join(cwd, APP_ENV_LOCAL_RELATIVE);
  const appHasOwnEnvLocal = fs.existsSync(appEnvLocalPath);
  if (appHasOwnEnvLocal) return;

  const primaryCheckoutRoot = resolvePrimaryCheckout(cwd);
  const primaryEnvLocalPath = primaryCheckoutRoot
    ? path.join(primaryCheckoutRoot, APP_ENV_LOCAL_RELATIVE)
    : null;
  const envLocalToLoad = selectEnvLocalPath({
    appHasOwnEnvLocal,
    primaryCheckoutRoot,
    primaryHasEnvLocal: Boolean(primaryEnvLocalPath && fs.existsSync(primaryEnvLocalPath)),
  });
  if (!envLocalToLoad) return;

  try {
    const keyNames = readEnvKeyNames(envLocalToLoad);
    process.loadEnvFile(envLocalToLoad); // never overrides a variable already set in the shell
    console.log(
      `[cribstop:web] Loaded ${keyNames.length} key(s) from the primary checkout's .env.local: ` +
        keyNames.join(', '),
    );
    console.log(`[cribstop:web] Source: ${envLocalToLoad}`);
  } catch (error) {
    console.error(`[cribstop:web] Failed to load ${envLocalToLoad} — ${error.message}`);
  }
}

function main() {
  loadPrimaryEnvLocal(workspaceRoot);

  const result = spawnSync('pnpm', ['exec', 'nx', 'serve', 'cribstop-next'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  resolvePrimaryCheckoutFromCommonDir,
  resolvePrimaryCheckoutFromWorktreeList,
  resolvePrimaryCheckout,
  selectEnvLocalPath,
  readEnvKeyNames,
};
