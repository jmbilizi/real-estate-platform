'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const { evaluate, resolveLaneRoot } = require('./lane-boundary');

// Primary checkout stands in for the repo's own working tree; the worktree
// path stands in for a sibling lane created under `.claude/worktrees/`.
const PRIMARY_ROOT = path.join('C:', 'Src', 'real-estate-platform');
const WORKTREE_ROOT = path.join(PRIMARY_ROOT, '.claude', 'worktrees', 'mine');
const OTHER_WORKTREE_ROOT = path.join(PRIMARY_ROOT, '.claude', 'worktrees', 'other');

function editCall(filePath, laneRoot) {
  return evaluate({
    toolName: 'Edit',
    toolInput: { file_path: filePath },
    laneRoot,
    env: {},
  });
}

function bashCall(command, laneRoot, env) {
  return evaluate({
    toolName: 'Bash',
    toolInput: { command },
    laneRoot,
    env: env || {},
  });
}

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
  const outside = path.join('C:', 'Src', 'other-repo');
  const reason = bashCall(`git -C ${outside} checkout dev`, PRIMARY_ROOT);
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
