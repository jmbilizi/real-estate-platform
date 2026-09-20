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
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { runner } = require('node-pg-migrate');
const {
  isSelfHealEnabled,
  parseOrphanedMigrationName,
  findRenumberedMigrationName,
  renameOrphanedMigrationRecord,
} = require('./migrate-self-heal');

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

/**
 * Sample-data seeding for the environments that opt in (#111), run here rather than on a
 * workstation: this container already holds the database host, the user and the secret, so there is
 * no port-forward and no credential to reconstruct by hand.
 *
 * A child process rather than a `require`, for two reasons. `seed-on-start.js` is a webpack bundle
 * whose work happens at top level, so requiring it would start async work this function could not
 * await and whose failure would surface as an unhandled rejection. Spawning gives an exit code, and
 * a non-zero one fails the initContainer — a seed that half-ran must not be reported as a clean
 * migrate.
 *
 * The flag is checked twice on purpose, and the two checks are not duplicates: this one is
 * deliberately the weaker (any non-empty value) and only decides whether to start a process at all,
 * so an environment that never opts in — `hetzner/test`, `hetzner/prod` — executes no seed code
 * whatsoever. `seed-on-start.ts` remains the authority: exactly `'1'`, never under
 * NODE_ENV=production, and only into an empty `listings` table.
 */
function seedIfRequested() {
  if (!process.env.PROPERTY_SERVICE_SEED_ON_START) {
    return;
  }

  const result = spawnSync(process.execPath, ['seed-on-start.js'], {
    stdio: 'inherit',
    cwd: __dirname,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    // `status` is null when the child was killed by a signal (an OOM kill being the realistic case
    // here), so report the signal too rather than "status null".
    const cause = result.signal
      ? `killed by signal ${result.signal}`
      : `exited with status ${result.status}`;
    throw new Error(`Seeding failed: seed-on-start.js ${cause}.`);
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

  seedIfRequested();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
