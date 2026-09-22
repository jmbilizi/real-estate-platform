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

// Blanks quoted literals to a fixed placeholder. Used only where matching
// must ignore quoted prose (e.g. a commit message that mentions "git
// worktree remove"); never used where a flag's real path value is needed.
function blankQuotes(text) {
  return text.replace(/"[^"]*"|'[^']*'/g, '""');
}

// Splits a Bash command into segments on shell separators, but never on a
// separator that sits inside a quoted literal (a quoted commit message or
// echoed path). Segments keep their original text, quotes included, so a
// later flag lookup can recover the real path a quoted `-C`/`--git-dir`
// argument names. Boundaries are found on a length-preserving quote mask so
// segment offsets line up exactly with the original command.
function splitSegments(command) {
  const masked = command.replace(/"[^"]*"|'[^']*'/g, (m) => '"'.repeat(m.length));
  const segments = [];
  const separators = /&&|\|\||;|\|/g;
  let lastIndex = 0;
  let match = separators.exec(masked);
  while (match) {
    segments.push(command.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    match = separators.exec(masked);
  }
  segments.push(command.slice(lastIndex));
  return segments;
}

// Strips one layer of matching surrounding quotes from a recovered flag value.
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// Recovers the flag's value from the segment's own (unblanked) tokens, so a
// quoted path is read intact rather than through the quote-blanked copy
// `splitSegments` uses only to find segment boundaries.
function resolveFlagPath(tokens, index) {
  const token = tokens[index];
  const eq = token.indexOf('=');
  if (eq !== -1) return stripQuotes(token.slice(eq + 1));
  const next = tokens[index + 1];
  return next === undefined ? undefined : stripQuotes(next);
}

// Rule C: `git -C/--git-dir/--work-tree <path>` must not target a tree
// outside this lane or inside a foreign worktree. `cwd` is the lane's own
// working directory (not this hook process's cwd), needed to resolve a
// relative flag path such as `-C .`.
function checkGitTargetFlags(segment, laneRoot, cwd) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] !== 'git') return null;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    const isDashC = token === '-C';
    const isGitDir = token === '--git-dir' || token.startsWith('--git-dir=');
    const isWorkTree = token === '--work-tree' || token.startsWith('--work-tree=');
    if (!isDashC && !isGitDir && !isWorkTree) continue;

    const flagPath = resolveFlagPath(tokens, i);
    if (!flagPath) continue;

    const resolvedFlagPath = path.isAbsolute(flagPath)
      ? flagPath
      : path.resolve(cwd || laneRoot, flagPath);

    const worktreeRoot = findWorktreeRoot(resolvedFlagPath);
    if (worktreeRoot && normalize(worktreeRoot) !== normalize(laneRoot)) {
      return (
        `Blocked: "git ${token} ${flagPath}" targets another lane's worktree.\n` +
        `Run git commands only against your own lane root (${laneRoot}).`
      );
    }
    if (!isInside(resolvedFlagPath, laneRoot)) {
      return (
        `Blocked: "git ${token} ${flagPath}" targets a tree outside this lane's root (${laneRoot}).\n` +
        `Run git commands only against your own lane root.`
      );
    }
  }

  return null;
}

// Rule D: worktree administration must go through the reclaim script, not
// git directly. LANE_BOUNDARY_ALLOW_WORKTREE_ADMIN=1 is a deliberate
// session-level override for a human or agent that must run the command
// directly. The reclaim script itself never needs it: this hook only sees
// agent tool calls, never the git child processes the script spawns.
function checkWorktreeAdmin(segment, env) {
  const blanked = blankQuotes(segment);
  if (!/\bgit\s+worktree\s+(remove|move|prune)\b/.test(blanked)) return null;
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
function evaluate({ toolName, toolInput, laneRoot, env, cwd }) {
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
      const flagReason = checkGitTargetFlags(segment, laneRoot, cwd);
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
        cwd: payload?.cwd,
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
