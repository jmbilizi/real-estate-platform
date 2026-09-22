#!/usr/bin/env node

/**
 * Reclaim stale agent git worktrees safely.
 *
 * Parses `git worktree list --porcelain`, classifies every worktree but the primary one, and
 * removes only the ones proven safe. A dirty worktree or a worktree with unpushed commits is
 * never removed, under any flag. See ticket #235 AC3.
 *
 * CRITICAL SAFETY RULE: a probe that fails (git exits non-zero, or the runner throws) must never
 * read as "clean" or "absent". It classifies as `unknown` and the worktree is skipped. This repo
 * has a recorded regression of exactly that shape (AGENTS.md: "A failed probe must never read as
 * absent").
 *
 * `.agents/hooks/lane-boundary.js` blocks a direct `git worktree remove|move|prune` and names this
 * script instead. The hook inspects agent tool calls only, so it never sees the git processes this
 * script spawns. This script needs no exemption flag.
 */

const fs = require('fs');
const { spawnSync } = require('child_process');

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

/** Check a path exists for real. Replaced by an injected check in tests. */
function defaultPathExists(targetPath) {
  return fs.existsSync(targetPath);
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
 * Classify one non-primary worktree.
 *
 * Order matters for safety. Dirty and unpushed are checked before locked, so a worktree that is
 * both locked and dirty (or locked and unpushed) is reported as `dirty` or `unpushed` — never as
 * `locked` — and so never qualifies for `--force` removal.
 *
 * @param {ReturnType<typeof parsePorcelain>[number]} record
 * @param {{ run: Function, pathExists?: Function }} options
 * @returns {{ classification: string, reason: string|null }}
 */
function classifyWorktree(record, options) {
  const run = options.run;
  const pathExists = options.pathExists || defaultPathExists;

  if (record.prunable) {
    return {
      classification: 'orphaned',
      reason: record.prunableReason || 'git reports this worktree as prunable',
    };
  }
  if (!pathExists(record.path)) {
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

  if (record.locked) {
    return {
      classification: 'locked',
      reason: record.lockedReason || 'git reports this worktree as locked',
    };
  }

  return { classification: 'reclaimable', reason: null };
}

/**
 * Discover, classify, and optionally remove stale worktrees.
 *
 * @param {{ run?: Function, pathExists?: Function, apply?: boolean, force?: boolean }} [options]
 * @returns {{
 *   entries: Array<{ path: string, branch: string|null, classification: string, reason: string|null, action: string, error?: string }>,
 *   apply: boolean,
 *   force: boolean,
 *   failed: boolean,
 * }}
 */
function reclaim(options = {}) {
  const run = options.run || defaultRun;
  const pathExists = options.pathExists || defaultPathExists;
  const apply = Boolean(options.apply);
  const force = Boolean(options.force);

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

    const { classification, reason } = classifyWorktree(record, { run, pathExists });
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
        const result = run(['worktree', 'remove', record.path], { encoding: 'utf-8' });
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
        const result = run(['worktree', 'remove', '--force', record.path], { encoding: 'utf-8' });
        if (probeFailed(result)) {
          entry.action = 'remove-failed';
          entry.error = describeFailure(result);
          failed = true;
        } else {
          entry.action = 'removed';
        }
      }
    }
    // dirty, unpushed, and unknown keep action 'skipped' and are never removed, under any flag.

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

  return { entries, apply, force, failed };
}

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    force: argv.includes('--force'),
  };
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

  lines.push('');
  lines.push(`Summary: ${summary}.`);

  if (!result.apply) {
    lines.push('This is a dry run. Nothing changed.');
    lines.push('Run with --apply to remove reclaimable worktrees and prune orphaned ones.');
  }

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    result = reclaim({ apply: args.apply, force: args.force });
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
};
