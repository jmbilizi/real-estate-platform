'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePorcelain, classifyWorktree, reclaim } = require('./worktree-reclaim');

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
  const run = (args) => (args[2] === 'status' ? ok(' M file.txt\n') : ok());
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => true });
  assert.equal(result.classification, 'dirty');
});

test('a worktree with unpushed commits classifies unpushed', () => {
  const run = (args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('abc1234 a commit\n');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => true });
  assert.equal(result.classification, 'unpushed');
});

test('a clean, pushed, unlocked worktree classifies reclaimable', () => {
  const run = (args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => true });
  assert.equal(result.classification, 'reclaimable');
});

test('a failing status probe classifies unknown, never clean', () => {
  const run = (args) => (args[2] === 'status' ? fail() : ok());
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => true });
  assert.equal(result.classification, 'unknown');
});

test('a status probe whose runner throws also classifies unknown', () => {
  const run = (args) => (args[2] === 'status' ? crash() : ok());
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => true });
  assert.equal(result.classification, 'unknown');
});

test('a failing log probe classifies unknown, never absent', () => {
  const run = (args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return fail();
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  const result = classifyWorktree(baseRecord(), { run, pathExists: () => true });
  assert.equal(result.classification, 'unknown');
});

test('a locked but otherwise clean worktree classifies locked', () => {
  const run = (args) => {
    if (args[2] === 'status') return ok('');
    if (args[2] === 'log') return ok('');
    throw new Error(`unexpected call: ${args.join(' ')}`);
  };
  const result = classifyWorktree(baseRecord({ locked: true, lockedReason: 'in review' }), {
    run,
    pathExists: () => true,
  });
  assert.equal(result.classification, 'locked');
  assert.equal(result.reason, 'in review');
});

test('a locked but dirty worktree classifies dirty, not locked', () => {
  const run = (args) => (args[2] === 'status' ? ok(' M file.txt\n') : ok());
  const result = classifyWorktree(baseRecord({ locked: true }), { run, pathExists: () => true });
  assert.equal(result.classification, 'dirty');
});

test('a missing path classifies orphaned without running any probe', () => {
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

test('the primary worktree is never a removal candidate', () => {
  const { run } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok(''),
  });
  const result = reclaim({ run, pathExists: () => true, apply: true, force: true });
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
  const result = reclaim({ run, pathExists: () => true, apply: true, force: true });
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
  const result = reclaim({ run, pathExists: () => true, apply: true, force: true });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'unpushed');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});

test('a clean, pushed worktree classifies reclaimable and is removed under --apply', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok(''),
    remove: () => ok(),
  });
  const result = reclaim({ run, pathExists: () => true, apply: true });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'reclaimable');
  assert.equal(target.action, 'removed');
  const removeCall = calls.find((call) => call.args[1] === 'remove');
  assert.deepEqual(removeCall.args, ['worktree', 'remove', '/repo/worktrees/target']);
  assert.equal(result.failed, false);
});

test('dry run by default removes nothing at all', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok(''),
  });
  const result = reclaim({ run, pathExists: () => true });
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
  const result = reclaim({ run, pathExists: () => true, apply: true, force: true });
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
  const result = reclaim({ run, pathExists: () => true, apply: true, force: true });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(target.classification, 'unknown');
  assert.equal(target.action, 'skipped');
  assert.equal(
    calls.some((call) => call.args[1] === 'remove'),
    false,
  );
});

test('locked is skipped without --force, and removed with it when otherwise clean', () => {
  const scenario = {
    listOutput: listFixture('/repo/worktrees/target', 'target-branch', ['locked in review']),
    status: () => ok(''),
    log: () => ok(''),
    remove: () => ok(),
  };

  const { run: runNoForce } = buildRun(scenario);
  const withoutForce = reclaim({ run: runNoForce, pathExists: () => true, apply: true });
  const skipped = withoutForce.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(skipped.classification, 'locked');
  assert.equal(skipped.action, 'skipped');

  const { run: runWithForce, calls } = buildRun(scenario);
  const withForce = reclaim({
    run: runWithForce,
    pathExists: () => true,
    apply: true,
    force: true,
  });
  const removed = withForce.entries.find((entry) => entry.path === '/repo/worktrees/target');
  assert.equal(removed.classification, 'locked');
  assert.equal(removed.action, 'removed');
  const removeCall = calls.find((call) => call.args[1] === 'remove');
  assert.deepEqual(removeCall.args, ['worktree', 'remove', '--force', '/repo/worktrees/target']);
});

test('a worktree with unpushed commits survives --apply --force', () => {
  const { run, calls } = buildRun({
    listOutput: listFixture('/repo/worktrees/target', 'target-branch'),
    status: () => ok(''),
    log: () => ok('a1b2c3d work nobody else has'),
  });
  const result = reclaim({ run, pathExists: () => true, apply: true, force: true });

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
  const result = reclaim({ run, pathExists: () => false, apply: true });
  const target = result.entries.find((entry) => entry.path === '/repo/worktrees/gone');
  assert.equal(target.classification, 'orphaned');
  assert.equal(target.action, 'pruned');
  const pruneCalls = calls.filter((call) => call.args[1] === 'prune');
  assert.equal(pruneCalls.length, 1);
});
