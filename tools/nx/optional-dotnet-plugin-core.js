'use strict';

/**
 * Logic for `optional-dotnet-plugin.js`, kept apart so tests can drive it without loading a plugin.
 *
 * The decision is made per call, not at load. An Nx daemon keeps a plugin loaded for its whole
 * life, so a load-time decision would hide an SDK installed while the daemon runs.
 */

const { spawnSync } = require('child_process');

const WARNING =
  '[nx] .NET SDK not found. .NET projects are left out of the Nx graph. ' +
  'To include them, run pnpm run dotnet:env.';

/**
 * True only when the probe shows that no `dotnet` executable exists on PATH. A probe that fails any
 * other way returns false, so the real plugin runs and reports the real error.
 */
function isDotnetAbsent(run = spawnSync) {
  const result = run('dotnet', ['--version'], { stdio: 'pipe', shell: false });
  return result?.error?.code === 'ENOENT';
}

/**
 * A detector that probes again while `dotnet` is absent and remembers it once found. An ENOENT
 * probe costs about a millisecond. A successful probe is not repeated.
 */
function createDotnetDetector(run = spawnSync) {
  let found = false;
  return () => {
    if (!found) found = !isDotnetAbsent(run);
    return found;
  };
}

/**
 * The `@nx/dotnet` plugin with each hook gated on the detector. With `dotnet` present, every call
 * goes to the real hook unchanged. With it absent, the hooks give no nodes and no dependencies.
 */
function createOptionalPlugin({ real, hasDotnet, warn }) {
  const [glob, realCreateNodes] = real.createNodesV2;
  let warned = false;
  const skip = () => {
    if (hasDotnet()) return false;
    if (!warned && warn) warn(WARNING);
    warned = true;
    return true;
  };

  return {
    name: real.name ?? '@nx/dotnet',
    createNodesV2: [
      glob,
      (files, options, context) => (skip() ? [] : realCreateNodes(files, options, context)),
    ],
    createDependencies: (options, context) =>
      skip() ? [] : real.createDependencies(options, context),
  };
}

module.exports = { isDotnetAbsent, createDotnetDetector, createOptionalPlugin, WARNING };
