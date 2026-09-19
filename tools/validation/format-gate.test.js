'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const {
  parseGitStatus,
  trackedPaths,
  allPaths,
  rewrittenPaths,
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

test('rewrittenPaths reports a path that appeared', () => {
  const before = parseGitStatus(` M b.ts${NUL}`);
  const after = parseGitStatus([' M b.ts', ' M a.ts', '?? c.ts', ''].join(NUL));
  assert.deepEqual(rewrittenPaths(before, after), ['a.ts', 'c.ts']);
});

test('rewrittenPaths reports a staged file whose status code changed', () => {
  // The case a path-membership diff misses: the write rewrote a file that was already staged, so
  // the path is in both snapshots and only its code moved from `M ` to `MM`.
  const before = parseGitStatus(`M  staged.ts${NUL}`);
  const after = parseGitStatus(`MM staged.ts${NUL}`);
  assert.deepEqual(rewrittenPaths(before, after), ['staged.ts']);
});

test('rewrittenPaths reports nothing when no status changed', () => {
  const same = parseGitStatus([' M a.ts', 'M  b.ts', ''].join(NUL));
  assert.deepEqual(rewrittenPaths(same, same), []);
});

/**
 * The #151 regression guard, asserted against the shipped scripts rather than a simulation.
 *
 * `nx format:write` repairs the working tree and never the commit, so a format check that runs
 * after it reports on content CI does not read. That is how #91 shipped a file which failed CI
 * while `pre-push` printed "CI will pass".
 *
 * This reads the two scripts and fails if a write is ordered ahead of the gate. A simulation of
 * the sequence would not: reverting either script would leave it green.
 */
for (const script of ['pre-push.js', 'pre-commit.js']) {
  test(`scripts/${script} runs the format gate before any format write`, () => {
    const source = readFileSync(join(__dirname, '..', '..', 'scripts', script), 'utf8');

    const gateAt = source.indexOf('formatAlreadyChecked = runWorkspaceFormatCheck()');
    const writeAt = source.indexOf("run('pnpm exec nx format:write')");

    assert.ok(gateAt > 0, 'the script must call the format gate before the reset block');
    assert.ok(writeAt > 0, 'the script must still format what nx:reset rewrote');
    assert.ok(gateAt < writeAt, 'the format write must not run before the gate');
  });

  test(`scripts/${script} never scopes the format write with --files`, () => {
    // `nx format:write --files=…` still rewrites nx.json and the root tsconfig.json, because
    // addRootConfigFiles returns early only for --all. Scoping the write therefore launders
    // those two files past the gate. Ordering is the fix, not scoping.
    const source = readFileSync(join(__dirname, '..', '..', 'scripts', script), 'utf8');
    assert.ok(!source.includes('format:write --files'), 'the write must stay unscoped');
  });
}

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

test('an untracked file nx:reset created does not downgrade the claim', () => {
  // nx:reset writes a project.json for a newly added project. It is untracked, so it is absent
  // from the push and cannot mislead CI. The same rule as trackedDirty applies.
  const verdict = describePushVerdict({
    trackedDirty: [],
    repaired: ['apps/new-service/project.json'],
    repairedTracked: [],
  });

  assert.equal(verdict.claimsCi, true);
  assert.ok(verdict.lines.some((l) => l.includes('apps/new-service/project.json')));
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
