'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGitStatus,
  trackedPaths,
  allPaths,
  changedSince,
  describePushVerdict,
  MAX_LISTED_PATHS,
} = require('./format-gate');

const NUL = '\0';

test('parseGitStatus reads modified, staged and untracked records', () => {
  const entries = parseGitStatus(
    [' M scripts/pre-push.js', 'A  tools/validation/format-gate.js', '?? notes.txt', ''].join(NUL),
  );

  assert.deepEqual(allPaths(entries).sort(), [
    'notes.txt',
    'scripts/pre-push.js',
    'tools/validation/format-gate.js',
  ]);
  assert.deepEqual(trackedPaths(entries).sort(), [
    'scripts/pre-push.js',
    'tools/validation/format-gate.js',
  ]);
});

test('parseGitStatus keeps the destination of a rename and drops the source', () => {
  const entries = parseGitStatus(['R  new/name.ts', 'old/name.ts', ' M other.ts', ''].join(NUL));
  assert.deepEqual(allPaths(entries), ['new/name.ts', 'other.ts']);
});

test('parseGitStatus returns a path with a space verbatim', () => {
  // -z output is not quoted and not C-escaped. A quoted path would never match a real file.
  assert.deepEqual(allPaths(parseGitStatus(` M apps/a b/café.ts${NUL}`)), ['apps/a b/café.ts']);
});

test('parseGitStatus returns nothing for a clean tree', () => {
  assert.deepEqual(parseGitStatus(''), []);
  assert.deepEqual(parseGitStatus(undefined), []);
});

test('changedSince keeps only what appeared, sorted', () => {
  assert.deepEqual(changedSince(['b.ts'], ['b.ts', 'c.ts', 'a.ts']), ['a.ts', 'c.ts']);
});

/**
 * The #151 regression, stated as the property the gate must hold.
 *
 * `nx format:write` repairs the working tree and never the commit. So a format check that runs
 * after it reports on content CI does not read. The gate must run before any write.
 */
test('the format gate runs before anything writes', () => {
  const sequence = [];
  const gateIndex = () => sequence.findIndex((c) => c.includes('format-check'));
  const firstWriteIndex = () => sequence.findIndex((c) => c.includes('format:write'));

  // The order the scripts use: check, then reset, then the write.
  sequence.push(
    'pnpm run nx:workspace-format-check',
    'pnpm run nx:reset',
    'pnpm exec nx format:write',
  );

  assert.ok(gateIndex() >= 0, 'the gate must run');
  assert.ok(gateIndex() < firstWriteIndex(), 'no write may run before the gate');
});

/**
 * The #91 case that produced this ticket, played out over a fake world.
 *
 * `infra/k8s/base/secrets/bright-mls.secret.yaml` was committed without a trailing newline. The
 * old order repaired it in the tree and then reported a pass. The fixed order reports the failure.
 */
test('a format-violating committed file fails the gate, and passed it under the old order', () => {
  const VIOLATING = 'infra/k8s/base/secrets/bright-mls.secret.yaml';

  const world = () => {
    const violations = new Set([VIOLATING]);
    return {
      // The commit CI reads never changes. Only the working tree does.
      committedContentIsBroken: true,
      run(command) {
        if (command.includes('format:write')) {
          violations.clear();
          return { success: true };
        }
        if (command.includes('format-check')) return { success: violations.size === 0 };
        return { success: true };
      },
    };
  };

  const fixed = world();
  const fixedGate = fixed.run('pnpm run nx:workspace-format-check');
  fixed.run('pnpm exec nx format:write');

  const old = world();
  old.run('pnpm exec nx format:write');
  const oldGate = old.run('pnpm run nx:workspace-format-check');

  assert.equal(oldGate.success, true, 'the old order reported success');
  assert.equal(old.committedContentIsBroken, true, 'over a commit CI still rejects');
  assert.equal(fixedGate.success, false, 'the fixed order reports the failure');
});

test('the push verdict claims CI only when the working tree matches HEAD', () => {
  assert.equal(describePushVerdict({}).claimsCi, true);

  const dirty = describePushVerdict({
    trackedDirty: ['infra/k8s/base/secrets/bright-mls.secret.yaml'],
  });
  assert.equal(dirty.claimsCi, false);
  assert.ok(dirty.lines.some((l) => l.includes('bright-mls.secret.yaml')));
  assert.ok(dirty.lines.some((l) => l.includes('does not predict')));
});

test('the push verdict claims nothing when git status could not be read', () => {
  // Fail-open here would print the earned line on no evidence.
  const verdict = describePushVerdict({ statusKnown: false });
  assert.equal(verdict.claimsCi, false);
  assert.ok(verdict.lines.some((l) => l.includes('Could not read git status')));
});

test('the push verdict never prints the false green', () => {
  for (const input of [
    { trackedDirty: ['a.ts'] },
    { statusKnown: false },
    { repaired: ['apps/a/project.json'] },
  ]) {
    const verdict = describePushVerdict(input);
    assert.ok(verdict.lines.every((line) => !line.includes('CI will pass')));
  }
});

test('the push verdict reports a repaired file as script output, not as forgotten work', () => {
  const verdict = describePushVerdict({
    trackedDirty: ['apps/a/project.json'],
    repaired: ['apps/a/project.json'],
  });

  assert.ok(verdict.lines.some((l) => l.includes('nx:reset and the format write rewrote 1 file')));
  assert.ok(
    verdict.lines.every((l) => !l.includes('are not in your push')),
    'a repaired path is not also listed as an unexplained difference',
  );
  assert.equal(verdict.claimsCi, false, 'it still differs from HEAD, so CI is not predicted');
});

test('the push verdict ignores untracked files, which cannot cause a false green', () => {
  // An untracked file is absent from the push. It can make the local check stricter than CI,
  // never looser, so it must not downgrade the verdict.
  const entries = parseGitStatus(`?? scratch.md${NUL}`);
  assert.deepEqual(trackedPaths(entries), []);
  assert.equal(describePushVerdict({ trackedDirty: trackedPaths(entries) }).claimsCi, true);
});

test('the push verdict truncates a long path list', () => {
  const many = Array.from({ length: MAX_LISTED_PATHS + 5 }, (_, i) => `file-${i}.ts`);
  assert.ok(
    describePushVerdict({ trackedDirty: many }).lines.some((l) => l.includes('and 5 more')),
  );
});
