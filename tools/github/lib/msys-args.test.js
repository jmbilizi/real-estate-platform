const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  msysRoot,
  resetMsysRootCache,
  unmangleMsysValue,
  describeMangledFileArg,
  repairMsysArgv,
} = require('./msys-args');

const ROOT = 'C:/Program Files/Git';

test('msysRoot is null when the shell is not MSYS', () => {
  resetMsysRootCache();
  assert.equal(msysRoot({ SHELL: '/bin/bash' }), null);
  resetMsysRootCache();
});

test('unmangleMsysValue restores the leading slash the shell ate', () => {
  assert.equal(unmangleMsysValue(`${ROOT}/api/overpass check`, ROOT), '/api/overpass check');
});

test('unmangleMsysValue leaves an untouched value alone', () => {
  assert.equal(unmangleMsysValue('Add saved-search alerts', ROOT), 'Add saved-search alerts');
  assert.equal(unmangleMsysValue('C:/tmp/notes.md', ROOT), 'C:/tmp/notes.md');
  assert.equal(
    unmangleMsysValue('See C:/Program Files/Git/etc', ROOT),
    'See C:/Program Files/Git/etc',
  );
});

test('unmangleMsysValue matches the root case-insensitively', () => {
  assert.equal(unmangleMsysValue('c:/program files/git/api/x', ROOT), '/api/x');
});

test('unmangleMsysValue is a no-op with no MSYS root', () => {
  assert.equal(unmangleMsysValue(`${ROOT}/api/x`, null), `${ROOT}/api/x`);
});

test('repairMsysArgv repairs a value flag and reports it', () => {
  const reported = [];
  const argv = repairMsysArgv(['--title', `${ROOT}/api/overpass check`, '--priority', 'P1'], {
    root: ROOT,
    onRepair: (m) => reported.push(m),
  });
  assert.deepEqual(argv, ['--title', '/api/overpass check', '--priority', 'P1']);
  assert.equal(reported.length, 1);
  assert.match(reported[0], /--title/);
});

test('repairMsysArgv does not mutate the argv it was given', () => {
  const original = ['--title', `${ROOT}/api/x`];
  const argv = repairMsysArgv(original, { root: ROOT });
  assert.deepEqual(original, ['--title', `${ROOT}/api/x`]);
  assert.deepEqual(argv, ['--title', '/api/x']);
});

test('repairMsysArgv is a no-op off MSYS', () => {
  const argv = ['--title', `${ROOT}/api/x`];
  assert.equal(repairMsysArgv(argv, { root: null }), argv);
});

test('repairMsysArgv never rewrites a subcommand or a bare word', () => {
  const argv = repairMsysArgv(['update', '--title', 'Homes MVP'], { root: ROOT });
  assert.deepEqual(argv, ['update', '--title', 'Homes MVP']);
});

test('repairMsysArgv leaves a real file path alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msys-args-'));
  const file = path.join(dir, 'body.md').replace(/\\/g, '/');
  fs.writeFileSync(file, 'body');
  try {
    const argv = repairMsysArgv(['--body-file', file], { root: ROOT });
    assert.deepEqual(argv, ['--body-file', file]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repairMsysArgv rejects a path flag that conversion broke', () => {
  let rejected = null;
  repairMsysArgv(['--body-file', `${ROOT}/tickets/118.md`], {
    root: ROOT,
    onReject: (m) => {
      rejected = m;
    },
  });
  assert.match(rejected, /--body-file/);
  assert.match(rejected, /MSYS root/);
});

test('repairMsysArgv throws on a broken path flag when no onReject is given', () => {
  assert.throws(
    () => repairMsysArgv(['--plan-file', `${ROOT}/plan.md`], { root: ROOT }),
    /plan-file/,
  );
});

test('describeMangledFileArg says nothing about an ordinary missing file', () => {
  assert.equal(describeMangledFileArg('body-file', './does-not-exist.md', ROOT), null);
});
