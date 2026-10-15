/**
 * Resolves the container engine (docker or podman) for local image builds.
 * `tools/docker/build-image.js` and `tools/infra/skaffold-build.js` both use this module.
 *
 * Order: the CONTAINER_ENGINE override, then podman (the repo's local engine), then docker.
 */

const { spawnSync } = require('child_process');

const ENGINES = ['podman', 'docker'];

function isInstalled(engine) {
  const result = spawnSync(engine, ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

/**
 * @param {{ env?: Record<string, string|undefined>, probe?: (engine: string) => boolean }} [deps]
 * @returns {{ engine: string, source: 'override' | 'detected' }}
 */
function resolveContainerEngine({ env = process.env, probe = isInstalled } = {}) {
  const override = (env.CONTAINER_ENGINE || '').trim().toLowerCase();
  if (override) {
    if (!ENGINES.includes(override)) {
      throw new Error(`CONTAINER_ENGINE must be one of ${ENGINES.join(', ')}. Got "${override}".`);
    }
    if (!probe(override)) {
      throw new Error(`CONTAINER_ENGINE is "${override}", but "${override}" is not installed.`);
    }
    return { engine: override, source: 'override' };
  }
  const engine = ENGINES.find((name) => probe(name));
  if (!engine) {
    throw new Error(
      `No container engine found. Install ${ENGINES.join(' or ')}, or set CONTAINER_ENGINE.`,
    );
  }
  return { engine, source: 'detected' };
}

module.exports = { resolveContainerEngine, ENGINES };
