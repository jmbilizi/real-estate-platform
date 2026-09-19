'use strict';

/**
 * Honest format gate for the pre-commit and pre-push scripts (#151).
 *
 * Both scripts used to run a repo-wide `nx format:write` and then report on
 * `nx:workspace-format-check`. The write repaired the developer's working tree, the check that
 * followed therefore passed, and pre-push printed "CI will pass" — over a tree whose COMMITTED
 * content still failed the same gate in CI. The repair reached the working tree only. It never
 * reached the commit CI reads.
 *
 * Two rules keep the gate honest here:
 *
 * 1. The repair is scoped to the paths `nx:reset` itself made dirty. `nx:reset` rewrites generated
 *    files (project.json, the solution file), so the write still has a job. It no longer touches
 *    a file the developer wrote, so the check that follows is a real verdict on that file.
 * 2. A success verdict names what ran. It claims nothing about CI while the working tree differs
 *    from HEAD, because CI reads the pushed commits, not the tree.
 */

const RENAME_SEPARATOR = ' -> ';

/**
 * Parse `git status --porcelain` into a Set of paths.
 *
 * Porcelain v1 puts a two-character status in columns 1-2 and the path from column 4. A rename
 * reads `R  old -> new`; only the destination exists on disk, so only it can be formatted. Git
 * quotes a path holding unusual bytes, so the quotes come off.
 */
function parseGitStatus(output) {
  const paths = new Set();
  for (const line of String(output || '').split('\n')) {
    if (line.length < 4) continue;
    let entry = line.slice(3).trim();
    if (!entry) continue;
    const renameAt = entry.indexOf(RENAME_SEPARATOR);
    if (renameAt !== -1) entry = entry.slice(renameAt + RENAME_SEPARATOR.length);
    paths.add(unquotePath(entry));
  }
  return paths;
}

function unquotePath(entry) {
  return entry.startsWith('"') && entry.endsWith('"') && entry.length > 1
    ? entry.slice(1, -1)
    : entry;
}

/** Paths dirty in `after` that were clean in `before`, sorted for a stable report. */
function newlyDirtyPaths(before, after) {
  const was = before instanceof Set ? before : new Set(before);
  const now = after instanceof Set ? after : new Set(after);
  return [...now].filter((p) => !was.has(p)).sort();
}

/**
 * Build the scoped format command, or null when there is nothing to format.
 *
 * Nx reads `--files` as a comma-separated list, so a path containing a comma cannot be expressed.
 * Such a path is returned in `skipped` and left alone rather than passed in a form that would
 * silently format the wrong file.
 */
function buildScopedFormatCommand(paths) {
  const all = [...(paths || [])];
  const skipped = all.filter((p) => p.includes(','));
  const formattable = all.filter((p) => !p.includes(','));
  return {
    command:
      formattable.length > 0 ? `pnpm exec nx format:write --files=${formattable.join(',')}` : null,
    formattable,
    skipped,
  };
}

/**
 * Format only what `nx:reset` changed.
 *
 * `run` is the caller's command runner: `(command, options) => { success: boolean }`.
 * `gitStatus` returns the raw `git status --porcelain` output.
 *
 * Returns the paths offered to the formatter, the paths that still differ afterwards (the ones a
 * caller reports as repaired), and whether the formatter itself succeeded.
 */
function repairResetOutput({ run, gitStatus, before }) {
  const after = parseGitStatus(gitStatus());
  const candidates = newlyDirtyPaths(before, after);
  const { command, formattable, skipped } = buildScopedFormatCommand(candidates);

  if (!command) {
    return { ran: false, success: true, formatted: [], candidates, skipped };
  }

  const result = run(command, { silent: true });
  return {
    ran: true,
    success: Boolean(result && result.success),
    formatted: formattable,
    candidates,
    skipped,
  };
}

const MAX_LISTED_PATHS = 10;

/**
 * The closing verdict for a pre-push run whose checks all passed.
 *
 * `claimsCi` is the whole point of #151. CI checks the commits that get pushed. A dirty working
 * tree is content CI never sees, so a run over it cannot predict CI and must not say it does.
 */
function describePushVerdict({ dirtyPaths = [], repairedPaths = [] } = {}) {
  const dirty = [...dirtyPaths].sort();
  const lines = [];

  if (repairedPaths.length > 0) {
    lines.push(`Formatted ${repairedPaths.length} file(s) that nx:reset rewrote:`);
    lines.push(...formatPathList(repairedPaths));
  }

  if (dirty.length === 0) {
    lines.push('Working tree matches HEAD. CI runs these same gates on the commits you push.');
    return { claimsCi: true, lines };
  }

  lines.push(`${dirty.length} file(s) differ from HEAD and are not in the commits you will push:`);
  lines.push(...formatPathList(dirty));
  lines.push('CI checks the pushed commits, so this run does not predict the CI result.');
  lines.push('Commit these files, then run pre-push again.');
  return { claimsCi: false, lines };
}

function formatPathList(paths) {
  const sorted = [...paths].sort();
  const shown = sorted.slice(0, MAX_LISTED_PATHS).map((p) => `  • ${p}`);
  const hidden = sorted.length - shown.length;
  return hidden > 0 ? [...shown, `  • …and ${hidden} more`] : shown;
}

module.exports = {
  MAX_LISTED_PATHS,
  parseGitStatus,
  newlyDirtyPaths,
  buildScopedFormatCommand,
  repairResetOutput,
  describePushVerdict,
  formatPathList,
};
