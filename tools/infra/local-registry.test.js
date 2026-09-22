'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// tools/infra/local-registry.js runs podman through spawnSync with shell:true on
// Windows. cmd.exe then re-parses each argument, so a Go template argument arrives
// mangled and podman fails with "template: inspect:1: bad character U+007B '{'".
// Every template read returned its failure default, which made the delete-enabled
// check always false on Windows: each `ensure` force-recreated the registry, and
// each recreate orphaned a netavark DNAT rule for the host port until that port
// resolved to a dead container and image pushes failed with "no route to host".
// Read the whole object with plain `podman inspect` instead.
const SOURCE = readFileSync(join(__dirname, 'local-registry.js'), 'utf8');

// Blank the comments in place rather than deleting them. Collapsing a multi-line block
// comment to nothing shifts every line number after it, so a failure would point the
// fixer above the real offender.
function sourceWithoutComments() {
  return SOURCE.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\r\n]/g, ' ')).replace(
    /^(\s*)\/\/.*$/gm,
    '$1',
  );
}

test('local-registry.js passes no Go template to podman', () => {
  const code = sourceWithoutComments();
  const offenders = code
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(
      ({ line }) => line.includes('{{') && !line.includes('@param') && !line.includes('@returns'),
    );

  assert.deepEqual(
    offenders,
    [],
    `Go templates break under shell:true on Windows. Use plain 'podman inspect' and read the parsed JSON instead. Offending lines: ${offenders
      .map((o) => `${o.number}: ${o.line}`)
      .join(' | ')}`,
  );
});

test('local-registry.js reads container state and env from one parsed inspect object', () => {
  const code = sourceWithoutComments();

  assert.match(
    code,
    /function inspectContainer\(\)/,
    'inspectContainer() must exist as the single shell-safe inspect path',
  );
  // `container inspect` rather than bare `inspect`: podman otherwise resolves the name
  // across images, volumes and networks and can answer with the wrong object's Config.Env.
  assert.match(
    code,
    /\['container', 'inspect', REGISTRY_NAME\]/,
    "inspect must be called as ['container', 'inspect', REGISTRY_NAME] with no -f template",
  );
  // `-f` is legitimate on `podman rm -f`. What must never recur is `-f` carrying a
  // format template, which is what cmd.exe mangles.
  assert.doesNotMatch(
    code,
    /'-f',\s*'\{\{/,
    "no podman call may pass '-f' with a Go template: the argument does not survive cmd.exe",
  );
});
