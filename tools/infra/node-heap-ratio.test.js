'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  RATIO,
  DEFAULT_FILES,
  computeMaxOldSpaceSize,
  parseMemoryMi,
  parseMaxOldSpaceSize,
  checkNodeHeapRatio,
} = require('./node-heap-ratio');

const FIXTURES = path.join(__dirname, 'fixtures/node-heap-ratio');
const fixture = (name) => path.join(FIXTURES, name);

test('computeMaxOldSpaceSize floors limit / RATIO', () => {
  assert.equal(computeMaxOldSpaceSize(768), 512);
  assert.equal(computeMaxOldSpaceSize(512), 341);
});

test('parseMemoryMi reads a "<n>Mi" string and rejects other units', () => {
  assert.equal(parseMemoryMi('768Mi'), 768);
  assert.equal(parseMemoryMi('1Gi'), null);
  assert.equal(parseMemoryMi(undefined), null);
});

test('parseMaxOldSpaceSize reads the value out of a NODE_OPTIONS string', () => {
  assert.equal(parseMaxOldSpaceSize('--max-old-space-size=512'), 512);
  assert.equal(parseMaxOldSpaceSize('--max-old-space-size=512 --trace-warnings'), 512);
  assert.equal(parseMaxOldSpaceSize(undefined), null);
});

test('every checked-in environment matches limits.memory / RATIO', () => {
  assert.deepEqual(checkNodeHeapRatio(DEFAULT_FILES), []);
});

test('a patch that inherits both fields from base passes', () => {
  const problems = checkNodeHeapRatio({
    base: fixture('base-ok.cronjob.yaml'),
    'patch-inherits': fixture('patch-inherits-ok.cronjob.yaml'),
  });
  assert.deepEqual(problems, []);
});

test('a patch that lowers the memory limit without a matching NODE_OPTIONS is reported', () => {
  const problems = checkNodeHeapRatio({
    base: fixture('base-ok.cronjob.yaml'),
    'patch-drifted': fixture('patch-drifted-memory.cronjob.yaml'),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /patch-drifted/);
  assert.match(problems[0], /expected 256/);
});

test('a NODE_OPTIONS value off the ratio is reported', () => {
  const problems = checkNodeHeapRatio({ base: fixture('wrong-ratio.cronjob.yaml') });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expected 512/);
});

test('a missing NODE_OPTIONS with no base to inherit from is reported', () => {
  const problems = checkNodeHeapRatio({ base: fixture('no-node-options.cronjob.yaml') });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no NODE_OPTIONS/);
});

test("RATIO is Node's own RSS-to-heap guidance, not an arbitrary constant", () => {
  assert.equal(RATIO, 1.5);
});
