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

const { runner } = require('node-pg-migrate');

// Mirrors MigrateWithRetryAsync: 12 attempts, 2s backoff doubling to a 10s ceiling.
const MAX_ATTEMPTS = 12;
const INITIAL_DELAY_MS = 2000;
const MAX_DELAY_MS = 10000;

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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — the Deployment composes it from PROPERTY_DB_*.');
  }

  let delay = INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runner({
        databaseUrl,
        dir: 'migrations',
        direction: 'up',
        migrationsTable: 'pgmigrations',
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
