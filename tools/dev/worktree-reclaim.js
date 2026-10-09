#!/usr/bin/env node

/**
 * Reclaim stale agent git worktrees safely.
 *
 * Parses `git worktree list --porcelain`, classifies every worktree but the primary one, and
 * removes only the ones proven safe and stale. A dirty worktree or a worktree with unpushed
 * commits is never removed, under any flag. See ticket #235 AC3.
 *
 * CRITICAL SAFETY RULE: a probe that fails (git exits non-zero, the runner throws, or a stat call
 * throws for a reason other than ENOENT) must never read as "clean" or "absent". It classifies as
 * `unknown` and the worktree is skipped. This repo has a recorded regression of exactly that shape
 * (AGENTS.md: "A failed probe must never read as absent"). An inaccessible path (permission denied,
 * a detached volume, EBUSY) is exactly this case: it is not proof the worktree is gone, so it
 * classifies `unknown`, never `orphaned`.
 *
 * A worktree only becomes a removal candidate once it is proven clean, pushed, AND idle longer
 * than the reclaim window. One exception: a branch merged into origin/dev, or whose PR is merged
 * or closed at the same commit, skips the window. The local branch of a merged worktree is deleted
 * with it. A running lane that is clean and pushed but still active is classified
 * `active` and left alone.
 *
 * `.agents/hooks/lane-boundary.js` blocks a direct `git worktree remove|move|prune` and names this
 * script instead. The hook inspects agent tool calls only, so it never sees the git processes this
 * script spawns. This script needs no exemption flag.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_OLDER_THAN_MS = 24 * 60 * 60 * 1000;

// Base branches are always an ancestor of origin/dev. Never treat them as merged work.
const PROTECTED_BRANCHES = new Set(['dev', 'test', 'main']);

/**
 * Parse `git worktree list --porcelain` output into one record per worktree.
 *
 * Records are separated by a blank line. Each line is either `key value` or a bare flag
 * (`bare`, `detached`, `locked`, `locked <reason>`, `prunable`, `prunable <reason>`).
 *
 * @param {string} text
 * @returns {Array<{
 *   path: string,
 *   head: string|null,
 *   branch: string|null,
 *   bare: boolean,
 *   detached: boolean,
 *   locked: boolean,
 *   lockedReason: string|null,
 *   prunable: boolean,
 *   prunableReason: string|null,
 * }>}
 */
function parsePorcelain(text) {
  const records = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      if (current) {
        records.push(current);
        current = null;
      }
      continue;
    }

    const spaceIndex = line.indexOf(' ');
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? '' : line.slice(spaceIndex + 1);

    if (key === 'worktree') {
      current = {
        path: value,
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        lockedReason: null,
        prunable: false,
        prunableReason: null,
      };
      continue;
    }

    // A line before the first `worktree` line cannot belong to a record. Skip it defensively.
    if (!current) continue;

    if (key === 'HEAD') {
      current.head = value;
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '');
    } else if (key === 'bare') {
      current.bare = true;
    } else if (key === 'detached') {
      current.detached = true;
    } else if (key === 'locked') {
      current.locked = true;
      current.lockedReason = value || null;
    } else if (key === 'prunable') {
      current.prunable = true;
      current.prunableReason = value || null;
    }
  }

  if (current) records.push(current);
  return records;
}

/** Run `git` for real. Replaced by an injected runner in tests. */
function defaultRun(args, opts = {}) {
  return spawnSync('git', args, { encoding: 'utf-8', ...opts });
}

/**
 * Report whether `child` is `parent` itself or a path nested inside it.
 *
 * Both paths are resolved first. On win32, both are lowercased too, because
 * `git worktree list --porcelain` reports the path as git stored it (for example `C:/Src/...`)
 * while `process.cwd()` can return a different case (for example `c:\src\...`) even though both
 * name the same directory. Plain equality misses a cwd that is a subdirectory of the worktree, for
 * example `<worktree>\apps\web` — that case must still count as "inside".
 */
function isInside(child, parent) {
  let resolvedChild = path.resolve(child);
  let resolvedParent = path.resolve(parent);
  if (process.platform === 'win32') {
    resolvedChild = resolvedChild.toLowerCase();
    resolvedParent = resolvedParent.toLowerCase();
  }
  return resolvedChild === resolvedParent || resolvedChild.startsWith(resolvedParent + path.sep);
}

/**
 * Check whether a path exists for real, using `fs.statSync`.
 *
 * Returns `false` only for `ENOENT` (the path is genuinely absent). Any other error (permission
 * denied, a detached volume, EBUSY) is rethrown so the caller classifies the worktree `unknown`
 * instead of `orphaned` — see the CRITICAL SAFETY RULE above.
 */
function defaultPathExists(targetPath) {
  try {
    fs.statSync(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Stat a file for real. Replaced by an injected stub in tests. */
function defaultStatFile(targetPath) {
  return fs.statSync(targetPath);
}

/** The current time, in milliseconds. Replaced by an injected clock in tests. */
function defaultNow() {
  return Date.now();
}

/**
 * A probe fails when the runner threw, or git exited non-zero, or no exit code came back at all
 * (for example the process was killed by a signal). Every one of those counts as "cannot answer",
 * never as "answered clean".
 */
function probeFailed(result) {
  if (!result) return true;
  if (result.error) return true;
  return typeof result.status !== 'number' || result.status !== 0;
}

/** Read stderr, or the runner's own error message, as one trimmed string. */
function describeFailure(result) {
  const text = (result && (result.stderr || (result.error && result.error.message))) || '';
  return String(text).trim();
}

/**
 * Measure how long ago a worktree's own git index last changed, as a proxy for "last touched by
 * an agent". The index lives under the worktree's private git directory (not `.git` in the
 * worktree itself), so it is fetched with `rev-parse --absolute-git-dir` first.
 *
 * Returns `{ idleMs }` on success, or `{ error }` when any step cannot be trusted. The caller must
 * treat `error` as "unknown", never as "stale" or "active".
 */
function measureIdleMs(record, { run, statFile, now }) {
  const gitDirResult = run(['-C', record.path, 'rev-parse', '--absolute-git-dir'], {
    encoding: 'utf-8',
  });
  if (probeFailed(gitDirResult)) {
    return {
      error: `the git-dir probe failed, so this worktree is skipped: ${describeFailure(gitDirResult)}`,
    };
  }

  const adminDir = (gitDirResult.stdout || '').trim();
  if (!adminDir) {
    return { error: 'the git-dir probe returned no path, so this worktree is skipped' };
  }

  let stat;
  try {
    stat = statFile(path.join(adminDir, 'index'));
  } catch (error) {
    return {
      error: `the index stat failed, so this worktree is skipped: ${error && error.message}`,
    };
  }

  return { idleMs: now() - stat.mtimeMs };
}

/** Read the process id out of a git lock reason, for example "... (pid 37512)". Null when absent. */
function readLockOwnerPid(lockedReason) {
  const match = /\bpid\s+(\d+)\b/i.exec(lockedReason || '');
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Report whether a process id is still running.
 *
 * `process.kill(pid, 0)` sends no signal and only tests reachability. An `EPERM` means the process
 * exists but belongs to another user, which still counts as alive. Any other failure counts as
 * alive too, because a probe that cannot answer must never read as "safe to delete".
 */
function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

/**
 * Build the classification for an orphaned worktree whose lock git still holds.
 *
 * `git worktree prune` skips a locked worktree even when its path is gone, so reporting plain
 * `orphaned` here would claim a prune that never happens. `orphaned-locked` keeps that claim
 * honest and tells the reader to unlock the worktree before it can ever be reclaimed.
 */
function orphanedLocked(record, orphanReason) {
  return {
    classification: 'orphaned-locked',
    reason: `${orphanReason}; locked (${record.lockedReason || 'no reason given'}). Unlock it first, then rerun.`,
  };
}

const DEFAULT_ORPHAN_OLDER_THAN_MS = 60 * 60 * 1000;

/** The folder that holds agent worktrees, derived from the primary worktree path. */
function worktreesRoot(primaryPath) {
  return path.join(primaryPath, '.claude', 'worktrees');
}

/** Prefix a Windows absolute path so deep node_modules trees delete past MAX_PATH. */
function longPath(target) {
  const resolved = path.resolve(target);
  if (process.platform !== 'win32' || resolved.startsWith('\\\\?\\')) return resolved;
  return '\\\\?\\' + resolved;
}

/**
 * Delete a folder tree. Refuses any path that is not strictly inside `root`, so a wrong input
 * can never delete outside `.claude/worktrees/`. Returns `{ removed, error? }`.
 */
function defaultRemoveDir(target, root) {
  if (!root || !isInside(target, root) || isInside(root, target)) {
    return { removed: false, error: 'the path is outside the worktrees folder' };
  }
  try {
    fs.rmSync(longPath(target), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return { removed: !fs.existsSync(target) };
  } catch (error) {
    return { removed: false, error: error && error.message };
  }
}

/** Report whether a `.git` file points to a gitdir that exists. */
function gitFileTargetExists(dir) {
  const gitPath = path.join(dir, '.git');
  let stat;
  try {
    stat = fs.statSync(gitPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    return true; // an unreadable probe never reads as "missing"
  }
  if (stat.isDirectory()) return true; // a real clone, not residue
  try {
    const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitPath, 'utf-8'));
    if (!match) return true;
    return fs.existsSync(path.resolve(dir, match[1].trim()));
  } catch {
    return true;
  }
}

/**
 * Find folders under the worktrees root that git does not register and that hold no live
 * worktree: no `.git`, or a `.git` file that points at a missing gitdir. Each must also be idle
 * longer than the orphan window. Delete them when `apply` is set.
 */
function sweepOrphans({ root, registered, apply, now, olderThanMs, removeDir, listDir, statDir }) {
  const results = [];
  let names;
  try {
    names = listDir(root);
  } catch {
    return results;
  }
  const known = new Set(
    registered.map((p) => (process.platform === 'win32' ? p.toLowerCase() : p)),
  );
  for (const name of names) {
    const dir = path.join(root, name);
    const key = process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir);
    if ([...known].some((p) => path.resolve(p) === key || path.resolve(p).toLowerCase() === key)) {
      continue;
    }
    let stat;
    try {
      stat = statDir(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (gitFileTargetExists(dir)) continue;
    if (now() - stat.mtimeMs < olderThanMs) {
      results.push({ path: dir, action: 'kept-recent' });
      continue;
    }
    if (!apply) {
      results.push({ path: dir, action: 'orphan' });
      continue;
    }
    const outcome = removeDir(dir, root);
    results.push(
      outcome.removed
        ? { path: dir, action: 'orphan-removed' }
        : { path: dir, action: 'orphan-failed', error: outcome.error || 'the folder remains' },
    );
  }
  return results;
}

/**
 * Read open, merged, and closed pull requests in one `gh` call. Returns `null` on any failure,
 * which means "no PR evidence": the caller then relies on git ancestry alone and removes less.
 *
 * @returns {Array<{headRefName: string, headRefOid: string, state: string}>|null}
 */
function defaultLoadPullRequests() {
  const result = spawnSync(
    'gh',
    ['pr', 'list', '--state', 'all', '--limit', '500', '--json', 'headRefName,headRefOid,state'],
    { encoding: 'utf-8', timeout: 20_000 },
  );
  if (probeFailed(result)) return null;
  try {
    const parsed = JSON.parse(result.stdout || '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Judge a pull request outcome for a worktree branch. A PR counts only when its head commit is
 * the worktree's current commit, so later local commits are never hidden. Any open PR on the
 * branch name blocks the result.
 *
 * @returns {{ terminal: boolean, merged: boolean, open: boolean }}
 */
function judgePullRequests(record, pullRequests) {
  const none = { terminal: false, merged: false, open: false };
  if (!pullRequests || !record.branch || !record.head) return none;
  const forBranch = pullRequests.filter((pr) => pr.headRefName === record.branch);
  if (forBranch.some((pr) => pr.state === 'OPEN')) return { ...none, open: true };
  const same = forBranch.filter((pr) => pr.headRefOid === record.head);
  if (same.some((pr) => pr.state === 'MERGED')) return { ...none, terminal: true, merged: true };
  if (same.some((pr) => pr.state === 'CLOSED')) return { ...none, terminal: true };
  return none;
}

/**
 * Report whether a branch is merged into origin/dev by git ancestry.
 *
 * A new branch with no commit of its own is also an ancestor of origin/dev, and so is a new
 * branch that only pulled or rebased. The branch reflog tells them apart: only a branch that did
 * work has a `commit` entry. A failed probe answers false, so the worktree falls back to the
 * normal rules.
 */
function isBranchMergedByAncestry(record, run) {
  if (!record.branch || !record.head || PROTECTED_BRANCHES.has(record.branch)) return false;
  const ancestor = run(['merge-base', '--is-ancestor', record.head, 'origin/dev'], {
    encoding: 'utf-8',
  });
  if (probeFailed(ancestor)) return false;
  const reflog = run(['reflog', 'show', '--format=%gs', `refs/heads/${record.branch}`], {
    encoding: 'utf-8',
  });
  if (probeFailed(reflog)) return false;
  const entries = (reflog.stdout || '').split(/\r?\n/).filter((line) => line.trim() !== '');
  return entries.some((entry) => entry.startsWith('commit'));
}

/**
 * Classify one non-primary worktree.
 *
 * Order matters for safety:
 * 1. Orphaned (prunable, or the path is genuinely absent) is checked first — nothing else can be
 *    probed once the worktree is gone. A lock git still holds on an orphaned worktree classifies
 *    `orphaned-locked` instead, because `git worktree prune` skips a locked worktree, so nothing
 *    would actually be removed.
 * 2. Dirty and unpushed are checked next, so a worktree that is both locked and dirty (or locked
 *    and unpushed) is reported as `dirty` or `unpushed` — never as `locked`.
 * 3. Staleness is checked before locked, so a clean, pushed worktree still inside the reclaim
 *    window classifies `active` regardless of lock state, and is never a removal candidate.
 * 4. Only a clean, pushed, and stale worktree reaches the locked/reclaimable distinction.
 * 5. A lock whose reason names a live process classifies `running`, which no flag can remove.
 * 6. A branch merged into origin/dev, or whose PR is merged or closed at the same commit, skips
 *    the idle window. The dirty, unpushed, and lock checks still apply.
 *
 * @param {ReturnType<typeof parsePorcelain>[number]} record
 * @param {{ run: Function, pathExists?: Function, statFile?: Function, now?: Function, olderThanMs?: number, isProcessAlive?: Function }} options
 * @returns {{ classification: string, reason: string|null }}
 */
function classifyWorktree(record, options) {
  const run = options.run;
  const pathExists = options.pathExists || defaultPathExists;
  const statFile = options.statFile || defaultStatFile;
  const now = options.now || defaultNow;
  const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
  const olderThanMs =
    typeof options.olderThanMs === 'number' ? options.olderThanMs : DEFAULT_OLDER_THAN_MS;
  const pr = judgePullRequests(record, options.pullRequests);

  if (record.prunable) {
    if (record.locked) {
      return orphanedLocked(
        record,
        record.prunableReason || 'git reports this worktree as prunable',
      );
    }
    return {
      classification: 'orphaned',
      reason: record.prunableReason || 'git reports this worktree as prunable',
    };
  }

  let exists;
  try {
    exists = pathExists(record.path);
  } catch (error) {
    return {
      classification: 'unknown',
      reason: `the path probe failed, so this worktree is skipped: ${error && error.message}`,
    };
  }
  if (!exists) {
    if (record.locked) {
      return orphanedLocked(record, 'the worktree path no longer exists on disk');
    }
    return { classification: 'orphaned', reason: 'the worktree path no longer exists on disk' };
  }

  const statusResult = run(['-C', record.path, 'status', '--porcelain'], { encoding: 'utf-8' });
  if (probeFailed(statusResult)) {
    return {
      classification: 'unknown',
      reason: `the status probe failed, so this worktree is skipped: ${describeFailure(statusResult)}`,
    };
  }
  if ((statusResult.stdout || '').trim().length > 0) {
    return { classification: 'dirty', reason: 'the worktree has uncommitted changes' };
  }

  const ref = record.branch || record.head;
  if (!ref) {
    return {
      classification: 'unknown',
      reason: 'no branch or commit reference exists to check for unpushed work',
    };
  }

  const logResult = run(['-C', record.path, 'log', '--oneline', ref, '--not', '--remotes'], {
    encoding: 'utf-8',
  });
  if (probeFailed(logResult)) {
    return {
      classification: 'unknown',
      reason: `the unpushed-commit probe failed, so this worktree is skipped: ${describeFailure(logResult)}`,
    };
  }
  // A merged PR whose head is this exact commit proves GitHub holds the commits, even when the
  // remote branch is already deleted. A closed PR does not prove that.
  if ((logResult.stdout || '').trim().length > 0 && !pr.merged) {
    return { classification: 'unpushed', reason: 'the branch has commits that exist nowhere else' };
  }

  const merged = pr.merged || (!pr.open && isBranchMergedByAncestry(record, run));
  const settled = pr.terminal || merged;

  const idle = settled ? { idleMs: Infinity } : measureIdleMs(record, { run, statFile, now });
  if (idle.error) {
    return { classification: 'unknown', reason: idle.error };
  }
  if (idle.idleMs < olderThanMs) {
    const hoursAgo = Math.max(0, idle.idleMs / 3_600_000).toFixed(1);
    const windowHours = (olderThanMs / 3_600_000).toFixed(1);
    return {
      classification: 'active',
      reason: `the git index changed ${hoursAgo}h ago, inside the ${windowHours}h reclaim window`,
    };
  }

  if (record.locked) {
    // The agent harness locks a worktree it is using and writes the owning process id into the
    // lock reason, for example "claude agent agent-1234 (pid 37512)". A live process there means
    // a lane is running right now, so `--force` must not reach it. A lock naming a dead process
    // is the leftover this script exists to clear.
    const owner = readLockOwnerPid(record.lockedReason);
    if (owner !== null && isProcessAlive(owner)) {
      return {
        classification: 'running',
        reason: `a live agent holds this worktree (pid ${owner}): ${record.lockedReason}`,
      };
    }
    return {
      classification: 'locked',
      reason: record.lockedReason || 'git reports this worktree as locked',
    };
  }

  return {
    classification: 'reclaimable',
    reason: settled ? (merged ? 'the branch is merged' : 'the PR is closed') : null,
    settled,
    merged,
  };
}

function parseArgs(argv) {
  const result = {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
    mergedOnly: argv.includes('--merged-only'),
    quiet: argv.includes('--quiet'),
  };

  const orphanIndex = argv.indexOf('--orphan-older-than');
  if (orphanIndex !== -1) {
    const raw = argv[orphanIndex + 1];
    const hours = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(hours) || hours < 0) {
      throw new Error(`--orphan-older-than needs a non-negative number of hours. Got: ${raw}`);
    }
    result.orphanOlderThanHours = hours;
  }

  const flagIndex = argv.indexOf('--older-than');
  if (flagIndex !== -1) {
    const raw = argv[flagIndex + 1];
    const hours = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(hours) || hours < 0) {
      throw new Error(`--older-than needs a non-negative number of hours. Got: ${raw}`);
    }
    result.olderThanHours = hours;
  }

  return result;
}

/**
 * Discover, classify, and optionally remove stale worktrees.
 *
 * @param {{
 *   run?: Function,
 *   pathExists?: Function,
 *   statFile?: Function,
 *   now?: Function,
 *   cwd?: string,
 *   apply?: boolean,
 *   force?: boolean,
 *   olderThanMs?: number,
 *   isProcessAlive?: Function,
 *   mergedOnly?: boolean,
 *   loadPullRequests?: Function,
 *   removeDir?: Function,
 *   listDir?: Function,
 *   statDir?: Function,
 *   orphanOlderThanMs?: number,
 * }} [options]
 * @returns {{
 *   entries: Array<{ path: string, branch: string|null, classification: string, reason: string|null, action: string, error?: string }>,
 *   apply: boolean,
 *   force: boolean,
 *   olderThanMs: number,
 *   failed: boolean,
 * }}
 */
function reclaim(options = {}) {
  const run = options.run || defaultRun;
  const pathExists = options.pathExists || defaultPathExists;
  const statFile = options.statFile || defaultStatFile;
  const now = options.now || defaultNow;
  const cwd = options.cwd || process.cwd();
  const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
  const apply = Boolean(options.apply);
  const force = Boolean(options.force);
  const mergedOnly = Boolean(options.mergedOnly);
  const removeDir = options.removeDir || defaultRemoveDir;
  const listDir = options.listDir || ((dir) => fs.readdirSync(dir));
  const statDir = options.statDir || ((dir) => fs.statSync(dir));
  const orphanOlderThanMs =
    typeof options.orphanOlderThanMs === 'number'
      ? options.orphanOlderThanMs
      : DEFAULT_ORPHAN_OLDER_THAN_MS;
  const loadPullRequests = options.loadPullRequests || defaultLoadPullRequests;
  const olderThanMs =
    typeof options.olderThanMs === 'number' ? options.olderThanMs : DEFAULT_OLDER_THAN_MS;

  const listResult = run(['worktree', 'list', '--porcelain'], { encoding: 'utf-8' });
  if (probeFailed(listResult)) {
    throw new Error(
      `git worktree list failed, so no reclaim can run: ${describeFailure(listResult)}`,
    );
  }

  const records = parsePorcelain(listResult.stdout || '');
  let pullRequests = null;
  try {
    pullRequests = loadPullRequests();
  } catch {
    pullRequests = null;
  }
  const entries = [];
  const root = worktreesRoot(records[0] ? records[0].path : '.');
  // Git leaves ignored files (node_modules, .nx) behind after `worktree remove --force`.
  const removeLeftover = (entry, dir) => {
    const outcome = removeDir(dir, root);
    if (outcome.removed) {
      entry.leftoverRemoved = true;
    } else if (outcome.error && !/outside the worktrees folder/.test(outcome.error)) {
      entry.error = `the worktree is removed, but the folder remains: ${outcome.error}`;
    }
  };
  let hasOrphaned = false;
  let failed = false;

  records.forEach((record, index) => {
    // The first record is always the main worktree. Never classify or remove it.
    if (index === 0) {
      entries.push({
        path: record.path,
        branch: record.branch,
        classification: 'primary',
        reason: null,
        action: 'kept',
      });
      return;
    }

    // Never treat the worktree the script is running inside as a candidate, no matter what its
    // own probes would say. Skip it before running any of them. `isInside` catches a cwd that is
    // a subdirectory of the worktree, and normalizes case on win32, so `--apply` can never delete
    // the worktree it runs in (see AGENTS.md CRITICAL SAFETY RULE).
    if (isInside(cwd, record.path)) {
      entries.push({
        path: record.path,
        branch: record.branch,
        classification: 'self',
        reason: 'the script is running inside this worktree',
        action: 'skipped',
      });
      return;
    }

    const verdict = classifyWorktree(record, {
      run,
      pathExists,
      statFile,
      now,
      olderThanMs,
      isProcessAlive,
      pullRequests,
    });
    let { classification, reason } = verdict;
    if (mergedOnly && classification === 'reclaimable' && !verdict.settled) {
      classification = 'stale';
      reason = 'idle but not merged; --merged-only keeps it';
    }
    const entry = {
      path: record.path,
      branch: record.branch,
      classification,
      reason,
      action: 'skipped',
    };

    if (classification === 'orphaned') {
      hasOrphaned = true;
      entry.action = apply ? 'pruned' : 'skipped';
    } else if (classification === 'reclaimable') {
      if (apply) {
        // The tracked-file probes already proved this worktree clean, pushed, and stale. The
        // only thing `--force` overrides at this point is git's objection to ignored build
        // output (node_modules/, .next/, dist/) still sitting in the tree — there is nothing
        // left to lose.
        const result = run(['worktree', 'remove', '--force', record.path], {
          encoding: 'utf-8',
        });
        if (probeFailed(result)) {
          entry.action = 'remove-failed';
          entry.error = describeFailure(result);
          failed = true;
        } else {
          entry.action = 'removed';
          removeLeftover(entry, record.path);
          if (verdict.merged && record.branch) {
            const del = run(['-C', entries[0].path, 'branch', '-D', record.branch], {
              encoding: 'utf-8',
            });
            if (probeFailed(del)) {
              entry.error = `the worktree is removed, but the branch delete failed: ${describeFailure(del)}`;
            } else {
              entry.branchDeleted = true;
            }
          }
        }
      }
    } else if (classification === 'locked') {
      if (apply && force && !mergedOnly) {
        // Git requires force level 2 to remove a locked worktree ("use 'remove -f -f' to
        // override or unlock first"). A single --force is not enough and always fails here.
        const result = run(['worktree', 'remove', '--force', '--force', record.path], {
          encoding: 'utf-8',
        });
        if (probeFailed(result)) {
          entry.action = 'remove-failed';
          entry.error = describeFailure(result);
          failed = true;
        } else {
          entry.action = 'removed';
          removeLeftover(entry, record.path);
        }
      }
    }
    // dirty, unpushed, active, self, unknown, and orphaned-locked keep action 'skipped' and are
    // never removed, under any flag. An orphaned-locked worktree needs the lock cleared by hand
    // first: `git worktree prune` skips a locked worktree, so this script must never claim it.

    entries.push(entry);
  });

  if (apply && hasOrphaned) {
    const pruneResult = run(['worktree', 'prune'], { encoding: 'utf-8' });
    if (probeFailed(pruneResult)) {
      failed = true;
      const error = describeFailure(pruneResult);
      for (const entry of entries) {
        if (entry.classification === 'orphaned') {
          entry.action = 'prune-failed';
          entry.error = error;
        }
      }
    }
  }

  const orphans = records[0]
    ? sweepOrphans({
        root,
        registered: records.map((r) => r.path),
        apply,
        now,
        olderThanMs: orphanOlderThanMs,
        removeDir,
        listDir,
        statDir,
      })
    : [];
  return { entries, orphans, apply, force, olderThanMs, failed };
}

/** Build the readable report: one line per worktree, then a summary line. */
function formatReport(result) {
  const lines = ['Worktree reclaim report', ''];

  for (const entry of result.entries) {
    const branch = entry.branch || '(detached)';
    lines.push(
      `${entry.classification.toUpperCase().padEnd(12)} ${entry.action.padEnd(13)} ${branch}  ${entry.path}`,
    );
    if (entry.reason) lines.push(`  reason: ${entry.reason}`);
    if (entry.branchDeleted) lines.push('  local branch deleted');
    if (entry.leftoverRemoved) lines.push('  leftover folder deleted');
    if (entry.error) lines.push(`  error: ${entry.error}`);
  }

  const counts = {};
  for (const entry of result.entries) {
    counts[entry.classification] = (counts[entry.classification] || 0) + 1;
  }
  const summary = Object.entries(counts)
    .map(([classification, count]) => `${count} ${classification}`)
    .join(', ');

  const windowHours = (result.olderThanMs / 3_600_000).toFixed(1);

  const orphans = result.orphans || [];
  const orphanCount = (action) => orphans.filter((o) => o.action === action).length;
  for (const orphan of orphans.filter((o) => o.action !== 'kept-recent')) {
    lines.push(`ORPHAN       ${orphan.action.padEnd(13)} ${orphan.path}`);
    if (orphan.error) lines.push(`  error: ${orphan.error}`);
  }

  lines.push('');
  lines.push(`Summary: ${summary}.`);
  if (orphans.length > 0) {
    lines.push(
      `Residue folders: ${orphanCount('orphan')} found, ${orphanCount('orphan-removed')} removed, ` +
        `${orphanCount('orphan-failed')} failed, ${orphanCount('kept-recent')} too recent.`,
    );
  }
  lines.push(`Worktrees touched within the last ${windowHours}h classify active and are skipped.`);

  if (result.entries.some((entry) => entry.classification === 'orphaned-locked')) {
    lines.push(
      'An orphaned-locked worktree has a gone path but git still holds its lock, so prune skips ' +
        'it. Unlock it first (git worktree unlock <path>), then rerun.',
    );
  }

  if (!result.apply) {
    lines.push('This is a dry run. Nothing changed.');
    lines.push('Run with --apply to remove reclaimable worktrees and prune orphaned ones.');
  }
  lines.push('Override the reclaim window with --older-than <hours>.');

  return lines.join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = reclaim({
      apply: args.apply,
      force: args.force,
      mergedOnly: args.mergedOnly,
      orphanOlderThanMs:
        args.orphanOlderThanHours !== undefined ? args.orphanOlderThanHours * 3_600_000 : undefined,
      olderThanMs: args.olderThanHours !== undefined ? args.olderThanHours * 3_600_000 : undefined,
    });
  } catch (error) {
    if (args.quiet) return;
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (args.quiet) {
    // Automatic runs print one line at most, and never fail a session.
    const removed = result.entries.filter((e) => e.action === 'removed').length;
    const orphans = result.orphans || [];
    const residue = orphans.filter((o) => o.action === 'orphan-removed').length;
    const failed =
      result.entries.filter((e) => /failed$/.test(e.action) || e.error).length +
      orphans.filter((o) => o.action === 'orphan-failed').length;
    for (const o of orphans.filter((x) => x.action === 'orphan-failed')) {
      console.log(`Cannot delete ${o.path}: ${o.error}`);
    }
    if (removed > 0 || residue > 0 || failed > 0) {
      console.log(
        `Worktree cleanup: ${removed} removed, ${residue} residue folders removed, ${failed} failed.`,
      );
    }
    return;
  }
  console.log(formatReport(result));
  if (result.failed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parsePorcelain,
  classifyWorktree,
  reclaim,
  probeFailed,
  formatReport,
  parseArgs,
  isInside,
  judgePullRequests,
  sweepOrphans,
  defaultRemoveDir,
  DEFAULT_OLDER_THAN_MS,
};
