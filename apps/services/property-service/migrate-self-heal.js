/**
 * Local-only self-heal for a `pgmigrations` row that has no matching migration file (#223).
 *
 * A migration renumbered by a merged PR (e.g. `014` becoming `022`, same body, new filename)
 * leaves the OLD filename recorded in `pgmigrations` on any database migrated before the rename.
 * `node-pg-migrate`'s `checkOrder` compares the recorded names against the file list index by
 * index and throws forever once they diverge — there is no way to make it skip the stale row on
 * its own.
 *
 * The fix is a RENAME, never a delete-and-rerun. The row's `up()` already ran under the old name,
 * and most migrations are not idempotent (`ADD COLUMN`, `ADD CONSTRAINT`, ...): deleting the row
 * and letting node-pg-migrate re-apply the same file a second time fails with "already exists"
 * instead of healing anything. Renaming the row to match the current file means
 * `getMigrationsToRun()` — which decides what to apply by name membership only — correctly treats
 * it as already done and never re-executes its body.
 *
 * A rename alone does not fix `checkOrder`: the row keeps its ORIGINAL position in run order
 * (`ORDER BY run_on, id`), which no longer matches its position in the renumbered file list once
 * migrations were inserted between the old and new numbers. `migrate.js` retries with
 * `checkOrder: false` after a rename for exactly this reason — `getMigrationsToRun()` does not
 * depend on position, only on which names are already recorded, so the retry runs every
 * genuinely-pending migration in file order while skipping the renamed one.
 *
 * `migrate.js` gates every call here behind `PROPERTY_SERVICE_MIGRATION_SELF_HEAL`, set only on
 * the podman/local overlay. In dev/test/prod a `pgmigrations` row with no file is real deploy
 * history, and renaming or reordering it would be destructive.
 */

const fs = require('node:fs');
const path = require('node:path');

// Mirrors node-pg-migrate's checkOrder() in dist/legacy/runner.js: the FIRST captured name is
// the next migration the file list expects, the SECOND is the name already recorded in
// pgmigrations — the one that has no file once it was renumbered.
const ORPHANED_MIGRATION_PATTERN =
  /^Not run migration \S+ is preceding already run migration (\S+)$/;

/**
 * True only when the local self-heal is explicitly opted into and this is not a production
 * process. The NODE_ENV check mirrors seed-on-start.ts: a flag alone must never be enough to
 * enable a destructive-adjacent path in a misconfigured production container.
 */
function isSelfHealEnabled(env = process.env) {
  return env.PROPERTY_SERVICE_MIGRATION_SELF_HEAL === '1' && env.NODE_ENV !== 'production';
}

/**
 * Returns the recorded migration name node-pg-migrate rejected, or null when `error` is not
 * that specific checkOrder failure. Matching on the exact error text keeps this from firing on
 * an unrelated migration failure (bad SQL, a real credential problem, and so on).
 */
function parseOrphanedMigrationName(error) {
  const match = ORPHANED_MIGRATION_PATTERN.exec(error?.message ?? '');
  return match ? match[1] : null;
}

/**
 * The part of a migration's name after its leading timestamp, e.g.
 * `add-mls-field-address-classification` for `1785801600022_add-mls-field-address-classification`.
 * A renumbering keeps this identical and changes only the timestamp — that is what "renumbered"
 * means here, as opposed to a migration that was genuinely removed.
 */
function migrationDescription(migrationName) {
  const separatorIndex = migrationName.indexOf('_');
  return separatorIndex === -1 ? null : migrationName.slice(separatorIndex + 1);
}

/**
 * Finds the current file for an orphaned migration name, matched by description rather than by
 * position — a renumbering can move a migration many positions away from where it used to run.
 * Returns null, and self-heal must not act, unless exactly one OTHER file matches: zero means the
 * migration was genuinely removed (not this ticket's condition), and more than one means the
 * description is not a reliable match and guessing would risk renaming the wrong row.
 *
 * A file under the orphaned name itself is never a match, and its presence refuses self-heal
 * outright. That name was never renamed — checkOrder can also throw this shape of error when a
 * new migration is inserted with a timestamp earlier than one already applied (a genuine ordering
 * violation, `AGENTS.md`'s "must throw forever" case), and there the orphaned name's own file
 * still exists unchanged. Without this check, a lone same-description match on that unchanged
 * file self-matches, and self-heal "renames" the row to itself, disables `checkOrder` and lets
 * migrations apply out of order with no error.
 */
function findRenumberedMigrationName(orphanedName, migrationsDir) {
  const description = migrationDescription(orphanedName);
  if (!description) return null;

  const fileNames = fs.readdirSync(migrationsDir).map((fileName) => path.parse(fileName).name);
  if (fileNames.includes(orphanedName)) return null;

  const matches = fileNames.filter(
    (candidateName) => migrationDescription(candidateName) === description,
  );

  return matches.length === 1 ? matches[0] : null;
}

/**
 * Renames the stale row to the current filename so `getMigrationsToRun()` recognises it as
 * already applied. Takes a connected `pg` client rather than a connection string, so the caller
 * controls the connection's lifetime and this module never has to construct one.
 */
async function renameOrphanedMigrationRecord(client, migrationsTable, oldName, newName) {
  await client.query(`UPDATE ${migrationsTable} SET name = $1 WHERE name = $2`, [newName, oldName]);
}

module.exports = {
  isSelfHealEnabled,
  parseOrphanedMigrationName,
  findRenumberedMigrationName,
  renameOrphanedMigrationRecord,
};
