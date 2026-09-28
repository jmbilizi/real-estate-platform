'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  canonicalizePath,
  resolvePrimaryCheckoutFromCommonDir,
  resolvePrimaryCheckoutFromWorktreeList,
  resolvePrimaryCheckout,
  selectEnvLocalPath,
  readEnvKeyNames,
} = require('./cribstop-web');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- canonicalizePath (drive-letter casing fix, #440) --------------------------------------

test('canonicalizePath returns the value from the injected realpath resolver', () => {
  const fakeRealpath = (inputPath) => {
    assert.equal(inputPath, 'c:/Src/real-estate-platform');
    return 'C:\\Src\\real-estate-platform';
  };
  assert.equal(
    canonicalizePath('c:/Src/real-estate-platform', fakeRealpath),
    'C:\\Src\\real-estate-platform',
  );
});

test('canonicalizePath falls back to the input path when the resolver throws', () => {
  const fakeRealpath = () => {
    throw new Error('ENOENT: no such file or directory');
  };
  assert.equal(canonicalizePath('/does/not/exist', fakeRealpath), '/does/not/exist');
});

test('canonicalizePath resolves two casings of a real directory to the same string', () => {
  const dir = tempDir('cribstop-web-canon-');
  try {
    const otherCasing = dir.toUpperCase() === dir ? dir.toLowerCase() : dir.toUpperCase();
    if (!fs.existsSync(otherCasing)) return; // case-sensitive filesystem: nothing to prove here
    assert.equal(canonicalizePath(otherCasing), canonicalizePath(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- resolvePrimaryCheckoutFromCommonDir -----------------------------------------------------

test('resolvePrimaryCheckoutFromCommonDir returns the parent of --git-common-dir', () => {
  const fakeGit = (args) => {
    assert.deepEqual(args, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return 'C:/Src/real-estate-platform/.git';
  };
  assert.equal(
    resolvePrimaryCheckoutFromCommonDir('C:/Src/real-estate-platform/.claude/worktrees/x', fakeGit),
    'C:/Src/real-estate-platform',
  );
});

test('resolvePrimaryCheckoutFromCommonDir returns null when git fails', () => {
  assert.equal(
    resolvePrimaryCheckoutFromCommonDir('/anywhere', () => null),
    null,
  );
});

// --- resolvePrimaryCheckoutFromWorktreeList --------------------------------------------------

test('resolvePrimaryCheckoutFromWorktreeList reads the first worktree entry', () => {
  const porcelain = [
    'worktree /home/dev/real-estate-platform',
    'HEAD abc123',
    'branch refs/heads/dev',
    '',
    'worktree /home/dev/real-estate-platform/.claude/worktrees/agent-1',
    'HEAD def456',
    'branch refs/heads/393-feature',
  ].join('\n');
  const fakeGit = () => porcelain;
  assert.equal(
    resolvePrimaryCheckoutFromWorktreeList('/anywhere', fakeGit),
    '/home/dev/real-estate-platform',
  );
});

test('resolvePrimaryCheckoutFromWorktreeList returns null on empty output', () => {
  assert.equal(
    resolvePrimaryCheckoutFromWorktreeList('/anywhere', () => null),
    null,
  );
  assert.equal(
    resolvePrimaryCheckoutFromWorktreeList('/anywhere', () => ''),
    null,
  );
});

// --- resolvePrimaryCheckout (combined) -------------------------------------------------------

test('resolvePrimaryCheckout prefers --git-common-dir over the worktree list', () => {
  const calls = [];
  const fakeGit = (args) => {
    calls.push(args[0]);
    if (args[0] === 'rev-parse') return '/repo/.git';
    return 'worktree /should-not-be-used';
  };
  assert.equal(resolvePrimaryCheckout('/anywhere', fakeGit), '/repo');
  assert.deepEqual(calls, ['rev-parse']);
});

test('resolvePrimaryCheckout falls back to the worktree list when --git-common-dir fails', () => {
  const fakeGit = (args) => {
    if (args[0] === 'rev-parse') return null;
    return 'worktree /repo\nHEAD abc';
  };
  assert.equal(resolvePrimaryCheckout('/anywhere', fakeGit), '/repo');
});

// --- selectEnvLocalPath (pure resolution rule) -----------------------------------------------

test('selectEnvLocalPath returns null when the app dir already has its own .env.local', () => {
  assert.equal(
    selectEnvLocalPath({
      appHasOwnEnvLocal: true,
      primaryCheckoutRoot: '/repo',
      primaryHasEnvLocal: true,
    }),
    null,
  );
});

test('selectEnvLocalPath returns null when the primary checkout cannot be resolved', () => {
  assert.equal(
    selectEnvLocalPath({
      appHasOwnEnvLocal: false,
      primaryCheckoutRoot: null,
      primaryHasEnvLocal: false,
    }),
    null,
  );
});

test('selectEnvLocalPath returns null when the primary checkout has no .env.local either', () => {
  assert.equal(
    selectEnvLocalPath({
      appHasOwnEnvLocal: false,
      primaryCheckoutRoot: '/repo',
      primaryHasEnvLocal: false,
    }),
    null,
  );
});

test('selectEnvLocalPath resolves the primary checkout .env.local for a linked worktree', () => {
  const result = selectEnvLocalPath({
    appHasOwnEnvLocal: false,
    primaryCheckoutRoot: '/repo',
    primaryHasEnvLocal: true,
  });
  assert.equal(result, path.join('/repo', 'apps', 'clients', 'cribstop', 'next', '.env.local'));
});

// --- readEnvKeyNames (never returns a value) -------------------------------------------------

test('readEnvKeyNames returns only key names, skipping blanks and comments', () => {
  const dir = tempDir('cribstop-web-env-');
  const file = path.join(dir, '.env.local');
  fs.writeFileSync(
    file,
    [
      '# a comment',
      '',
      'API_GATEWAY_URL=https://dev.example.com',
      'API_GATEWAY_BASIC_AUTH=user:pw',
    ].join('\n'),
  );
  try {
    assert.deepEqual(readEnvKeyNames(file), ['API_GATEWAY_URL', 'API_GATEWAY_BASIC_AUTH']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readEnvKeyNames never puts a value in its return value', () => {
  const dir = tempDir('cribstop-web-env-');
  const file = path.join(dir, '.env.local');
  const secretValue = 'super-secret-token-value';
  fs.writeFileSync(file, `API_GATEWAY_BASIC_AUTH=${secretValue}\n`);
  try {
    const keys = readEnvKeyNames(file);
    assert.deepEqual(keys, ['API_GATEWAY_BASIC_AUTH']);
    assert.ok(!keys.some((key) => key.includes(secretValue)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- process.loadEnvFile lets the shell win (the behaviour the launcher depends on) ----------

test('process.loadEnvFile lets a variable already set in the shell win', () => {
  const dir = tempDir('cribstop-web-env-');
  const file = path.join(dir, '.env.local');
  const name = 'CRIBSTOP_WEB_LAUNCHER_PROBE';
  fs.writeFileSync(file, `${name}=from-file\n`);
  process.env[name] = 'from-shell';
  try {
    process.loadEnvFile(file);
    assert.equal(process.env[name], 'from-shell');
  } finally {
    delete process.env[name];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
