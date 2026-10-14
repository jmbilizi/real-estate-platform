const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The script runs on import, so the test reads its source. Importing would start the setup.
const source = fs.readFileSync(path.join(__dirname, 'dotnet-dev-setup.js'), 'utf8');

test('every requiredDotNet* identifier is declared (#214)', () => {
  const declared = new Set(
    [...source.matchAll(/\b(?:const|let|var)\s+(requiredDotNet\w*)/g)].map((m) => m[1]),
  );
  const used = new Set([...source.matchAll(/\brequiredDotNet\w*/g)].map((m) => m[0]));
  const undeclared = [...used].filter((name) => !declared.has(name));
  assert.deepStrictEqual(undeclared, []);
});
