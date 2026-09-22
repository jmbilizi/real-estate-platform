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
 * than the reclaim window. A running lane that is clean and pushed but still active is classified
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
  if ((logResult.stdout || '').trim().length > 0) {
    return { classification: 'unpushed', reason: 'the branch has commits that exist nowhere else' };
  }

  const idle = measureIdleMs(record, { run, statFile, now });
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

  return { classification: 'reclaimable', reason: null };
}

function parseArgs(argv) {
  const result = { apply: argv.includes('--apply'), force: argv.includes('--force') };

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
  const olderThanMs =
    typeof options.olderThanMs === 'number' ? options.olderThanMs : DEFAULT_OLDER_THAN_MS;

  const listResult = run(['worktree', 'list', '--porcelain'], { encoding: 'utf-8' });
  if (probeFailed(listResult)) {
    throw new Error(
      `git worktree list failed, so no reclaim can run: ${describeFailure(listResult)}`,
    );
  }

  const records = parsePorcelain(listResult.stdout || '');
  const entries = [];
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

    const { classification, reason } = classifyWorktree(record, {
      run,
      pathExists,
      statFile,
      now,
      olderThanMs,
      isProcessAlive,
    });
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
        }
      }
    } else if (classification === 'locked') {
      if (apply && force) {
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

  return { entries, apply, force, olderThanMs, failed };
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

  lines.push('');
  lines.push(`Summary: ${summary}.`);
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
      olderThanMs: args.olderThanHours !== undefined ? args.olderThanHours * 3_600_000 : undefined,
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
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
  DEFAULT_OLDER_THAN_MS,
};
