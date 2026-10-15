/**
 * Local-only check of the `pgmigrations` history against the migrations in the image (#303).
 *
 * The local cluster has one `property_db`. Every lane deploys into it, so two branches can write
 * one history. A row with no file is a migration from another branch. A file that is not
 * recorded, but sorts before the latest recorded file, is a gap that node-pg-migrate rejects.
 */

const fs = require('node:fs');
const path = require('node:path');

function listMigrationNames(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .map((fileName) => path.parse(fileName).name)
    .sort();
}

/**
 * `unexpected`: recorded names with no file in the image.
 * `missing`: file names that are not recorded although a later file is recorded.
 * Not-yet-applied files after the latest recorded one are normal pending work, never `missing`.
 */
function diffMigrationHistory(recordedNames, fileNames) {
  const files = new Set(fileNames);
  const recorded = new Set(recordedNames);
  const unexpected = recordedNames.filter((name) => !files.has(name)).sort();
  const knownRecorded = recordedNames.filter((name) => files.has(name)).sort();
  const latest = knownRecorded[knownRecorded.length - 1];
  const missing = latest
    ? [...files].filter((name) => name < latest && !recorded.has(name)).sort()
    : [];
  return { unexpected, missing };
}

function formatHistoryMismatch({ unexpected, missing }) {
  const lines = [
    'The pgmigrations history in property_db does not match the migrations in this image.',
    'The local cluster has one property_db. Another branch probably migrated it.',
  ];
  if (unexpected.length) {
    lines.push(`Recorded rows with no migration file: ${unexpected.join(', ')}`);
  }
  if (missing.length) {
    lines.push(
      `Migration files that are not recorded but sort before a recorded one: ${missing.join(', ')}`,
    );
  }
  lines.push(
    'Recovery: deploy the branch that wrote these rows, or discard the local data with',
    '`pnpm run infra:local:cluster:delete` then `pnpm run infra:local:cluster:setup`.',
    'The cluster is shared. Tell the other lanes before you discard it.',
  );
  return lines.join('\n');
}

async function readRecordedNames(client, migrationsTable) {
  const { rows } = await client.query(`SELECT name FROM ${migrationsTable} ORDER BY run_on, id`);
  return rows.map((row) => row.name);
}

module.exports = {
  listMigrationNames,
  diffMigrationHistory,
  formatHistoryMismatch,
  readRecordedNames,
};
