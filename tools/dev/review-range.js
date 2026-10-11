#!/usr/bin/env node

/**
 * Print the review range and changed files for the current branch.
 *
 * `/code-review` can review the wrong tree when run from a worktree and then report a clean
 * result for a diff it never read. Pass the printed range to `/code-review` explicitly. See
 * ticket #304.
 *
 * The script fails loudly (exit 1) when it cannot name the branch, the merge base, or the tree
 * `NX_WORKSPACE_ROOT_PATH` points at. It never prints an empty range.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const BASE_CANDIDATES = ['origin/dev', 'dev'];

/** Run git in `cwd`. Returns trimmed stdout. Throws on a non-zero exit. */
function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout.trim();
}

function samePath(a, b) {
  const normalize = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalize(a) === normalize(b);
}

/**
 * Resolve the review range from the tree at `cwd`.
 *
 * @param {(args: string[]) => string} git runs git in the invoking tree
 * @returns {{ branch: string, base: string, mergeBase: string, range: string, files: string[] }}
 */
function resolveReviewRange(git) {
  let branch;
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch (error) {
    throw new Error(`Cannot resolve the current branch. ${error.message}`);
  }
  if (!branch || branch === 'HEAD') {
    throw new Error('HEAD is detached. Check out the branch under review, then run again.');
  }

  let base = null;
  let mergeBase = null;
  const failures = [];
  for (const candidate of BASE_CANDIDATES) {
    try {
      mergeBase = git(['merge-base', candidate, 'HEAD']);
      if (mergeBase) {
        base = candidate;
        break;
      }
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  if (!base) {
    throw new Error(
      `Cannot resolve a merge base for ${branch} against ${BASE_CANDIDATES.join(' or ')}.\n` +
        failures.join('\n'),
    );
  }

  const files = git(['diff', '--name-only', `${mergeBase}..HEAD`])
    .split(/\r?\n/)
    .filter(Boolean);
  return { branch, base, mergeBase, range: `${base}...${branch}`, files };
}

/**
 * Return an error message when `NX_WORKSPACE_ROOT_PATH` names a tree other than the invoking one.
 * Return null when it is unset or matches.
 *
 * @param {string | undefined} nxRoot
 * @param {string} toplevel
 * @returns {string | null}
 */
function checkNxRoot(nxRoot, toplevel) {
  if (!nxRoot || samePath(nxRoot, toplevel)) return null;
  return (
    `NX_WORKSPACE_ROOT_PATH points at ${nxRoot}, but this tree is ${toplevel}. ` +
    'nx and /code-review target the wrong tree. ' +
    `Set NX_WORKSPACE_ROOT_PATH to "${toplevel}" or unset it, then run again.`
  );
}

function main() {
  const cwd = process.cwd();
  const git = (args) => runGit(args, cwd);
  try {
    const toplevel = git(['rev-parse', '--show-toplevel']);
    const nxProblem = checkNxRoot(process.env.NX_WORKSPACE_ROOT_PATH, toplevel);
    if (nxProblem) throw new Error(nxProblem);

    const result = resolveReviewRange(git);
    if (result.files.length === 0) {
      throw new Error(
        `Range ${result.range} has no changed files. Commit the work, or check the branch.`,
      );
    }
    console.log(`Tree:       ${toplevel}`);
    console.log(`Branch:     ${result.branch}`);
    console.log(`Merge base: ${result.mergeBase}`);
    console.log(`Range:      ${result.range}`);
    console.log(`Files (${result.files.length}):`);
    for (const file of result.files) console.log(`  ${file}`);
    console.log('\nPass the range to /code-review. Treat an unpinned clean result as unverified.');
    console.log('If /code-review stalls, review `git diff` by hand.');
  } catch (error) {
    console.error(`dev:review-range failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { resolveReviewRange, checkNxRoot };
