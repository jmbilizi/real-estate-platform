'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveReviewRange, checkNxRoot } = require('./review-range');

function fakeGit(responses) {
  return (args) => {
    const key = args.join(' ');
    if (!(key in responses)) throw new Error(`unexpected git ${key}`);
    const value = responses[key];
    if (value instanceof Error) throw value;
    return value;
  };
}

test('resolves branch, merge base, range and files', () => {
  const result = resolveReviewRange(
    fakeGit({
      'rev-parse --abbrev-ref HEAD': '304-x',
      'merge-base origin/dev HEAD': 'abc123',
      'diff --name-only abc123..HEAD': 'a.js\nb.js\n',
    }),
  );
  assert.equal(result.range, 'origin/dev...304-x');
  assert.deepEqual(result.files, ['a.js', 'b.js']);
});

test('falls back to local dev when origin/dev is missing', () => {
  const result = resolveReviewRange(
    fakeGit({
      'rev-parse --abbrev-ref HEAD': '304-x',
      'merge-base origin/dev HEAD': new Error('no origin/dev'),
      'merge-base dev HEAD': 'def456',
      'diff --name-only def456..HEAD': 'a.js',
    }),
  );
  assert.equal(result.base, 'dev');
});

test('fails on a detached HEAD', () => {
  assert.throws(
    () => resolveReviewRange(fakeGit({ 'rev-parse --abbrev-ref HEAD': 'HEAD' })),
    /detached/,
  );
});

test('fails when the branch cannot be resolved', () => {
  assert.throws(
    () => resolveReviewRange(fakeGit({ 'rev-parse --abbrev-ref HEAD': new Error('boom') })),
    /Cannot resolve the current branch/,
  );
});

test('fails when no merge base resolves', () => {
  assert.throws(
    () =>
      resolveReviewRange(
        fakeGit({
          'rev-parse --abbrev-ref HEAD': '304-x',
          'merge-base origin/dev HEAD': new Error('bad'),
          'merge-base dev HEAD': new Error('bad'),
        }),
      ),
    /Cannot resolve a merge base/,
  );
});

test('checkNxRoot flags a root that names another tree', () => {
  assert.match(checkNxRoot('C:/repo', 'C:/repo/.claude/worktrees/w1'), /wrong tree/);
});

test('checkNxRoot accepts an unset root or the same tree', () => {
  assert.equal(checkNxRoot(undefined, 'C:/repo/w1'), null);
  assert.equal(checkNxRoot('C:\\repo\\w1\\', 'C:/repo/w1'), null);
});
