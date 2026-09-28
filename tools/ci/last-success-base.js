#!/usr/bin/env node
/**
 * Resolve the base commit for a push-triggered workflow's "affected" detection.
 *
 * WHY THIS EXISTS
 *
 * A push whose CI fails gets no image build and no deploy trigger (both need quality checks to
 * pass first). The next push that goes green only diffs against `github.event.before` — the
 * commit the branch pointed at before THIS push — which is the failed push's own final commit,
 * not the last one this workflow actually completed. The failed push's changes never enter any
 * diff, so they never build and never deploy (#446).
 *
 * The correct base is the head commit of the last run of this workflow, on this branch, that
 * succeeded. This resolves that commit via `gh run list` and confirms it is still an ancestor of
 * HEAD before trusting it — a rewritten branch or a stale/cross-branch run must not produce a
 * bogus diff range.
 *
 * An explicit override (workflow_dispatch's own `before_sha` input) always wins and skips the
 * lookup entirely, so a manual dispatch keeps deciding its own base.
 *
 * Usage:
 *   node tools/ci/last-success-base.js --workflow=build-push-images.yml --branch=dev --repo=owner/repo
 *   node tools/ci/last-success-base.js --workflow=build-push-images.yml --branch=dev --explicit-before=<sha>
 *
 * Prints the resolved base SHA to stdout (empty when none is safe to use — the caller must then
 * fall back to building/deploying everything, per the module contract below). Always exits 0;
 * a `gh`/`git` failure is treated the same as "not found", not as an error.
 */

const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const args = { workflow: '', branch: '', head: 'HEAD', explicitBefore: '', repo: '' };
  for (const arg of argv) {
    if (arg.startsWith('--workflow=')) args.workflow = arg.slice('--workflow='.length);
    else if (arg.startsWith('--branch=')) args.branch = arg.slice('--branch='.length);
    else if (arg.startsWith('--head=')) args.head = arg.slice('--head='.length);
    else if (arg.startsWith('--repo=')) args.repo = arg.slice('--repo='.length);
    else if (arg.startsWith('--explicit-before='))
      args.explicitBefore = arg.slice('--explicit-before='.length);
  }
  return args;
}

/**
 * Looks up the headSha of the most recent successful run of `workflow` on `branch`. Null on any
 * failure. `repo` is passed through to `gh run list --repo`, matching every other `gh` call in
 * this repo's workflows, rather than relying on `gh` inferring it from the git remote.
 */
function lastSuccessfulRunSha(workflow, branch, repo) {
  try {
    const args = [
      'run',
      'list',
      '--workflow',
      workflow,
      '--branch',
      branch,
      '--status',
      'success',
      '--json',
      'headSha',
      '-L',
      '1',
    ];
    if (repo) args.push('--repo', repo);
    const out = execFileSync('gh', args, { encoding: 'utf8' });
    const rows = JSON.parse(out);
    return rows[0] && rows[0].headSha ? rows[0].headSha : null;
  } catch {
    return null;
  }
}

/** True when `sha` is an ancestor of `head` in the checked-out repo. False on any failure. */
function isAncestor(sha, head) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, head], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure decision function — takes the lookups as parameters so tests never touch a real `gh` or
 * `git`. Returns `{ base, reason }`; `base` is `''` when the caller should fall back to
 * building/deploying everything instead of trusting a diff.
 */
function resolveBase({
  workflow,
  branch,
  head,
  repo,
  explicitBefore,
  findLastSuccess,
  checkAncestor,
}) {
  if (explicitBefore) {
    return { base: explicitBefore, reason: 'explicit override' };
  }
  const candidate = findLastSuccess(workflow, branch, repo);
  if (!candidate) {
    return { base: '', reason: `no successful ${workflow} run found on ${branch}` };
  }
  if (!checkAncestor(candidate, head)) {
    return { base: '', reason: `${candidate} is not an ancestor of ${head} — ignoring it` };
  }
  return { base: candidate, reason: `last successful ${workflow} run on ${branch}` };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { base, reason } = resolveBase({
    workflow: args.workflow,
    branch: args.branch,
    head: args.head,
    repo: args.repo,
    explicitBefore: args.explicitBefore,
    findLastSuccess: lastSuccessfulRunSha,
    checkAncestor: isAncestor,
  });
  process.stderr.write(`[last-success-base] ${reason}\n`);
  process.stdout.write(base);
}

if (require.main === module) {
  main();
}

module.exports = { resolveBase, parseArgs };
