/**
 * Migration entry point for the container's `migrate` initContainer.
 *
 * This is the Node counterpart of account-service's `--migrate-only` path
 * (`apps/services/account-service/Program.cs` → `MigrateWithRetryAsync`), and it exists for
 * the same reason: nothing orders this Deployment after the postgres StatefulSet, so on a
 * cold cluster the first attempt loses the race. Retrying here — rather than gating on
 * postgres from the manifest — keeps the retry policy in one place per service and matches
 * how account-service already solves it.
 *
 * Plain CommonJS on purpose: it runs from the runtime image alongside `migrations/`, neither
 * of which is part of the webpack bundle.
 *
 * Local development uses the `migrate` Nx target (node-pg-migrate CLI + .env) instead, the
 * same way account-service devs use the EF Core CLI rather than this path.
 */

const path = require('node:path');
const { Client } = require('pg');
const { runner } = require('node-pg-migrate');
const {
  isSelfHealEnabled,
  parseOrphanedMigrationName,
  findRenumberedMigrationName,
  renameOrphanedMigrationRecord,
} = require('./migrate-self-heal');
const {
  listMigrationNames,
  diffMigrationHistory,
  formatHistoryMismatch,
  readRecordedNames,
} = require('./migrate-history');

// Mirrors MigrateWithRetryAsync: 12 attempts, 2s backoff doubling to a 10s ceiling.
const MAX_ATTEMPTS = 12;
const INITIAL_DELAY_MS = 2000;
const MAX_DELAY_MS = 10000;

const MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Bounds the local self-heal loop. One stale record is the observed case (#223); this allows a
// few more without risking an infinite loop if something else keeps reproducing the condition.
const MAX_SELF_HEAL_ATTEMPTS = 5;

/**
 * Transient startup failures only — anything else (bad SQL, a genuinely wrong credential)
 * must fail immediately rather than be masked by 12 retries. Mirrors
 * account-service's IsTransientDatabaseStartupFailure.
 */
function isTransientStartupFailure(error) {
  // TCP-level: postgres pod not scheduled yet, or not accepting connections.
  const socketCodes = [
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ECONNRESET',
  ];
  if (socketCodes.includes(error?.code)) return true;

  // Server responded, but is still initialising. node-postgres surfaces SQLSTATE as `code`.
  switch (error?.code) {
    // 3D000: database not yet created by init-databases.sh.
    case '3D000':
    // 42501: schema grants not yet applied (CREATE DATABASE / GRANT race).
    case '42501':
    // 28P01: password still being synced by the postgres postStart hook.
    case '28P01':
    // 57P03: server starting up and not yet accepting queries.
    case '57P03':
      return true;
    default:
      return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renames one stale `pgmigrations` row via a short-lived connection of its own, so the retry
 * loop's connection lifecycle stays untouched by this local-only path.
 */
async function healOrphanedMigrationRecord(databaseUrl, oldName, newName) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await renameOrphanedMigrationRecord(client, MIGRATIONS_TABLE, oldName, newName);
  } finally {
    await client.end();
  }
}

/**
 * Local only (#303). Names the cause when the recorded history does not match the image.
 * Returns null when the history matches or cannot be read.
 */
async function diagnoseHistory(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const recorded = await readRecordedNames(client, MIGRATIONS_TABLE);
    const diff = diffMigrationHistory(recorded, listMigrationNames(MIGRATIONS_DIR));
    return diff.unexpected.length || diff.missing.length ? formatHistoryMismatch(diff) : null;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Runs the transient-retry loop once. Throws whatever `runner()` throws once startup retries
 * are exhausted or the failure is not transient.
 *
 * `checkOrder` stays true until a rename happens: a renamed row keeps its ORIGINAL position in
 * run order (`ORDER BY run_on, id`), which no longer matches its position in the renumbered file
 * list once migrations were inserted between the old and new numbers. `getMigrationsToRun()`
 * decides what to apply purely by name membership, so disabling the position check after a
 * rename is what lets the genuinely-pending migrations run in file order without re-executing
 * the renamed one.
 */
async function attemptMigrations(databaseUrl, checkOrder) {
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runner({
        databaseUrl,
        dir: 'migrations',
        direction: 'up',
        migrationsTable: MIGRATIONS_TABLE,
        checkOrder,
      });
      console.info('Migrations completed successfully.');
      return;
    } catch (error) {
      if (!isTransientStartupFailure(error) || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      console.error(
        `Database not ready. Retrying ${attempt}/${MAX_ATTEMPTS} in ${delay / 1000}s. ${error.message}`,
      );
      await sleep(delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — the Deployment composes it from PROPERTY_DB_*.');
  }

  const selfHealAllowed = isSelfHealEnabled();
  let selfHealAttemptsLeft = selfHealAllowed ? MAX_SELF_HEAL_ATTEMPTS : 0;
  // checkOrder flips to false after the first rename and stays false — see attemptMigrations().
  let checkOrder = true;

  for (;;) {
    try {
      await attemptMigrations(databaseUrl, checkOrder);
      break;
    } catch (error) {
      const orphanedName = selfHealAttemptsLeft > 0 ? parseOrphanedMigrationName(error) : null;
      const newName = orphanedName
        ? findRenumberedMigrationName(orphanedName, MIGRATIONS_DIR)
        : null;
      // Only the exact "renamed migration, one unambiguous current file" condition self-heals.
      // Any other failure — including a genuine ordering problem, or an orphan whose migration
      // was truly removed rather than renumbered — rethrows untouched.
      if (!newName) {
        const mismatch = selfHealAllowed ? await diagnoseHistory(databaseUrl) : null;
        if (mismatch) {
          console.error(mismatch);
        }
        throw error;
      }
      console.warn(
        `Migration self-heal: "${orphanedName}" is recorded in ${MIGRATIONS_TABLE} but was ` +
          `renumbered to "${newName}" (local only). Renaming the record and retrying.`,
      );
      await healOrphanedMigrationRecord(databaseUrl, orphanedName, newName);
      checkOrder = false;
      selfHealAttemptsLeft -= 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
