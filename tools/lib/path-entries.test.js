const test = require('node:test');
const assert = require('node:assert');

const {
  computeMissingPathEntries,
  computeMissingTools,
  parseGlobalToolList,
} = require('./path-entries');

const exists = () => true;

test('returns empty when PATH already has the entries, including case and slash variants', () => {
  const missing = computeMissingPathEntries({
    pathValue: 'C:\\Windows;C:\\USERS\\me\\.dotnet\\;c:\\users\\me\\.dotnet\\tools',
    delimiter: ';',
    candidates: [{ dir: 'C:\\Users\\me\\.dotnet' }, { dir: 'C:\\Users\\me\\.dotnet\\tools' }],
    dirExists: exists,
  });
  assert.deepStrictEqual(missing, []);
});

test('returns only the entries that are missing', () => {
  const missing = computeMissingPathEntries({
    pathValue: '/usr/bin:/home/me/.dotnet',
    delimiter: ':',
    candidates: [{ dir: '/home/me/.dotnet' }, { dir: '/home/me/.dotnet/tools' }],
    dirExists: exists,
    caseInsensitive: false,
  });
  assert.deepStrictEqual(missing, ['/home/me/.dotnet/tools']);
});

test('skips an entry whose directory is missing', () => {
  const missing = computeMissingPathEntries({
    pathValue: '/usr/bin',
    delimiter: ':',
    candidates: [{ dir: '/home/me/.dotnet/tools' }],
    dirExists: () => false,
  });
  assert.deepStrictEqual(missing, []);
});

test('skips an entry when its tool already resolves', () => {
  const missing = computeMissingPathEntries({
    pathValue: 'C:\\Program Files\\dotnet',
    delimiter: ';',
    candidates: [{ dir: 'C:\\Users\\me\\.dotnet', tool: 'dotnet' }],
    dirExists: exists,
    resolves: (tool) => tool === 'dotnet',
  });
  assert.deepStrictEqual(missing, []);
});

test('adds an entry when the directory exists and the tool does not resolve', () => {
  const missing = computeMissingPathEntries({
    pathValue: 'C:\\Windows',
    delimiter: ';',
    candidates: [{ dir: 'C:\\Users\\me\\.dotnet', tool: 'dotnet' }],
    dirExists: exists,
    resolves: () => false,
  });
  assert.deepStrictEqual(missing, ['C:\\Users\\me\\.dotnet']);
});

const listOutput = [
  'Package Id      Version      Commands',
  '-------------------------------------',
  'csharpier       1.0.0        csharpier',
  'dotnet-format   5.1.0        dotnet-format',
].join('\n');

test('parses the global tool list', () => {
  assert.deepStrictEqual(parseGlobalToolList(listOutput), ['csharpier', 'dotnet-format']);
});

test('skips tools that are already installed', () => {
  const wanted = [{ name: 'CSharpier' }, { name: 'dotnet-format' }, { name: 'dotnet-doc' }];
  assert.deepStrictEqual(computeMissingTools(listOutput, wanted), [{ name: 'dotnet-doc' }]);
  assert.deepStrictEqual(computeMissingTools(listOutput, wanted.slice(0, 2)), []);
});
