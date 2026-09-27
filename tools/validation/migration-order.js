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

module.exports = {
  MIGRATION_FILE_RE,
  parseMigrationFile,
  highestPrefixByDir,
  findMigrationOrderViolations,
  formatViolation,
};

if (require.main === module) {
  const { execFileSync } = require('node:child_process');

  function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  }

  const base = arg('base', process.env.GITHUB_BASE_REF || 'dev');
  const baseRef = base.startsWith('origin/') ? base : `origin/${base}`;

  function git(args) {
    return execFileSync('git', args, { encoding: 'utf-8' });
  }

  let addedFiles;
  try {
    const raw = git(['diff', '--name-status', '--diff-filter=A', `${baseRef}...HEAD`]);
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
