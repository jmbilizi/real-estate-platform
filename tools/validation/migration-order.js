'use strict';

/**
 * Guards node-pg-migrate migration order.
 *
 * node-pg-migrate runs migrations in numeric-prefix order and refuses to start once a lower
 * prefix appears after a higher one already ran (#399: migration 037 merged after 038/039 had
 * already deployed to dev, and the `migrate` initContainer crashed).
 *
 * A file counts as a migration when its path ends in `migrations/<digits>_<name>.js`. This
 * matches any node-pg-migrate service in the repo, not only property-service.
 */

const MIGRATION_FILE_RE = /(^|\/)migrations\/(\d+)_[^/]+\.js$/;

/**
 * @param {string} filePath repo-relative path, forward slashes
 * @returns {{ dir: string, prefix: bigint } | null}
 */
function parseMigrationFile(filePath) {
  const match = MIGRATION_FILE_RE.exec(filePath);
  if (!match) return null;
  const dir = filePath.slice(0, match.index) + match[1] + 'migrations';
  return { dir, prefix: BigInt(match[2]) };
}

/**
 * Highest existing migration prefix per migrations directory on the base branch.
 *
 * @param {string[]} baseFiles repo-relative paths on the base branch
 * @returns {Map<string, bigint>}
 */
function highestPrefixByDir(baseFiles) {
  const highest = new Map();
  for (const file of baseFiles) {
    const parsed = parseMigrationFile(file);
    if (!parsed) continue;
    const current = highest.get(parsed.dir);
    if (current === undefined || parsed.prefix > current) {
      highest.set(parsed.dir, parsed.prefix);
    }
  }
  return highest;
}

/**
 * Finds added migrations whose prefix is at or below the highest prefix already on the base
 * branch, in the same migrations directory.
 *
 * @param {string[]} addedFiles repo-relative paths added by the PR/push
 * @param {string[]} baseFiles repo-relative paths present on the base branch
 * @returns {{ file: string, prefix: string, highestBasePrefix: string, dir: string }[]}
 */
function findMigrationOrderViolations(addedFiles, baseFiles) {
  const highest = highestPrefixByDir(baseFiles);
  const violations = [];
  for (const file of addedFiles) {
    const parsed = parseMigrationFile(file);
    if (!parsed) continue;
    const baseMax = highest.get(parsed.dir);
    if (baseMax === undefined) continue; // new migrations directory — nothing to order against
    if (parsed.prefix <= baseMax) {
      violations.push({
        file,
        prefix: parsed.prefix.toString(),
        highestBasePrefix: baseMax.toString(),
        dir: parsed.dir,
      });
    }
  }
  return violations;
}

function formatViolation(v) {
  return (
    `${v.file} has prefix ${v.prefix}. ` +
    `The highest prefix already on the base branch (in ${v.dir}/) is ${v.highestBasePrefix}. ` +
    `Renumber this migration above ${v.highestBasePrefix}.`
  );
}

// The all-zero SHA GitHub sends as `github.event.before` on the first push of a new branch —
// there is no prior commit to diff against.
const ZERO_SHA = '0000000000000000000000000000000000000000';

/**
 * Picks the ref that push mode diffs and lists against.
 *
 * Prefer `github.event.before`, the branch's previous tip. Fall back to `HEAD^`, the pushed
 * commit's first parent, when `before` is missing or unknown to this checkout. `ci.yml`'s
 * `detect-infra-changes` job uses the same fallback. A first push, a force-push, or a shallow
 * checkout can all leave `before` unusable.
 *
 * @param {string} beforeSha `github.event.before`, or '' if unset
 * @param {(sha: string) => boolean} isKnownCommit checks the SHA exists in this checkout
 * @returns {string} a ref usable with `git diff`/`git ls-tree`
 */
function resolvePushBaseRef(beforeSha, isKnownCommit) {
  if (beforeSha && beforeSha !== ZERO_SHA && isKnownCommit(beforeSha)) {
    return beforeSha;
  }
  return 'HEAD^';
}

module.exports = {
  MIGRATION_FILE_RE,
  parseMigrationFile,
  highestPrefixByDir,
  findMigrationOrderViolations,
  formatViolation,
  resolvePushBaseRef,
};

if (require.main === module) {
  const { execFileSync } = require('node:child_process');

  function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  }

  function git(args) {
    return execFileSync('git', args, { encoding: 'utf-8' });
  }

  function isKnownCommit(sha) {
    try {
      git(['cat-file', '-e', sha]);
      return true;
    } catch {
      return false;
    }
  }

  // PR mode (default): base is the PR's remote target branch. Its history can diverge from HEAD,
  // so the three-dot diff is deliberate: it compares against the common ancestor, not the base's
  // current tip.
  //
  // Push mode: base is the branch's own prior commit, always a direct ancestor of HEAD. The
  // two-dot diff compares the two trees directly. This matters when the branch's history was
  // rewritten: a three-dot diff would then read from an old common ancestor, while `ls-tree`
  // would read the newer `before` tree — two different points in history, producing a false
  // violation on a migration that already shipped.
  const mode = arg('mode', 'pr');
  let baseRef;
  let diffSpec;
  if (mode === 'push') {
    const before = arg('before', process.env.GITHUB_EVENT_BEFORE || '');
    baseRef = resolvePushBaseRef(before, isKnownCommit);
    diffSpec = `${baseRef}..HEAD`;
  } else {
    const base = arg('base', process.env.GITHUB_BASE_REF || 'dev');
    baseRef = base.startsWith('origin/') ? base : `origin/${base}`;
    diffSpec = `${baseRef}...HEAD`;
  }

  let addedFiles;
  try {
    const raw = git(['diff', '--name-status', '--diff-filter=A', diffSpec]);
    addedFiles = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[1])
      .filter(Boolean);
  } catch (error) {
    console.error(`✗ Could not diff against ${baseRef}: ${error.message}`);
    process.exit(1);
  }

  let baseFiles;
  try {
    const raw = git(['ls-tree', '-r', '--name-only', baseRef]);
    baseFiles = raw.split('\n').filter(Boolean);
  } catch (error) {
    console.error(`✗ Could not list files on ${baseRef}: ${error.message}`);
    process.exit(1);
  }

  const violations = findMigrationOrderViolations(addedFiles, baseFiles);
  if (violations.length > 0) {
    console.error(`✗ Migration order guard failed against ${baseRef}:\n`);
    for (const v of violations) {
      console.error(`  ${formatViolation(v)}`);
    }
    console.error(
      '\nA migration numbered at or below one already on the base branch crashes the migrate ' +
        'initContainer at deploy time (#399). Give the new migration the next free number.',
    );
    process.exit(1);
  }

  console.log(`✓ Migration order guard passed against ${baseRef}.`);
  process.exit(0);
}
