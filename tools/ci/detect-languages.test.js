'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectLanguages } = require('./detect-languages');

const PROJECTS = [
  { root: 'apps/api-gateway', tags: ['runtime:dotnet', 'type:gateway'] },
  { root: 'apps/clients/cribstop/next', tags: ['runtime:node', 'type:client'] },
  { root: 'apps/services/multi-model-inference', tags: ['runtime:python', 'type:service'] },
];

test('#443: a JSON-only change in a dotnet project runs dotnet', () => {
  const result = detectLanguages(['apps/api-gateway/Configuration/Routes/account.json'], PROJECTS);
  assert.deepEqual(result, { node: false, python: false, dotnet: true });
});

test('a .tsx change in a node project runs node, not dotnet', () => {
  const result = detectLanguages(['apps/clients/cribstop/next/src/app/page.tsx'], PROJECTS);
  assert.deepEqual(result, { node: true, python: false, dotnet: false });
});

test('a pyproject.toml change inside a python project runs python', () => {
  const result = detectLanguages(['apps/services/multi-model-inference/pyproject.toml'], PROJECTS);
  assert.deepEqual(result, { node: false, python: true, dotnet: false });
});

test('a file outside any project falls back to the extension rule', () => {
  const result = detectLanguages(['docs/architecture.md'], PROJECTS);
  assert.deepEqual(result, { node: false, python: false, dotnet: false });
  // tools/dotnet/** is a dotnet fallback path even for a non-.NET extension like .md.
  const result2 = detectLanguages(['tools/dotnet/README.md'], PROJECTS);
  assert.deepEqual(result2, { node: false, python: false, dotnet: true });
});

test('a root pyproject.toml outside any project falls back to python', () => {
  const result = detectLanguages(['pyproject.toml'], PROJECTS);
  assert.deepEqual(result, { node: false, python: true, dotnet: false });
});

test('multiple changed files union their runtimes', () => {
  const result = detectLanguages(
    [
      'apps/api-gateway/Configuration/Routes/account.json',
      'apps/clients/cribstop/next/src/app/page.tsx',
    ],
    PROJECTS,
  );
  assert.deepEqual(result, { node: true, python: false, dotnet: true });
});

test('a file with no matching project and no fallback match runs nothing', () => {
  const result = detectLanguages(['README.md'], PROJECTS);
  assert.deepEqual(result, { node: false, python: false, dotnet: false });
});

test('a project with no runtime tag yet falls back to the extension rule', () => {
  // A project just generated, before `pnpm run nx:reset` adds its runtime:* tag (#443 follow-up).
  const untagged = [{ root: 'apps/services/new-service', tags: [] }];
  const result = detectLanguages(['apps/services/new-service/src/index.ts'], untagged);
  assert.deepEqual(result, { node: true, python: false, dotnet: false });
});

test('longest-prefix match picks the nested project, not a shorter sibling root', () => {
  const nested = [
    { root: 'apps/clients/cribstop', tags: ['runtime:unassigned'] },
    { root: 'apps/clients/cribstop/next', tags: ['runtime:node'] },
  ];
  const result = detectLanguages(['apps/clients/cribstop/next/src/app/page.tsx'], nested);
  assert.deepEqual(result, { node: true, python: false, dotnet: false });
});
