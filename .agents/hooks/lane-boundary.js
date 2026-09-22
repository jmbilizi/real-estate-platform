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
 *
 * What this hook enforces, exactly: the Edit/Write/NotebookEdit/MultiEdit
 * tool family (Rules A and B), and a fixed set of `git` invocations run
 * through the Bash tool (Rules C and D). It does NOT intercept file writes
 * a Bash command performs by other means — `echo x > path`, `cp`, `mv`,
 * `sed -i`, `rm -rf`, and similar all pass unchecked today. Closing that
 * gap needs real shell semantics this hook does not have. Both gaps are
 * tracked in #307 and are not solved here.
 *
 * Accepted limitation: Rule C finds a `git` token anywhere in a segment's
 * token list (see `checkGitTargetFlags`), so `pnpm exec git -C <path> ...`
 * and `env X=1 git -C <path> ...` are caught. A command that reaches `git`
 * only through shell control flow the tokenizer does not evaluate — for
 * example `cd ../other && git status`, where the second segment's `git` has
 * no `-C`/`--git-dir` flag to inspect at all — is out of reach without full
 * shell semantics and is not solved here.
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

// Rules A and B for one Edit/Write-family target path. `cwd` is the lane's
// own working directory (payload cwd, not this hook process's cwd), needed
// to resolve a relative `file_path` the same way `checkGitTargetFlags`
// already resolves a relative flag path.
function checkWriteTarget(targetPath, laneRoot, cwd) {
  const resolvedTarget = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(cwd || laneRoot, targetPath);

  if (isAllowlisted(resolvedTarget)) return null;

  // Rule B: a foreign worktree is blocked even when it sits inside the lane
  // root, which is the case when the lane root is the primary checkout.
  const worktreeRoot = findWorktreeRoot(resolvedTarget);
  if (worktreeRoot && normalize(worktreeRoot) !== normalize(laneRoot)) {
    return (
      `Blocked: "${targetPath}" is inside another lane's worktree (${worktreeRoot}).\n` +
      `Write only inside your own lane root (${laneRoot}).`
    );
  }

  // Rule A: the target must be inside this lane's own root.
  if (!isInside(resolvedTarget, laneRoot)) {
    return (
      `Blocked: "${targetPath}" is outside this lane's root (${laneRoot}).\n` +
      `Write only inside your own worktree, the OS temp directory, or ~/.claude.`
    );
  }

  return null;
}

// Walks a string once, tracking the currently open quote character (never
// regex pair matching, so nesting inside `bash -c "..."` cannot break it).
// A run of characters inside matching `"` or `'` stays in the same token
// and is never split on whitespace. Returns tokens as `{ raw, value }`:
// `raw` is the token's exact source text (quotes included), `value` is the
// same token with one layer of surrounding quote characters removed.
function tokenize(segment) {
  const tokens = [];
  let raw = '';
  let value = '';
  let quote = null;
  let started = false;

  const flush = () => {
    if (started) tokens.push({ raw, value });
    raw = '';
    value = '';
    started = false;
  };

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];

    if (quote) {
      raw += ch;
      if (ch === quote) {
        quote = null;
      } else {
        value += ch;
      }
      started = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      raw += ch;
      started = true;
      continue;
    }

    if (/\s/.test(ch)) {
      flush();
      continue;
    }

    raw += ch;
    value += ch;
    started = true;
  }
  flush();

  return tokens;
}

// Splits a Bash command into segments on shell separators — `&&`, `||`,
// `;`, `|`, and a newline (a multi-line script is one segment otherwise,
// so a later command on its own line skips every check below it) — but
// never on a separator that sits inside a quoted literal. Tracks the open
// quote character directly, the same walk `tokenize` uses, so segment
// boundaries and quoting agree by construction rather than by keeping two
// separate quote-handling passes in sync.
function splitSegments(command) {
  const segments = [];
  let quote = null;
  let start = 0;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }

    if (ch === '\n') {
      segments.push(command.slice(start, i));
      i += 1;
      start = i;
      continue;
    }

    if ((ch === '&' && command[i + 1] === '&') || (ch === '|' && command[i + 1] === '|')) {
      segments.push(command.slice(start, i));
      i += 2;
      start = i;
      continue;
    }

    if (ch === ';' || ch === '|') {
      segments.push(command.slice(start, i));
      i += 1;
      start = i;
      continue;
    }

    i += 1;
  }
  segments.push(command.slice(start));

  return segments;
}

// Recovers a flag's value from the token that follows it, or from the
// `--flag=value` form. Tokens already carry their quotes stripped, so a
// quoted path (`-C "../other"`) reads intact as one token either way.
function resolveFlagPath(tokens, index) {
  const token = tokens[index].value;
  const eq = token.indexOf('=');
  if (eq !== -1) return token.slice(eq + 1);
  const next = tokens[index + 1];
  return next === undefined ? undefined : next.value;
}

// Rule C: `git -C/--git-dir/--work-tree <path>` must not target a tree
// outside this lane or inside a foreign worktree. `cwd` is the lane's own
// working directory (not this hook process's cwd), needed to resolve a
// relative flag path such as `-C .`. The `git` token can appear anywhere in
// the segment, not only as the first token, so `pnpm exec git -C ... ` and
// `env X=1 git -C ...` are inspected too (see the file header for the
// `cd ... && git ...` case this does not cover).
function checkGitTargetFlags(segment, laneRoot, cwd) {
  const tokens = tokenize(segment);
  const gitIndex = tokens.findIndex((t) => t.value === 'git');
  if (gitIndex === -1) return null;

  for (let i = gitIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i].value;
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
//
// The phrase is matched outside quotes always, and inside quotes only when
// the segment invokes a shell. A shell runs its quoted argument as a command,
// so `bash -c "git worktree remove ../x"` is a real invocation. Every other
// program treats a quoted argument as data, so `git commit -m "..."` and
// `node -e "..."` that merely name the phrase are prose and stay allowed.
// Matching all quoted text would block those, and a rule that blocks ordinary
// commands gets switched off, which leaves nothing enforced.
const SHELL_COMMANDS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh']);
const WORKTREE_ADMIN = /\bgit\s+worktree\s+(remove|move|prune)\b/;

function invokesShell(tokens) {
  return tokens.some((token) => SHELL_COMMANDS.has(path.basename(token.value).toLowerCase()));
}

function isQuoted(token) {
  const first = token.raw[0];
  return first === '"' || first === "'";
}

function checkWorktreeAdmin(segment, env) {
  const tokens = tokenize(segment);
  const searched = invokesShell(tokens)
    ? segment
    : tokens
        .filter((token) => !isQuoted(token))
        .map((token) => token.value)
        .join(' ');
  if (!WORKTREE_ADMIN.test(searched)) return null;
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
    return checkWriteTarget(targetPath, laneRoot, cwd);
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

module.exports = { evaluate, resolveLaneRoot, tokenize, splitSegments };
