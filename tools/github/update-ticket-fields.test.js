const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('./update-ticket-fields');

test('parseArgs accumulates repeated --add-label into an array, not overwriting', () => {
  const args = parseArgs(['--add-label', 'a', '--add-label', 'b']);
  assert.deepEqual(args['add-label'], ['a', 'b']);
});

test('parseArgs accumulates --remove-label independently of --add-label', () => {
  const args = parseArgs(['--add-label', 'a', '--remove-label', 'x', '--add-label', 'b']);
  assert.deepEqual(args['add-label'], ['a', 'b']);
  assert.deepEqual(args['remove-label'], ['x']);
});

test('parseArgs rejects --add-label followed by another flag instead of swallowing it', () => {
  assert.throws(
    () => parseArgs(['--issue', '35', '--add-label', '--priority', 'P0']),
    /--add-label requires a label name \(got "--priority"\)/,
  );
});

test('parseArgs rejects --remove-label followed by another flag, naming itself in the message', () => {
  assert.throws(
    () => parseArgs(['--remove-label', '--status', 'Ready']),
    /--remove-label requires a label name \(got "--status"\)/,
  );
});

test('parseArgs rejects --add-label as the final argv element instead of pushing undefined', () => {
  assert.throws(
    () => parseArgs(['--issue', '35', '--add-label']),
    /--add-label requires a label name$/,
  );
});

test('parseArgs rejects --remove-label as the final argv element', () => {
  assert.throws(() => parseArgs(['--remove-label']), /--remove-label requires a label name$/);
});

test('parseArgs still parses a boolean flag (--remove-milestone) as before', () => {
  const args = parseArgs(['--issue', '35', '--remove-milestone']);
  assert.equal(args['remove-milestone'], true);
});

test('parseArgs still parses a plain value flag (--priority) as before', () => {
  const args = parseArgs(['--issue', '35', '--priority', 'P0']);
  assert.equal(args.issue, '35');
  assert.equal(args.priority, 'P0');
});
