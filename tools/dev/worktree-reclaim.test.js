'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePorcelain,
  classifyWorktree,
  reclaim,
  parseArgs,
  DEFAULT_OLDER_THAN_MS,
} = require('./worktree-reclaim');

/** A successful probe result, mirroring the shape of a real `spawnSync` call. */
function ok(stdout = '') {
  return { status: 0, stdout, stderr: '', error: null };
}

/** A failed probe result: git exited non-zero. */
function fail(stderr = 'fatal: boom') {
  return { status: 1, stdout: '', stderr, error: null };
}

/** A probe that never ran at all: the runner itself threw. */
function crash(message = 'spawn git ENOENT') {
  return { status: null, stdout: '', stderr: '', error: new Error(message) };
}

// Fixed clock for staleness tests. Idle time is always `NOW - mtimeMs`.
const NOW_MS = 1_000 * 60 * 60 * 1000; // an arbitrary "now", far past any test's mtime deltas
const now = () => NOW_MS;

// A stat result that is well outside the default 24h window, so probes default to "stale"
// unless a test deliberately wants "active".
const STALE_MTIME_MS = NOW_MS - DEFAULT_OLDER_THAN_MS * 2;
const staleStatFile = () => ({ mtimeMs: STALE_MTIME_MS });

// A stat result touched moments ago, inside the default window.
const FRESH_MTIME_MS = NOW_MS - 1000;
const freshStatFile = () => ({ mtimeMs: FRESH_MTIME_MS });

/** A run() for classifyWorktree tests that answers `rev-parse --absolute-git-dir` by default. */
function withGitDir(run, gitDir = '/repo/worktrees/target/.git/worktrees/target') {
  return (args, opts) => {
    if (args[2] === 'rev-parse') return ok(gitDir);
    return run(args, opts);
  };
}

// --- parsePorcelain -----------------------------------------------------------------------

test('parsePorcelain reads a realistic multi-record fixture', () => {
  const fixture = [
    'worktree /repo',
    'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/worktrees/42-ticket',
    'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'branch refs/heads/42-ticket',
    '',
    'worktree /repo/worktrees/locked-one',
    'HEAD cccccccccccccccccccccccccccccccccccccccc',
    'branch refs/heads/locked-branch',
    'locked reason: manual review pending',
    '',
    'worktree /repo/worktrees/detached-one',
    'HEAD dddddddddddddddddddddddddddddddddddddddd',
    'detached',
    '',
    'worktree /repo/worktrees/gone-one',
    'HEAD eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'branch refs/heads/gone-branch',
    'prunable gitdir file points to a non-existent location',
    '',
  ].join('\n');

  const records = parsePorcelain(fixture);
  assert.equal(records.length, 5);

  assert.deepEqual(records[0], {
    path: '/repo',
    head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    branch: 'main',
    bare: false,
    detached: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    prunableReason: null,
  });

  assert.equal(records[1].path, '/repo/worktrees/42-ticket');
  assert.equal(records[1].branch, '42-ticket');

  assert.equal(records[2].locked, true);
  assert.equal(records[2].lockedReason, 'reason: manual review pending');

  assert.equal(records[3].detached, true);
  assert.equal(records[3].branch, null);

  assert.equal(records[4].prunable, true);
  assert.equal(records[4].prunableReason, 'gitdir file points to a non-existent location');
});

// --- classifyWorktree -----------------------------------------------------------------------

function baseRecord(overrides = {}) {
  return {
    path: '/repo/worktrees/target',
    head: 'ffffffffffffffffffffffffffffffffffffffff',
    branch: 'a-branch',
    bare: false,
    detached: false,
    locked: false,
    lockedReason: null,
    prunable: false,
    prunableReason: null,
    ...overrides,
  };
}

test('a dirty worktree classifies dirty', () => {
  const run = withGitDir((args) => (args[2] === 'status' ? ok(' M file.txt\n') : ok()));
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'dirty');
});

test('a worktree with unpushed commits classifies unpushed', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('abc1234 a commit\n');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'unpushed');
});

test('a clean, pushed, unlocked, stale worktree classifies reclaimable', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'reclaimable');
});

test('a failing status probe classifies unknown, never clean', () => {
  const run = withGitDir((args) => (args[2] === 'status' ? fail() : ok()));
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'unknown');
});

test('a status probe whose runner throws also classifies unknown', () => {
  const run = withGitDir((args) => (args[2] === 'status' ? crash() : ok()));
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'unknown');
});

test('a failing log probe classifies unknown, never absent', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return fail();
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'unknown');
});

test('a locked but otherwise clean, stale worktree classifies locked', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(baseRecord({ locked: true, lockedReason: 'in review' }), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'locked');
  assert.equal(result.reason, 'in review');
});

// The agent harness locks a worktree it is using and writes the owning process id into the lock
// reason. A live process there means a lane is running, so no flag may remove that worktree.

test('a lock naming a live process classifies running, not locked', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(
    baseRecord({ locked: true, lockedReason: 'claude agent agent-abc (pid 37512)' }),
    {
      run,
      pathExists: () => true,
      now,
      statFile: staleStatFile,
      isProcessAlive: () => true,
    },
  );
  assert.equal(result.classification, 'running');
  assert.match(result.reason, /pid 37512/);
});

test('a lock naming a dead process falls back to locked', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(
    baseRecord({ locked: true, lockedReason: 'claude agent agent-abc (pid 37512)' }),
    {
      run,
      pathExists: () => true,
      now,
      statFile: staleStatFile,
      isProcessAlive: () => false,
    },
  );
  assert.equal(result.classification, 'locked');
});

test('a running worktree survives --apply --force', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch', [
      'locked claude agent agent-abc (pid 37512)',
    ]),
    status: () => ok(''),
    log: () => ok(''),
    revParse: () => ok('/repo/.git/worktrees/target'),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    statFile: staleStatFile,
    now,
    isProcessAlive: () => true,
    cwd: '/repo',
    apply: true,
    force: true,
  });

  assert.equal(result.entries[1].classification, 'running');
  assert.equal(result.entries[1].action, 'skipped');
  assert.equal(
    calls.filter((call) => call.args[0] === 'worktree' && call.args[1] === 'remove').length,
    0,
  );
});

test('a locked but dirty worktree classifies dirty, not locked', () => {
  const run = withGitDir((args) => (args[2] === 'status' ? ok(' M file.txt\n') : ok()));
  const result = classifyWorktree(baseRecord({ locked: true }), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
  });
  assert.equal(result.classification, 'dirty');
});

test('a missing path classifies orphaned without running any git probe', () => {
  const run = () => {
    throw new Error('must not probe a path that does not exist');
  };
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => false });
  assert.equal(result.classification, 'orphaned');
});

test('git-reported prunable classifies orphaned without running any probe', () => {
  const run = () => {
    throw new Error('must not probe a worktree git already reports as prunable');
  };
  const result = classifyWorktree(baseRecord({ prunable: true, prunableReason: 'gone' }), {
    run,
    pathExists: () => true,
  });
  assert.equal(result.classification, 'orphaned');
  assert.equal(result.reason, 'gone');
});

// Finding #2 regression: an inaccessible path (permission denied, EBUSY, a detached volume) must
// never be misread as "absent". Only ENOENT proves the path is gone.
test('a path probe that fails for a reason other than ENOENT classifies unknown, never orphaned', () => {
  const permissionError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const run = () => {
    throw new Error('must not run any git probe once the path probe itself failed');
  };
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => {
      throw permissionError;
    },
  });
  assert.equal(result.classification, 'unknown');
  assert.match(result.reason, /EACCES/);
});

// Finding #1 regression: a clean, pushed worktree still inside the reclaim window is `active`,
// never a removal candidate — regardless of lock state.
test('a clean, pushed worktree touched inside the window classifies active, not reclaimable', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: freshStatFile,
  });
  assert.equal(result.classification, 'active');
  assert.match(result.reason, /reclaim window/);
});

test('a clean, pushed, locked worktree touched inside the window classifies active, not locked', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(baseRecord({ locked: true, lockedReason: 'in review' }), {
    run,
    pathExists: () => true,
    now,
    statFile: freshStatFile,
  });
  assert.equal(result.classification, 'active');
});

test('--older-than narrows the window: a worktree stale under 24h can still be active under a longer window', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  // Idle for exactly DEFAULT_OLDER_THAN_MS * 2 (staleStatFile), so it is stale under the default
  // window but still active under a much longer one.
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: staleStatFile,
    olderThanMs: DEFAULT_OLDER_THAN_MS * 10,
  });
  assert.equal(result.classification, 'active');
});

test('a failing git-dir probe classifies unknown, never stale or active', () => {
  const run = (args) => {
    if (args[2] === 'rev-parse') return fail();
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => true, now });
  assert.equal(result.classification, 'unknown');
});

test('a throwing statFile classifies unknown, never stale or active', () => {
  const run = withGitDir((args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  });
  const result = classifyWorktree(baseRecord(), {
    run,
    pathExists: () => true,
    now,
    statFile: () => {
      throw new Error('ENOENT: no such file or directory');
    },
  });
  assert.equal(result.classification, 'unknown');
});

// --- parseArgs ----------------------------------------------------------------------------

test('parseArgs accepts a positive --older-than value', () => {
  const args = parseArgs(['--apply', '--older-than', '48']);
  assert.equal(args.olderThanHours, 48);
});

test('parseArgs accepts --older-than 0 (an always-stale window)', () => {
  const args = parseArgs(['--older-than', '0']);
  assert.equal(args.olderThanHours, 0);
});

test('parseArgs rejects a negative or non-numeric --older-than value', () => {
  assert.throws(() => parseArgs(['--older-than', '-5']), /non-negative number/);
  assert.throws(() => parseArgs(['--older-than', 'abc']), /non-negative number/);
});

// --- reclaim ----------------------------------------------------------------------------------

/** Build a two-record `worktree list --porcelain` fixture: the primary plus one target. */
function listFixture(targetPath, targetBranch, extraLines = []) {
  return [
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    `worktree ${targetPath}`,
    'HEAD 2222222222222222222222222222222222222222',
    `branch refs/heads/${targetBranch}`,
    ...extraLines,
    '',
  ].join('\n');
}

/** A run() that records every call and dispatches by git subcommand. */
function buildRun(scenario) {
  const calls = [];
  const run = (args, opts) => {
    calls.push({ args, opts });
    if (args[0] === 'worktree' && args[1] === 'list') {
      return ok(scenario.listOutput);
    }
    if (args[0] === '-C') {
      const sub = args[2];
      if (sub === 'rev-parse') return scenario.gitDir ? scenario.gitDir() : ok('/gitdir');
      if (sub === 'status') return scenario.status(args[1]);
      if (sub === 'log') return scenario.log(args[1]);
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      return scenario.remove ? scenario.remove(args) : ok();
    }
    if (args[0] === 'worktree' && args[1] === 'prune') {
      return scenario.prune ? scenario.prune() : ok();
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  return { run, calls };
}

// Default reclaim()-level options: a fixed clock, a stale stat, and a cwd that never matches a
// fixture's worktree path (so "self" never accidentally triggers in unrelated tests).
const staleOptions = { now, statFile: staleStatFile, cwd: '/repo' };

test('the primary worktree is never a removal candidate', () => {
  const { run } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok(''),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    ...staleOptions,
  });
  const primary = result.entries.find((entry) => entry.path === '/repo');
  assert.equal(primary.classification, 'primary');
  assert.equal(primary.action, 'kept');
});

test('a dirty worktree is never removed, even with --apply and --force', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(' M file.txt\n'),
    log: () => ok(''),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    ...staleOptions,
  });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'dirty');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});

test('a worktree with unpushed commits is never removed', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok('abc1234 a commit\n'),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    ...staleOptions,
  });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'unpushed');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});

test('a clean, pushed, stale worktree classifies reclaimable and is removed with --force under --apply', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok(''),
    remove: () => ok(),
  });
  const result = reclaim({ run, pathExists: () => true, apply: true, ...staleOptions });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'reclaimable');
  assert.equal(target.action, 'removed');
  const removeCall = calls.find((call) => call.args[1] === 'remove');
  assert.deepEqual(removeCall.args, ['worktree', 'remove', '--force', '/repo/worktrees/target']);
  assert.equal(result.failed, false);
});

test('dry run by default removes nothing at all', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok(''),
  });
  const result = reclaim({ run, pathExists: () => true, ...staleOptions });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'reclaimable');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
  assert.equal(
    calls.some((call) => call.args[1] === 'prune'),
    false,
  );
});

test('a failing status probe classifies unknown and is skipped, even under --apply', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => fail(),
    log: () => ok(''),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    ...staleOptions,
  });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'unknown');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});

test('a failing log probe classifies unknown and is skipped, even under --apply', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => fail(),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    ...staleOptions,
  });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'unknown');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});

test('locked is skipped without --force, and removed with double --force when otherwise clean and stale', () => {
  const scenario = {
    listOutput: listFixture('/repo/worktrees/target', 'target-branch', ['locked in review']),
    status: () => ok(''),
    log: () => ok(''),
    remove: () => ok(),
  };

  const { run: runNoForce } = buildRun(scenario);
  const withoutForce = reclaim({
    run: runNoForce,
    pathExists: () => true,
    apply: true,
    ...staleOptions,
  });
  const skipped = withoutForce.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(skipped.classification, 'locked');
  assert.equal(skipped.action, 'skipped');

  const { run: runWithForce, calls } = buildRun(scenario);
  const withForce = reclaim({
    run: runWithForce,
    pathExists: () => true,
    apply: true,
    force: true,
    ...staleOptions,
  });
  const removed = withForce.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(removed.classification, 'locked');
  assert.equal(removed.action, 'removed');
  const removeCall = calls.find((call) => call.args[1] === 'remove');
  assert.deepEqual(removeCall.args, [
    'worktree',
    'remove',
    '--force',
    '--force',
    '/repo/worktrees/target',
  ]);
});

test('a worktree with unpushed commits survives --apply --force', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok('a1b2c3d work nobody else has'),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    ...staleOptions,
  });

  assert.equal(result.entries[1].classification, 'unpushed');
  assert.equal(result.entries[1].action, 'skipped');
  assert.equal(
    calls.filter((call) => call.args[0] === 'worktree' && call.args[1] === 'remove').length,
    0,
  );
});

test('an orphaned worktree (missing path) is pruned once under --apply', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/gone', 'gone-branch'),
    status: () => {
      throw new Error('must not probe a path that does not exist');
    },
    log: () => {
      throw new Error('must not probe a path that does not exist');
    },
    prune: () => ok(),
  });
  const result = reclaim({ run, pathExists: () => false, apply: true, ...staleOptions });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/gone');
  assert.equal(target.classification, 'orphaned');
  assert.equal(target.action, 'pruned');
  const pruneCalls = calls.filter((call) => call.args[1] === 'prune');
  assert.equal(pruneCalls.length, 1);
});

// Finding #2 regression at the reclaim() level: an inaccessible path must never trigger
// `hasOrphaned` / a repo-wide prune.
test('an inaccessible worktree path classifies unknown and never triggers a prune', () => {
  const permissionError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => {
      throw new Error('must not probe once the path probe itself failed');
    },
    log: () => {
      throw new Error('must not probe once the path probe itself failed');
    },
    prune: () => {
      throw new Error('must never prune from an inaccessible-path classification');
    },
  });
  const result = reclaim({
    run,
    pathExists: () => {
      throw permissionError;
    },
    apply: true,
    ...staleOptions,
  });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'unknown');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'prune'),
    false,
  );
});

// Finding #1 regression at the reclaim() level: a clean, pushed worktree still inside the window
// is never removed, even with --apply --force.
test('a clean, pushed worktree inside the reclaim window classifies active and is never removed', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok(''),
    remove: () => ok(),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    now,
    statFile: freshStatFile,
    cwd: '/repo',
  });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'active');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});

// Finding #5 regression: the script must never remove the worktree it is running inside.
test('the worktree matching the injected cwd classifies self and is never removed', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => {
      throw new Error('must not probe the worktree the script runs inside');
    },
    log: () => {
      throw new Error('must not probe the worktree the script runs inside');
    },
    remove: () => ok(),
  });
  const result = reclaim({
    run,
    pathExists: () => true,
    apply: true,
    force: true,
    now,
    statFile: staleStatFile,
    cwd: '/repo/worktrees/target',
  });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'self');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});
