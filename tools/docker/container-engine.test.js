const test = require('node:test');
const assert = require('node:assert');
const { resolveContainerEngine } = require('./container-engine');

const only =
  (...installed) =>
  (engine) =>
    installed.includes(engine);

test('podman-only machine resolves podman (#110)', () => {
  assert.deepStrictEqual(resolveContainerEngine({ env: {}, probe: only('podman') }), {
    engine: 'podman',
    source: 'detected',
  });
});

test('docker-only machine resolves docker', () => {
  assert.strictEqual(resolveContainerEngine({ env: {}, probe: only('docker') }).engine, 'docker');
});

test('both installed resolves podman, the local engine', () => {
  const probe = only('podman', 'docker');
  assert.strictEqual(resolveContainerEngine({ env: {}, probe }).engine, 'podman');
});

test('CONTAINER_ENGINE pins the engine when both are installed', () => {
  const result = resolveContainerEngine({
    env: { CONTAINER_ENGINE: 'Docker' },
    probe: only('podman', 'docker'),
  });
  assert.deepStrictEqual(result, { engine: 'docker', source: 'override' });
});

test('an override for a missing engine fails and names it', () => {
  assert.throws(
    () => resolveContainerEngine({ env: { CONTAINER_ENGINE: 'docker' }, probe: only('podman') }),
    /"docker" is not installed/,
  );
});

test('an unknown override fails', () => {
  assert.throws(
    () => resolveContainerEngine({ env: { CONTAINER_ENGINE: 'nerdctl' }, probe: only('podman') }),
    /must be one of podman, docker/,
  );
});

test('no engine fails with a clear message', () => {
  assert.throws(() => resolveContainerEngine({ env: {}, probe: only() }), /No container engine/);
});
