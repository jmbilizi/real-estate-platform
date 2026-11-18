'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isDotnetAbsent,
  createDotnetDetector,
  createOptionalPlugin,
} = require('./optional-dotnet-plugin-core');

const enoent = () => ({
  error: Object.assign(new Error('spawnSync dotnet ENOENT'), { code: 'ENOENT' }),
});
const ok = () => ({ status: 0, stdout: '8.0.400\n' });

function fakeRealPlugin() {
  const calls = [];
  return {
    calls,
    plugin: {
      name: '@nx/dotnet',
      createNodesV2: [
        '**/*.{csproj,fsproj,vbproj}',
        (files, options, context) => {
          calls.push(['nodes', files, options, context]);
          return [['a.csproj', { projects: {} }]];
        },
      ],
      createDependencies: (options, context) => {
        calls.push(['deps', options, context]);
        return [{ source: 'a', target: 'b', type: 'static' }];
      },
    },
  };
}

test('isDotnetAbsent is true only for ENOENT', () => {
  assert.equal(isDotnetAbsent(enoent), true);
  assert.equal(isDotnetAbsent(ok), false);
  assert.equal(
    isDotnetAbsent(() => ({ status: 1 })),
    false,
  );
  assert.equal(
    isDotnetAbsent(() => ({ error: Object.assign(new Error('x'), { code: 'EACCES' }) })),
    false,
  );
});

test('the detector probes again while dotnet is absent, then stops once found', () => {
  const results = [enoent, enoent, ok];
  let probes = 0;
  const detect = createDotnetDetector(() => results[Math.min(probes++, 2)]());
  assert.equal(detect(), false);
  assert.equal(detect(), false);
  assert.equal(detect(), true);
  assert.equal(detect(), true);
  assert.equal(probes, 3);
});

test('with dotnet absent, the plugin gives nothing and warns once', async () => {
  const { calls, plugin: real } = fakeRealPlugin();
  const warnings = [];
  const plugin = createOptionalPlugin({
    real,
    hasDotnet: () => false,
    warn: (message) => warnings.push(message),
  });
  assert.equal(plugin.createNodesV2[0], real.createNodesV2[0]);
  assert.deepEqual(await plugin.createNodesV2[1](['a.csproj'], {}, {}), []);
  assert.deepEqual(await plugin.createDependencies({}, {}), []);
  assert.equal(calls.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /dotnet:env/);
});

test('with dotnet present, every call goes to the real plugin unchanged', async () => {
  const { calls, plugin: real } = fakeRealPlugin();
  const plugin = createOptionalPlugin({ real, hasDotnet: () => true, warn: assert.fail });
  const options = { lintTargetName: 'lint' };
  const context = { workspaceRoot: '/repo' };
  assert.deepEqual(await plugin.createNodesV2[1](['a.csproj'], options, context), [
    ['a.csproj', { projects: {} }],
  ]);
  assert.equal((await plugin.createDependencies(options, context)).length, 1);
  assert.deepEqual(calls[0], ['nodes', ['a.csproj'], options, context]);
  assert.deepEqual(calls[1], ['deps', options, context]);
});

test('an SDK installed after load takes over on the next call', async () => {
  const { calls, plugin: real } = fakeRealPlugin();
  let installed = false;
  const plugin = createOptionalPlugin({ real, hasDotnet: () => installed, warn: () => {} });
  assert.deepEqual(await plugin.createNodesV2[1](['a.csproj'], {}, {}), []);
  installed = true;
  assert.equal((await plugin.createNodesV2[1](['a.csproj'], {}, {})).length, 1);
  assert.equal(calls.length, 1);
});

test('the wrapper module loads the real @nx/dotnet glob', () => {
  const wrapper = require('./optional-dotnet-plugin');
  assert.equal(wrapper.createNodesV2[0], require('@nx/dotnet').createNodesV2[0]);
  assert.equal(typeof wrapper.createDependencies, 'function');
});
