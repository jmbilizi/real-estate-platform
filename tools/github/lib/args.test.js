const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('./args');

test('parseArgs reads a value flag and skips its value', () => {
  const args = parseArgs(['--issue', '57', '--priority', 'P0']);
  assert.equal(args.issue, '57');
  assert.equal(args.priority, 'P0');
});

test('parseArgs ignores the literal -- separator pnpm forwards', () => {
  const args = parseArgs(['--', '--issue', '57']);
  assert.equal(args.issue, '57');
});

test('parseArgs sets a declared flag to true without consuming the next argument', () => {
  const args = parseArgs(['--decline', '--reason', 'Superseded'], { flags: ['decline'] });
  assert.equal(args.decline, true);
  assert.equal(args.reason, 'Superseded');
});

test('parseArgs accumulates a repeatable key into an array', () => {
  const args = parseArgs(['--add-label', 'a', '--add-label', 'b'], { repeatable: ['add-label'] });
  assert.deepEqual(args['add-label'], ['a', 'b']);
});

test('parseArgs rejects a value flag whose value is the next flag', () => {
  assert.throws(
    () => parseArgs(['--title', '--decline']),
    /--title requires a value \(got "--decline"\)/,
  );
});

test('parseArgs rejects a value flag as the final argv element', () => {
  assert.throws(() => parseArgs(['--title']), /--title requires a value$/);
});

test('parseArgs rejects an empty value, so an empty --title never reaches gh', () => {
  assert.throws(() => parseArgs(['--title', '']), /--title requires a value$/);
});

test('parseArgs uses the per-key noun in a repeatable key error message', () => {
  assert.throws(
    () =>
      parseArgs(['--add-label', '--priority', 'P0'], {
        repeatable: { 'add-label': 'a label name' },
      }),
    /--add-label requires a label name \(got "--priority"\)/,
  );
});

test('parseArgs accepts prose that starts with dashes, which a comment or a reason often does', () => {
  assert.equal(parseArgs(['--body', '--- superseded by #61']).body, '--- superseded by #61');
  assert.equal(
    parseArgs(['--reason', '--decline was premature']).reason,
    '--decline was premature',
  );
});

test('parseArgs does not treat an Object.prototype key as repeatable', () => {
  const args = parseArgs(['--constructor', 'x'], { repeatable: ['add-label'] });
  assert.equal(args.constructor, 'x');
});

test('parseArgs collects positionals only when they are enabled', () => {
  assert.deepEqual(parseArgs(['create', '--name', 'x'], { positionals: true })._, ['create']);
  assert.equal(parseArgs(['create', '--name', 'x']).name, 'x');
});
