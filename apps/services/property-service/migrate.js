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

const { spawnSync } = require('node:child_process');
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

  let delay = INITIAL_DELAY_MS;
  let migrated = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await runner({
        databaseUrl,
        dir: 'migrations',
        direction: 'up',
        migrationsTable: 'pgmigrations',
      });
      console.info('Migrations completed successfully.');
      // Outside the catch below on purpose: a seed failure is never a transient startup failure and
      // must not be fed back into the migration retry loop.
      migrated = true;
      break;
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

  // Unreachable: the loop either sets this or throws on its last attempt. Asserted rather than
  // assumed, because seeding an unmigrated database would fail in a far more confusing place.
  if (!migrated) {
    throw new Error('Migrations did not complete and no error was raised.');
  }

  seedIfRequested();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
