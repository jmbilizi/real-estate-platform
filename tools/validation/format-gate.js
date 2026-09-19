'use strict';

/**
 * Honest format gate for the pre-commit and pre-push scripts (#151).
 *
 * Both scripts used to run `nx:reset`, then a repo-wide `nx format:write`, and only then report on
 * `nx:workspace-format-check`. The write repaired the developer's working tree, the check that
 * followed therefore passed, and pre-push printed "CI will pass" — over a tree whose COMMITTED
 * content still failed the same gate in CI. The repair reached the working tree only. It never
 * reached the commit CI reads.
 *
 * The fix is ordering, not scoping. The gate runs BEFORE anything writes, so it sees the tree CI
 * sees. Scoping the write instead does not work: `nx format:write --files=…` still rewrites
 * `nx.json` and the root `tsconfig.json` unconditionally, because `addRootConfigFiles` returns
 * early only for `--all` (`nx/src/command-line/format/format.js`).
 *
 * This module holds the parts worth testing: reading `git status`, naming what the write changed,
 * and deciding whether a run has earned a claim about CI.
 */

/**
 * Parse `git status --porcelain -z` into entries.
 *
 * `-z` is the machine-readable form: NUL-separated records, and paths verbatim. Without it git
 * quotes and C-escapes any path holding a space or a non-ASCII byte, so `apps/café.ts` comes back
 * as the literal `apps/caf\303\251.ts` and never matches a real file.
 *
 * A rename or copy record is followed by a second field holding the source path. Only the
 * destination exists on disk, so the source is consumed and dropped.
 */
function parseGitStatus(output) {
  const fields = String(output || '').split('\0');
  const entries = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    if (code[0] === 'R' || code[0] === 'C') i += 1;
    entries.push({ code, path: field.slice(3), untracked: code === '??' });
  }
  return entries;
}

/** Paths of tracked entries — the only ones whose worktree content can differ from a commit. */
function trackedPaths(entries) {
  return entries.filter((e) => !e.untracked).map((e) => e.path);
}

/** Every path, tracked or not. */
function allPaths(entries) {
  return entries.map((e) => e.path);
}

/** Paths present in `after` and absent from `before`, sorted for a stable report. */
function changedSince(before, after) {
  const was = new Set(before);
  return [...new Set(after)].filter((p) => !was.has(p)).sort();
}

const MAX_LISTED_PATHS = 10;

function formatPathList(paths) {
  const sorted = [...paths].sort();
  const shown = sorted.slice(0, MAX_LISTED_PATHS).map((p) => `  • ${p}`);
  const hidden = sorted.length - shown.length;
  return hidden > 0 ? [...shown, `  • …and ${hidden} more`] : shown;
}

/**
 * The closing verdict for a pre-push run whose checks all passed.
 *
 * `claimsCi` is the point of #151. CI reads the commits that get pushed. Content that differs from
 * HEAD is content CI never sees, so a run over it cannot predict CI and must not say it does.
 *
 * Three inputs decide the claim:
 *
 * - `statusKnown` — false when `git status` failed. An unread tree is not a clean tree, so the run
 *   claims nothing. Treating the failure as "clean" would print the one line this ticket says has
 *   to be earned, on no evidence at all.
 * - `trackedDirty` — tracked paths whose worktree content differs from the commit. Untracked paths
 *   are excluded on purpose: they are absent from the push, so they can only make the local check
 *   stricter than CI, never looser.
 * - `repaired` — what `nx:reset` and the format write rewrote during this run. Reported in its own
 *   category, because "the script generated this" is different advice from "you forgot to commit
 *   this".
 */
function describePushVerdict({ trackedDirty = [], repaired = [], statusKnown = true } = {}) {
  const repairedSet = new Set(repaired);
  const unexplained = [...trackedDirty].filter((p) => !repairedSet.has(p)).sort();
  const lines = [];

  if (repaired.length > 0) {
    lines.push(`nx:reset and the format write rewrote ${repaired.length} file(s):`);
    lines.push(...formatPathList(repaired));
    lines.push('Commit them if they are real changes.');
  }

  if (!statusKnown) {
    lines.push('Could not read git status, so this run cannot compare the tree against HEAD.');
    lines.push('CI reads the pushed commits. This result does not predict the CI result.');
    return { claimsCi: false, lines };
  }

  if (unexplained.length > 0) {
    lines.push(`${unexplained.length} tracked file(s) differ from HEAD and are not in your push:`);
    lines.push(...formatPathList(unexplained));
  }

  if (unexplained.length === 0 && repaired.length === 0) {
    lines.push('Working tree matches HEAD. CI runs these same gates on the commits you push.');
    return { claimsCi: true, lines };
  }

  lines.push('CI reads the pushed commits, so this result does not predict the CI result.');
  return { claimsCi: false, lines };
}

module.exports = {
  MAX_LISTED_PATHS,
  parseGitStatus,
  trackedPaths,
  allPaths,
  changedSince,
  formatPathList,
  describePushVerdict,
};
