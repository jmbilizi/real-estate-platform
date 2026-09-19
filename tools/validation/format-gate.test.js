'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGitStatus,
  newlyDirtyPaths,
  buildScopedFormatCommand,
  repairResetOutput,
  describePushVerdict,
  MAX_LISTED_PATHS,
} = require('./format-gate');

test('parseGitStatus reads modified, staged, untracked and renamed entries', () => {
  const status = [
    ' M scripts/pre-push.js',
    'A  tools/validation/format-gate.js',
    '?? notes.txt',
    'R  old/name.ts -> new/name.ts',
    '',
  ].join('\n');

  assert.deepEqual([...parseGitStatus(status)].sort(), [
    'new/name.ts',
    'notes.txt',
    'scripts/pre-push.js',
    'tools/validation/format-gate.js',
  ]);
});

test('parseGitStatus strips the quotes git adds to an unusual path', () => {
  assert.deepEqual([...parseGitStatus(' M "apps/a b/file.ts"')], ['apps/a b/file.ts']);
});

test('parseGitStatus returns an empty set for a clean tree', () => {
  assert.equal(parseGitStatus('').size, 0);
  assert.equal(parseGitStatus(undefined).size, 0);
});

test('newlyDirtyPaths keeps only what became dirty, sorted', () => {
  const before = new Set(['b.ts']);
  const after = new Set(['b.ts', 'c.ts', 'a.ts']);
  assert.deepEqual(newlyDirtyPaths(before, after), ['a.ts', 'c.ts']);
});

test('buildScopedFormatCommand names every path and nothing else', () => {
  const { command } = buildScopedFormatCommand(['apps/a/project.json', 'apps/b/project.json']);
  assert.equal(
    command,
    'pnpm exec nx format:write --files=apps/a/project.json,apps/b/project.json',
  );
});

test('buildScopedFormatCommand returns no command for an empty list', () => {
  assert.equal(buildScopedFormatCommand([]).command, null);
});

test('buildScopedFormatCommand skips a path that --files cannot express', () => {
  const { command, skipped } = buildScopedFormatCommand(['ok.ts', 'has,comma.ts']);
  assert.equal(command, 'pnpm exec nx format:write --files=ok.ts');
  assert.deepEqual(skipped, ['has,comma.ts']);
});

test('repairResetOutput runs no formatter when nx:reset changed nothing', () => {
  const calls = [];
  const result = repairResetOutput({
    run: (command) => {
      calls.push(command);
      return { success: true };
    },
    gitStatus: () => ' M already/dirty.ts',
    before: new Set(['already/dirty.ts']),
  });

  assert.deepEqual(calls, []);
  assert.equal(result.ran, false);
  assert.deepEqual(result.formatted, []);
});

test('repairResetOutput formats only the paths nx:reset made dirty', () => {
  const calls = [];
  const result = repairResetOutput({
    run: (command) => {
      calls.push(command);
      return { success: true };
    },
    gitStatus: () => [' M apps/a/project.json', ' M src/developer-edit.ts'].join('\n'),
    before: new Set(['src/developer-edit.ts']),
  });

  assert.deepEqual(calls, ['pnpm exec nx format:write --files=apps/a/project.json']);
  assert.deepEqual(result.formatted, ['apps/a/project.json']);
  assert.equal(result.success, true);
});

test('repairResetOutput reports a failed formatter instead of swallowing it', () => {
  const result = repairResetOutput({
    run: () => ({ success: false }),
    gitStatus: () => ' M apps/a/project.json',
    before: new Set(),
  });

  assert.equal(result.ran, true);
  assert.equal(result.success, false);
});

/**
 * The #91 regression. A committed file fails the format gate CI runs, and the repair cannot reach
 * it — it is not something nx:reset touched. The gate must still fail.
 *
 * The old sequence ran a repo-wide `nx format:write` here. It repaired that file in the working
 * tree, the check that followed passed, and pre-push printed "CI will pass" while the pushed
 * commit still failed CI.
 */
test('a format-violating committed file the repair cannot touch leaves the gate failing', () => {
  const VIOLATING = 'infra/k8s/base/secrets/bright-mls.secret.yaml';

  // Files that currently fail `prettier --check`. The formatter removes what it is given.
  const violations = new Set([VIOLATING]);
  const commands = [];

  const run = (command) => {
    commands.push(command);
    const scoped = /--files=(\S+)/.exec(command);
    if (scoped) {
      for (const file of scoped[1].split(',')) violations.delete(file);
      return { success: true };
    }
    if (command.includes('format:write')) {
      // A repo-wide write — the laundering this test exists to catch.
      violations.clear();
      return { success: true };
    }
    if (command.includes('format-check')) {
      return { success: violations.size === 0 };
    }
    return { success: true };
  };

  // nx:reset rewrote a generated file. The violating file is committed and clean.
  repairResetOutput({
    run,
    gitStatus: () => ' M apps/account-service/project.json',
    before: new Set(),
  });

  const check = run('pnpm run nx:workspace-format-check');

  assert.equal(check.success, false, 'the gate must fail on a file the repair did not touch');
  assert.ok(violations.has(VIOLATING), 'the violating file must remain unrepaired');
  assert.ok(
    commands.every((c) => !c.includes('format:write') || c.includes('--files=')),
    'no repo-wide format:write may run ahead of the check',
  );
});

/**
 * The counter-case, kept so the test above cannot quietly stop testing anything. It replays the
 * same world through the sequence this ticket removed: a repo-wide `nx format:write` ahead of the
 * check. The check goes green over a commit that fails CI. That is the bug.
 */
test('the removed sequence — a repo-wide write ahead of the check — produces a false green', () => {
  const VIOLATING = 'infra/k8s/base/secrets/bright-mls.secret.yaml';
  const violations = new Set([VIOLATING]);
  const committedContentIsBroken = true;

  const run = (command) => {
    if (command.includes('format:write')) {
      violations.clear(); // repairs the working tree, never the commit
      return { success: true };
    }
    if (command.includes('format-check')) return { success: violations.size === 0 };
    return { success: true };
  };

  run('pnpm exec nx format:write');
  const check = run('pnpm run nx:workspace-format-check');

  assert.equal(check.success, true, 'the old sequence reports success');
  assert.equal(committedContentIsBroken, true, 'over a commit CI still rejects');
});

test('the push verdict claims CI only when the working tree matches HEAD', () => {
  const clean = describePushVerdict({ dirtyPaths: [] });
  assert.equal(clean.claimsCi, true);

  const dirty = describePushVerdict({
    dirtyPaths: ['infra/k8s/base/secrets/bright-mls.secret.yaml'],
  });
  assert.equal(dirty.claimsCi, false);
  assert.ok(dirty.lines.some((l) => l.includes('bright-mls.secret.yaml')));
  assert.ok(dirty.lines.some((l) => l.includes('does not predict')));
});

test('the push verdict never prints the false green', () => {
  const dirty = describePushVerdict({ dirtyPaths: ['a.ts'] });
  assert.ok(dirty.lines.every((line) => !line.includes('CI will pass')));
});

test('the push verdict names every repaired path', () => {
  const verdict = describePushVerdict({
    dirtyPaths: [],
    repairedPaths: ['apps/a/project.json', 'apps/b/project.json'],
  });
  assert.ok(verdict.lines.some((l) => l.includes('apps/a/project.json')));
  assert.ok(verdict.lines.some((l) => l.includes('apps/b/project.json')));
});

test('the push verdict truncates a long path list', () => {
  const many = Array.from({ length: MAX_LISTED_PATHS + 5 }, (_, i) => `file-${i}.ts`);
  const verdict = describePushVerdict({ dirtyPaths: many });
  assert.ok(verdict.lines.some((l) => l.includes('and 5 more')));
});
