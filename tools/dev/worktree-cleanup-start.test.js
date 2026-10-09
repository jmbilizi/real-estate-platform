'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isThrottled, THROTTLE_MS } = require('./worktree-cleanup-start');

test('a run inside the window is throttled', () => {
  assert.equal(isThrottled(1_000, 1_000 + THROTTLE_MS - 1), true);
});

test('a run at or past the window is not throttled', () => {
  assert.equal(isThrottled(1_000, 1_000 + THROTTLE_MS), false);
});

test('a missing or invalid stamp is not throttled', () => {
  assert.equal(isThrottled(null, 5), false);
  assert.equal(isThrottled(Number.NaN, 5), false);
});
