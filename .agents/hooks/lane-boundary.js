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
 * tool family (Rules A and B), a fixed set of `git` invocations run through
 * the Bash tool (Rules C and D), and these shell forms (Rules E and F, #307):
 *   - Rule E: a literal `cd`/`pushd` into another lane's worktree, from a
 *     lane that is itself a worktree. The simulated working directory then
 *     carries into the later segments of the same command.
 *   - Rule F: a redirect (`>`, `>>`, `&>`, `2>`), `tee`, a `cp`/`mv`/
 *     `install`/`ln` operand, or an `rm`/`rmdir`/`touch`/`mkdir`/`truncate`/
 *     `sed -i` operand aimed at another lane's worktree. A redirect, `tee`,
 *     `cp`, `mv`, `install` or `ln` destination outside the lane root is
 *     blocked too, unless it is the OS temp dir, `~/.claude`, or a device
 *     such as /dev/null.
 * It does NOT see a path the shell expands at run time (`$VAR`, `~`, globs,
 * command substitution), a write that a program computes itself, or a `cd`
 * in a subshell. Those pass unchecked on purpose: a guess would refuse safe
 * commands, and a guard that does so gets switched off. Quoted text is never
 * read as a command, so prose that names a path stays allowed.
 *
 * Rule C finds a `git` token anywhere in a segment's token list (see
 * `checkGitTargetFlags`), so `pnpm exec git -C <path> ...` and
 * `env X=1 git -C <path> ...` are caught. `cd ../other && git status` is
 * caught by Rule E at the `cd`.
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

// ---- Rules E and F: shell working directory and shell file writes (#307) ----

const SAFE_DEVICE = /^(\/dev\/|\/proc\/|nul$)/i;
const UNRESOLVABLE = /[$`*?~(){}<>!]/;

// Git Bash passes `/c/Src/x`. Node on win32 reads that as a path on the
// current drive, so convert it first.
function toNativePath(value) {
  if (process.platform !== 'win32') return value;
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(value);
  return m ? `${m[1].toUpperCase()}:${m[2] || '/'}` : value;
}

// Returns an absolute path. Returns null when the shell expands the value at
// run time (the hook cannot know the result) or the value is a device.
function resolveShellPath(value, cwd, laneRoot) {
  if (!value || UNRESOLVABLE.test(value) || SAFE_DEVICE.test(value)) return null;
  const native = toNativePath(value);
  return path.isAbsolute(native) ? path.resolve(native) : path.resolve(cwd || laneRoot, native);
}

function foreignWorktree(resolved, laneRoot) {
  const root = findWorktreeRoot(resolved);
  return root && normalize(root) !== normalize(laneRoot) ? root : null;
}

function commandWord(tokens) {
  let i = 0;
  while (
    i < tokens.length &&
    !isQuoted(tokens[i]) &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].value)
  ) {
    i += 1;
  }
  if (i >= tokens.length) return { name: null, args: [] };
  const name = path
    .basename(tokens[i].value)
    .toLowerCase()
    .replace(/\.exe$/, '');
  return { name, args: tokens.slice(i + 1) };
}

// Rule E. Returns { reason, cwd }: `cwd` is the simulated directory for the
// segments that follow. A lane whose root holds no worktree segment is the
// primary orchestrator. It may enter any worktree.
function checkDirectoryChange(tokens, laneRoot, cwd) {
  const { name, args } = commandWord(tokens);
  if (name !== 'cd' && name !== 'pushd') return { reason: null, cwd };
  const operands = args.filter((t) => !t.value.startsWith('-'));
  if (operands.length !== 1) return { reason: null, cwd };
  const target = resolveShellPath(operands[0].value, cwd, laneRoot);
  if (!target) return { reason: null, cwd };
  const foreign = findWorktreeRoot(laneRoot) ? foreignWorktree(target, laneRoot) : null;
  if (foreign) {
    return {
      reason:
        `Blocked: "${name} ${operands[0].value}" enters another lane's worktree (${foreign}).\n` +
        `Stay inside your own lane root (${laneRoot}).`,
      cwd,
    };
  }
  return { reason: null, cwd: target };
}

function checkShellTarget(value, laneRoot, cwd, requireInside) {
  const target = resolveShellPath(value, cwd, laneRoot);
  if (!target) return null;
  const foreign = foreignWorktree(target, laneRoot);
  if (foreign) {
    return (
      `Blocked: shell write to "${value}" is inside another lane's worktree (${foreign}).\n` +
      `Write only inside your own lane root (${laneRoot}).`
    );
  }
  if (requireInside && !isAllowlisted(target) && !isInside(target, laneRoot)) {
    return (
      `Blocked: shell write to "${value}" is outside this lane's root (${laneRoot}).\n` +
      `Write only inside your own worktree, the OS temp directory, or ~/.claude.`
    );
  }
  return null;
}

const FOREIGN_ONLY = new Set(['rm', 'rmdir', 'touch', 'mkdir', 'truncate']);
const COPY_LIKE = new Set(['cp', 'mv', 'install', 'ln']);

function positionals(args) {
  return args.filter((t) => isQuoted(t) || !t.value.startsWith('-')).map((t) => t.value);
}

// Rule F. Redirect operators are read only from unquoted tokens, so prose in
// a quoted argument never counts.
function checkShellWrites(tokens, laneRoot, cwd) {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (isQuoted(token) || !token.raw.includes('>')) continue;
    const m = /^(?:[^"'>]*?[^-=\s"'>])?(?:&|\d)?>>?\|?(?![&(])(.*)$/.exec(token.raw);
    if (!m) continue;
    const operand = m[1] ? m[1].replace(/^["']|["']$/g, '') : tokens[i + 1] && tokens[i + 1].value;
    const reason = checkShellTarget(operand, laneRoot, cwd, true);
    if (reason) return reason;
  }

  const { name, args } = commandWord(tokens);
  if (!name) return null;
  const files = positionals(args);

  if (name === 'tee') {
    for (const file of files) {
      const reason = checkShellTarget(file, laneRoot, cwd, true);
      if (reason) return reason;
    }
  } else if (COPY_LIKE.has(name)) {
    const hasTargetDirFlag = args.some((t) => /^(-t|--target-directory)/.test(t.value));
    for (let i = 0; i < files.length; i += 1) {
      const isDest = !hasTargetDirFlag && i === files.length - 1;
      // Only `mv` changes its sources. `cp`, `install` and `ln` only read them.
      if (!isDest && name !== 'mv') continue;
      const reason = checkShellTarget(files[i], laneRoot, cwd, isDest);
      if (reason) return reason;
    }
  } else if (
    FOREIGN_ONLY.has(name) ||
    (name === 'sed' && args.some((t) => /^(-i|--in-place)/.test(t.value)))
  ) {
    for (const file of files) {
      const reason = checkShellTarget(file, laneRoot, cwd, false);
      if (reason) return reason;
    }
  }
  return null;
}

// Drops heredoc bodies so the text of a `cat <<EOF` block is never read as commands.
function stripHeredocs(command) {
  const out = [];
  let end = null;
  for (const line of command.split('\n')) {
    if (end !== null) {
      if (line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    const m = /<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(line);
    if (m) end = m[1] || m[2] || m[3];
  }
  return out.join('\n');
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
    let simulatedCwd = cwd;
    for (const segment of splitSegments(stripHeredocs(command))) {
      const adminReason = checkWorktreeAdmin(segment, safeEnv);
      if (adminReason) return adminReason;
      const flagReason = checkGitTargetFlags(segment, laneRoot, simulatedCwd);
      if (flagReason) return flagReason;
      const tokens = tokenize(segment);
      const change = checkDirectoryChange(tokens, laneRoot, simulatedCwd);
      if (change.reason) return change.reason;
      simulatedCwd = change.cwd;
      const writeReason = checkShellWrites(tokens, laneRoot, simulatedCwd);
      if (writeReason) return writeReason;
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
