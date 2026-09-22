#!/usr/bin/env node
/**
 * PreToolUse hook (Edit|Write|NotebookEdit|MultiEdit and Bash): enforces
 * ticket #235 AC1 and AC5 — a parallel agent lane must not write outside
 * its own git worktree, and must not branch-switch or administer another
 * lane's worktree.
 *
 * The lane root comes from two sources, and the narrower one wins.
 *
 * First source: this script's own directory, two levels up. Claude Code
 * invokes a hook as `$CLAUDE_PROJECT_DIR/.agents/hooks/<file>.js`, so when
 * `CLAUDE_PROJECT_DIR` is the worktree, the worktree's own copy of this file
 * runs and `__dirname` resolves to that lane's root.
 *
 * Second source: the worktree that contains the payload's `cwd`. This covers
 * the case where `CLAUDE_PROJECT_DIR` stays on the primary checkout while the
 * lane works in a worktree. Without it the boundary would resolve to the
 * primary checkout and allow every write it exists to block, which is the
 * silent failure this ticket is about. The second source only ever narrows
 * the root, so it cannot weaken the boundary.
 *
 * Exit 0 = allow, exit 2 = block (stderr is shown to the agent). If the
 * lane root cannot be resolved, or stdin is not valid JSON for a tool this
 * hook checks, the hook writes one warning line to stderr and exits 0. This
 * is a guardrail, not a security boundary.
 */
const path = require('path');
const os = require('os');

const WORKTREE_SEGMENT = new RegExp(
  `\\${path.sep}\\.claude\\${path.sep}worktrees\\${path.sep}([^\\${path.sep}]+)`,
  'i',
);

function normalize(targetPath) {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(childPath, parentPath) {
  const child = normalize(childPath);
  const parent = normalize(parentPath);
  return child === parent || child.startsWith(parent + path.sep);
}

// Finds the worktree root a path sits under, e.g. `<repo>/.claude/worktrees/foo/bar.js`
// returns `<repo>/.claude/worktrees/foo`. Returns null when the path names no worktree.
function findWorktreeRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  const match = WORKTREE_SEGMENT.exec(resolved);
  if (!match) return null;
  return resolved.slice(0, match.index + match[0].length);
}

function isAllowlisted(targetPath) {
  const allowlist = [os.tmpdir(), path.join(os.homedir(), '.claude')];
  return allowlist.some((dir) => isInside(targetPath, dir));
}

// Rules A and B for one Edit/Write-family target path.
function checkWriteTarget(targetPath, laneRoot) {
  if (isAllowlisted(targetPath)) return null;

  // Rule B: a foreign worktree is blocked even when it sits inside the lane
  // root, which is the case when the lane root is the primary checkout.
  const worktreeRoot = findWorktreeRoot(targetPath);
  if (worktreeRoot && normalize(worktreeRoot) !== normalize(laneRoot)) {
    return (
      `Blocked: "${targetPath}" is inside another lane's worktree (${worktreeRoot}).\n` +
      `Write only inside your own lane root (${laneRoot}).`
    );
  }

  // Rule A: the target must be inside this lane's own root.
  if (!isInside(targetPath, laneRoot)) {
    return (
      `Blocked: "${targetPath}" is outside this lane's root (${laneRoot}).\n` +
      `Write only inside your own worktree, the OS temp directory, or ~/.claude.`
    );
  }

  return null;
}

// Splits a Bash command into segments the same way enforce-pnpm-wrappers.js
// does: strip quoted literals first, then split on shell separators, so a
// quoted commit message or echoed path never false-positives as a real flag.
function splitSegments(command) {
  const stripped = command.replace(/"[^"]*"|'[^']*'/g, '""');
  return stripped.split(/&&|\|\||;|\|/);
}

function resolveFlagPath(tokens, index) {
  const token = tokens[index];
  const eq = token.indexOf('=');
  if (eq !== -1) return token.slice(eq + 1);
  return tokens[index + 1];
}

// Rule C: `git -C/--git-dir/--work-tree <path>` must not target a tree
// outside this lane or inside a foreign worktree.
function checkGitTargetFlags(segment, laneRoot) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] !== 'git') return null;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const isDashC = token === '-C';
    const isGitDir = token === '--git-dir' || token.startsWith('--git-dir=');
    const isWorkTree = token === '--work-tree' || token.startsWith('--work-tree=');
    if (!isDashC && !isGitDir && !isWorkTree) continue;

    const flagPath = resolveFlagPath(tokens, i);
    if (!flagPath || flagPath === '""') continue;

    const worktreeRoot = findWorktreeRoot(flagPath);
    if (worktreeRoot && normalize(worktreeRoot) !== normalize(laneRoot)) {
      return (
        `Blocked: "git ${token} ${flagPath}" targets another lane's worktree.\n` +
        `Run git commands only against your own lane root (${laneRoot}).`
      );
    }
    if (!isInside(flagPath, laneRoot)) {
      return (
        `Blocked: "git ${token} ${flagPath}" targets a tree outside this lane's root (${laneRoot}).\n` +
        `Run git commands only against your own lane root.`
      );
    }
  }

  return null;
}

// Rule D: worktree administration must go through the reclaim script, which
// sets LANE_BOUNDARY_ALLOW_WORKTREE_ADMIN=1 for its own calls.
function checkWorktreeAdmin(segment, env) {
  if (!/^\s*git\s+worktree\s+(remove|move|prune)\b/.test(segment)) return null;
  if (env.LANE_BOUNDARY_ALLOW_WORKTREE_ADMIN === '1') return null;
  return (
    `Blocked: "${segment.trim()}" administers a worktree directly.\n` +
    `Use "pnpm run dev:worktree:reclaim" instead.`
  );
}

/**
 * Pick the lane root. A worktree containing `cwd` wins over the script's own
 * root, because it is always the narrower of the two.
 */
function resolveLaneRoot(scriptRoot, cwd) {
  if (!cwd) return scriptRoot;
  const cwdWorktree = findWorktreeRoot(cwd);
  return cwdWorktree || scriptRoot;
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

/**
 * Decides whether one tool call is allowed. Returns null to allow, or a
 * block reason string.
 */
function evaluate({ toolName, toolInput, laneRoot, env }) {
  if (!laneRoot || !toolName) return null;
  const safeEnv = env || {};
  const input = toolInput || {};

  if (WRITE_TOOLS.has(toolName)) {
    const targetPath = input.file_path || input.notebook_path;
    if (!targetPath) return null;
    return checkWriteTarget(targetPath, laneRoot);
  }

  if (toolName === 'Bash') {
    const command = input.command;
    if (!command) return null;
    for (const segment of splitSegments(command)) {
      const adminReason = checkWorktreeAdmin(segment, safeEnv);
      if (adminReason) return adminReason;
      const flagReason = checkGitTargetFlags(segment, laneRoot);
      if (flagReason) return flagReason;
    }
    return null;
  }

  return null;
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(input);
      const laneRoot = resolveLaneRoot(path.resolve(__dirname, '..', '..'), payload?.cwd);
      const reason = evaluate({
        toolName: payload?.tool_name,
        toolInput: payload?.tool_input,
        laneRoot,
        env: process.env,
      });
      if (reason) {
        process.stderr.write(`${reason}\n`);
        process.exit(2);
      }
      process.exit(0);
    } catch (error) {
      process.stderr.write(`lane-boundary: allowing on error: ${error.message}\n`);
      process.exit(0);
    }
  });
}

module.exports = { evaluate, resolveLaneRoot };
