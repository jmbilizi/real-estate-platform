'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const { evaluate, resolveLaneRoot } = require('./lane-boundary');

// Primary checkout stands in for the repo's own working tree; the worktree
// path stands in for a sibling lane created under `.claude/worktrees/`.
// `path.resolve('/', ...)` anchors these at the current drive root on
// win32 and at `/` on POSIX, so the fixtures are absolute on both. A
// `C:`-rooted literal is not: `path.join('C:', 'Src')` is absolute under
// win32 rules but is the relative path `C:/Src` under POSIX rules, and the
// POSIX `path` module is what this file loads on a Linux CI runner.
const PRIMARY_ROOT = path.resolve('/', 'Src', 'real-estate-platform');
const WORKTREE_ROOT = path.join(PRIMARY_ROOT, '.claude', 'worktrees', 'mine');
const OTHER_WORKTREE_ROOT = path.join(PRIMARY_ROOT, '.claude', 'worktrees', 'other');
// A tree beyond the primary checkout, derived from its parent so it stays absolute on every
// platform. A literal such as `path.join('C:', 'Src', 'other-repo')` is absolute only on win32.
// On POSIX it is the relative path `C:/Src/other-repo`, which resolves back inside the lane root,
// so the guard correctly allows it and the assertion fails on Linux only.
const OUTSIDE_ROOT = path.join(path.dirname(PRIMARY_ROOT), 'other-repo');

function editCall(filePath, laneRoot) {
  return evaluate({
    toolName: 'Edit',
    toolInput: { file_path: filePath },
    laneRoot,
    env: {},
  });
}

function bashCall(command, laneRoot, env, cwd) {
  return evaluate({
    toolName: 'Bash',
    toolInput: { command },
    laneRoot,
    env: env || {},
    cwd,
  });
}

// Guards AGENTS.md rule 2. A fixture that is absolute on win32 and relative on POSIX resolves
// back inside the lane root on Linux, so an outside-the-lane assertion passes for the wrong
// reason on one platform and fails on the other. CI caught exactly that on #309.
test('every path fixture is absolute on the host platform', () => {
  for (const [name, value] of Object.entries({
    PRIMARY_ROOT,
    WORKTREE_ROOT,
    OTHER_WORKTREE_ROOT,
    OUTSIDE_ROOT,
  })) {
    assert.ok(path.isAbsolute(value), `${name} must be absolute, got "${value}"`);
  }
  assert.ok(!OUTSIDE_ROOT.startsWith(PRIMARY_ROOT), 'OUTSIDE_ROOT must be outside PRIMARY_ROOT');
});

test('write inside the lane root is allowed', () => {
  const target = path.join(PRIMARY_ROOT, 'src', 'file.js');
  assert.equal(editCall(target, PRIMARY_ROOT), null);
});

test('write to the primary checkout is blocked from a worktree lane root', () => {
  const target = path.join(PRIMARY_ROOT, 'src', 'file.js');
  const reason = editCall(target, WORKTREE_ROOT);
  assert.match(reason, /outside this lane's root/);
});

test('write into a sibling worktree is blocked when lane root is the primary checkout', () => {
  const target = path.join(OTHER_WORKTREE_ROOT, 'src', 'file.js');
  const reason = editCall(target, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

test("write into the caller's own worktree is allowed", () => {
  const target = path.join(WORKTREE_ROOT, 'src', 'file.js');
  assert.equal(editCall(target, WORKTREE_ROOT), null);
});

test('write into the OS temp dir is allowed', () => {
  const target = path.join(os.tmpdir(), 'scratch', 'file.js');
  assert.equal(editCall(target, WORKTREE_ROOT), null);
});

test('git -C <outside path> checkout dev is blocked', () => {
  const reason = bashCall(`git -C ${OUTSIDE_ROOT} checkout dev`, PRIMARY_ROOT);
  assert.match(reason, /targets a tree outside this lane's root/);
});

test('git -C <inside path> status is allowed', () => {
  const inside = path.join(PRIMARY_ROOT, 'sub');
  assert.equal(bashCall(`git -C ${inside} status`, PRIMARY_ROOT), null);
});

test('git --git-dir pointed at a foreign worktree is blocked', () => {
  const reason = bashCall(`git --git-dir=${OTHER_WORKTREE_ROOT}/.git checkout dev`, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

test('git worktree remove is blocked', () => {
  const reason = bashCall('git worktree remove x', PRIMARY_ROOT);
  assert.match(reason, /pnpm run dev:worktree:reclaim/);
});

test('git worktree remove is allowed when the reclaim script sets the env flag', () => {
  const reason = bashCall('git worktree remove x', PRIMARY_ROOT, {
    LANE_BOUNDARY_ALLOW_WORKTREE_ADMIN: '1',
  });
  assert.equal(reason, null);
});

test('git worktree list is allowed', () => {
  assert.equal(bashCall('git worktree list', PRIMARY_ROOT), null);
});

test('git worktree add is allowed', () => {
  assert.equal(bashCall('git worktree add ../foo branch', PRIMARY_ROOT), null);
});

test('a normal non-git Bash command is allowed', () => {
  assert.equal(bashCall('pnpm run nx:workspace-format', PRIMARY_ROOT), null);
});

test('malformed input (missing tool name) returns allow', () => {
  const reason = evaluate({ toolName: undefined, toolInput: {}, laneRoot: PRIMARY_ROOT, env: {} });
  assert.equal(reason, null);
});

test('missing lane root returns allow', () => {
  const reason = evaluate({
    toolName: 'Edit',
    toolInput: { file_path: path.join(PRIMARY_ROOT, 'a.js') },
    laneRoot: null,
    env: {},
  });
  assert.equal(reason, null);
});

// --- resolveLaneRoot -------------------------------------------------------
// The script root alone is not enough. If the agent harness keeps the project
// directory on the primary checkout while the lane works in a worktree, a
// script-root-only lane root resolves to the primary checkout and allows every
// write the boundary exists to block.

test('a cwd inside a worktree narrows the lane root to that worktree', () => {
  const cwd = path.join(WORKTREE_ROOT, 'apps', 'clients');
  assert.equal(resolveLaneRoot(PRIMARY_ROOT, cwd), WORKTREE_ROOT);
});

test('a cwd inside the primary checkout keeps the script root', () => {
  const cwd = path.join(PRIMARY_ROOT, 'tools');
  assert.equal(resolveLaneRoot(PRIMARY_ROOT, cwd), PRIMARY_ROOT);
});

test('an absent cwd keeps the script root', () => {
  assert.equal(resolveLaneRoot(PRIMARY_ROOT, undefined), PRIMARY_ROOT);
});

test('a cwd outside any worktree keeps the script root', () => {
  assert.equal(resolveLaneRoot(PRIMARY_ROOT, os.tmpdir()), PRIMARY_ROOT);
});

test('the narrowed lane root blocks a write to the primary checkout', () => {
  const laneRoot = resolveLaneRoot(PRIMARY_ROOT, path.join(WORKTREE_ROOT, 'apps'));
  const reason = editCall(path.join(PRIMARY_ROOT, 'tools', 'x.js'), laneRoot);
  assert.match(String(reason), /outside this lane's root/);
});

// --- Regression: finding 1 --------------------------------------------------
// A quoted `-C`/`--git-dir` value used to be blanked to "" before the flag
// lookup ran, so the check silently no-opped and the command was allowed.

test('a quoted git -C path into a foreign worktree is blocked (finding 1)', () => {
  const reason = bashCall(`git -C "${OTHER_WORKTREE_ROOT}" checkout dev`, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

test('a quoted --git-dir path outside the lane root is blocked (finding 1)', () => {
  const reason = bashCall(`git --git-dir="${OUTSIDE_ROOT}/.git" checkout dev`, PRIMARY_ROOT);
  assert.match(reason, /targets a tree outside this lane's root/);
});

test('a single-quoted git -C path into a foreign worktree is blocked (finding 1)', () => {
  const reason = bashCall(`git -C '${OTHER_WORKTREE_ROOT}' checkout dev`, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

// --- Regression: finding 2 --------------------------------------------------
// `isInside` used to resolve a relative `-C` path against this hook process's
// own cwd instead of the lane's cwd, so an ordinary `git -C .` from inside the
// lane's worktree could false-positive as outside the lane root.

test('a relative git -C path resolves against the payload cwd, not the hook cwd (finding 2)', () => {
  const reason = bashCall('git -C . status', WORKTREE_ROOT, {}, WORKTREE_ROOT);
  assert.equal(reason, null);
});

test('a relative git -C path that escapes the lane via the payload cwd is blocked (finding 2)', () => {
  const reason = bashCall('git -C .. status', WORKTREE_ROOT, {}, WORKTREE_ROOT);
  assert.match(reason, /outside this lane's root/);
});

test('a relative git -C path with no payload cwd falls back to the lane root (finding 2)', () => {
  const reason = bashCall('git -C sub status', PRIMARY_ROOT, {}, undefined);
  assert.equal(reason, null);
});

// --- Regression: finding 3 --------------------------------------------------
// Rule D used to anchor `^\s*git\s+worktree\s+...`, so any prefix (an env
// assignment, `sudo`, a leading `&&`-joined command) bypassed the block.

test('env-prefixed git worktree remove is blocked (finding 3)', () => {
  const reason = bashCall('env FOO=1 git worktree remove x', PRIMARY_ROOT);
  assert.match(reason, /pnpm run dev:worktree:reclaim/);
});

test('sudo-prefixed git worktree move is blocked (finding 3)', () => {
  const reason = bashCall('sudo git worktree move x y', PRIMARY_ROOT);
  assert.match(reason, /pnpm run dev:worktree:reclaim/);
});

test('git worktree list is still allowed with a prefix (finding 3)', () => {
  assert.equal(bashCall('env FOO=1 git worktree list', PRIMARY_ROOT), null);
});

// --- Regression: finding 4 --------------------------------------------------
// The old comment claimed the reclaim script sets the env override for its
// own git calls. That was never true: the hook only sees agent tool calls,
// never the git child processes a script spawns, so there is no implicit
// exemption tied to the reclaim script's identity. Only the env var itself
// can allow worktree admin, and it must be set explicitly on the call.

test('git worktree remove has no implicit reclaim-script exemption (finding 4)', () => {
  const reason = bashCall('git worktree remove x', PRIMARY_ROOT, {});
  assert.match(reason, /pnpm run dev:worktree:reclaim/);
});

test('git worktree remove is allowed only when the override env var is explicitly set (finding 4)', () => {
  const blocked = bashCall('git worktree remove x', PRIMARY_ROOT, { SOME_OTHER_VAR: '1' });
  assert.match(blocked, /pnpm run dev:worktree:reclaim/);

  const allowed = bashCall('git worktree remove x', PRIMARY_ROOT, {
    LANE_BOUNDARY_ALLOW_WORKTREE_ADMIN: '1',
  });
  assert.equal(allowed, null);
});

// --- Regression: finding 5 --------------------------------------------------
// The shared fixtures resolve with whichever `path` module the host loads, so
// on a POSIX runner they carry forward slashes and never exercise the win32
// case-insensitive compare or backslash handling. These build win32 paths
// explicitly with `path.win32` instead, and are gated to
// win32 hosts, since feeding backslash paths through the POSIX `path` module
// (what this file loads as `path` when run on a POSIX CI runner) would not
// parse them as separators at all.

test(
  'a genuine absolute Windows path is matched case-insensitively',
  { skip: process.platform !== 'win32' },
  () => {
    const laneRoot = path.win32.join(
      'C:',
      'Src',
      'real-estate-platform',
      '.claude',
      'worktrees',
      'mine',
    );
    const target = path.win32.join(
      'C:',
      'SRC',
      'REAL-ESTATE-PLATFORM',
      '.CLAUDE',
      'WORKTREES',
      'MINE',
      'src',
      'file.js',
    );
    assert.equal(editCall(target, laneRoot), null);
  },
);

test(
  'a mixed forward/backslash Windows path is treated as inside the lane root',
  { skip: process.platform !== 'win32' },
  () => {
    const laneRoot = path.win32.join(
      'C:',
      'Src',
      'real-estate-platform',
      '.claude',
      'worktrees',
      'mine',
    );
    const target = 'C:/Src/real-estate-platform/.claude/worktrees/mine\\src\\file.js';
    assert.equal(editCall(target, laneRoot), null);
  },
);

test(
  'a mixed-separator path outside the lane root is still blocked',
  { skip: process.platform !== 'win32' },
  () => {
    const laneRoot = path.win32.join(
      'C:',
      'Src',
      'real-estate-platform',
      '.claude',
      'worktrees',
      'mine',
    );
    const target = 'C:/Src/real-estate-platform/tools\\x.js';
    const reason = editCall(target, laneRoot);
    assert.match(reason, /outside this lane's root/);
  },
);

// --- Round 2 regression: finding 1 (tokenizer foundation) ------------------
// `splitSegments` used a length-preserving quote mask over `&&`/`||`/`;`/`|`
// only, so a multi-line script never split on the newline between commands
// and `checkGitTargetFlags` never ran on the second line.

test('a multi-line command is split on the newline (finding 1)', () => {
  const command = `echo hi\ngit -C ${OTHER_WORKTREE_ROOT} status`;
  const reason = bashCall(command, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

test('the one-line equivalent is also blocked (finding 1)', () => {
  const command = `echo hi; git -C ${OTHER_WORKTREE_ROOT} status`;
  const reason = bashCall(command, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

// --- Round 2 regression: finding 2 (Rule D bypass and false positive) ------
// Rule D used to match against a quote-blanked copy of the segment, so the
// real command sitting inside `bash -c "..."` was invisible to the regex.
// Greedy quote pairing also broke on nested/multiple quotes, false-blocking
// an ordinary command whose text only happened to mention the phrase.

test('git worktree remove nested inside bash -c is blocked (finding 2)', () => {
  const reason = bashCall('bash -c "git worktree remove ../other"', PRIMARY_ROOT);
  assert.match(reason, /pnpm run dev:worktree:reclaim/);
});

test('a non-shell command that only mentions the phrase in prose is allowed', () => {
  // `node -e` treats its argument as data, not as a shell command, so the
  // quoted mention is prose. Only a shell invocation runs its quoted
  // argument, which is why the case above blocks and this one does not.
  const reason = bashCall(
    'node -e "console.log(\'run git worktree remove to clean up\')"',
    PRIMARY_ROOT,
  );
  assert.equal(reason, null);
});

// --- Round 2 regression: finding 3 (Rule C first-token-only) ---------------
// `checkGitTargetFlags` only inspected a segment whose FIRST token was
// `git`, so a command that reaches git through a wrapper or an env
// assignment skipped the check entirely.

test('pnpm exec git -C <foreign worktree> is blocked (finding 3)', () => {
  const reason = bashCall(`pnpm exec git -C ${OTHER_WORKTREE_ROOT} status`, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

test('env-prefixed git -C <foreign worktree> is blocked (finding 3)', () => {
  const reason = bashCall(`env X=1 git -C ${OTHER_WORKTREE_ROOT} status`, PRIMARY_ROOT);
  assert.match(reason, /another lane's worktree/);
});

// --- Round 2 regression: finding 4 (quoted argument containing -C) --------
// Naive whitespace splitting broke a quoted commit message into several
// tokens, so a bare `-C` inside the quoted text was read as the real flag
// and its "value" (the next word) was resolved as a path.

test('a commit message mentioning -C is allowed (finding 4)', () => {
  const reason = bashCall('git commit -m "note about -C /etc/passwd"', PRIMARY_ROOT);
  assert.equal(reason, null);
});

test('a commit message mentioning --git-dir is allowed (finding 4)', () => {
  const reason = bashCall('git commit -m "fix --git-dir handling"', PRIMARY_ROOT);
  assert.equal(reason, null);
});

// --- Round 2 regression: finding 5 (relative file_path resolves wrong) ----
// `checkWriteTarget` never received `cwd`, so a relative `file_path` was
// resolved against this hook process's own cwd instead of the lane's.

test('a relative file_path inside the lane is allowed (finding 5)', () => {
  const result = evaluate({
    toolName: 'Edit',
    toolInput: { file_path: 'relative.txt' },
    laneRoot: WORKTREE_ROOT,
    env: {},
    cwd: WORKTREE_ROOT,
  });
  assert.equal(result, null);
});

test('a relative file_path that escapes the lane via cwd is blocked (finding 5)', () => {
  const result = evaluate({
    toolName: 'Edit',
    // Three levels up from WORKTREE_ROOT (.claude/worktrees/mine) lands at
    // PRIMARY_ROOT, outside any worktree, so this exercises Rule A rather
    // than the foreign-worktree message of Rule B.
    toolInput: { file_path: path.join('..', '..', '..', 'escaped.js') },
    laneRoot: WORKTREE_ROOT,
    env: {},
    cwd: WORKTREE_ROOT,
  });
  assert.match(result, /outside this lane's root/);
});

// --- Rule D: a shell runs its quoted argument, other programs do not -------
// Matching every quoted mention would block an ordinary commit message. A
// rule that blocks ordinary commands gets switched off, and then nothing is
// enforced. So quoted text counts only when the segment invokes a shell.

const SHELL_REMOVAL = ['bash', '-c', '"git', 'worktree', 'remove', '../other"'].join(' ');
const PROSE_REMOVAL = ['git', 'commit', '-m', '"drop the git', 'worktree', 'remove call"'].join(
  ' ',
);

test('a shell invocation carrying a quoted worktree removal is blocked', () => {
  assert.match(String(bashCall(SHELL_REMOVAL, PRIMARY_ROOT)), /dev:worktree:reclaim/);
});

test('a commit message that only names the phrase is allowed', () => {
  assert.equal(bashCall(PROSE_REMOVAL, PRIMARY_ROOT), null);
});

test('an unquoted worktree removal is still blocked', () => {
  const command = ['git', 'worktree', 'remove', '../other'].join(' ');
  assert.match(String(bashCall(command, PRIMARY_ROOT)), /dev:worktree:reclaim/);
});
