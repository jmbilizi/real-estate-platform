/**
 * Program entry for in-cluster seeding (#111). Bundled by webpack as `seed-on-start.js` alongside
 * `main.js` (see `webpack.config.js` → `additionalEntryPoints`) and spawned by `migrate.js` from
 * inside the `migrate` initContainer once migrations have applied.
 *
 * It is a separate file from `seed-on-start.ts` — rather than a `require.main === module` guard like
 * the one in `seed.ts` — because that guard does not hold inside a webpack bundle: every module is
 * wrapped, so `module` is webpack's object and the comparison is silently always false. A bundled
 * entry has to run its work unconditionally at top level, which is exactly what this file is for and
 * why it holds no decision logic of its own.
 *
 * `DATABASE_URL` is inherited from the initContainer's environment, assembled by the Deployment from
 * `postgres-svc` plus the `PROPERTY_SERVICE_DB_USER_PASSWORD` key of `postgres-secret` — the same
 * connection the migrations just used. No workstation credential step, and nothing new to wire.
 */

import { closePool, getPool } from '../db/pool';
import { seedOnStart } from './seed-on-start';

async function main(): Promise<void> {
  const pool = getPool();
  try {
    const outcome = await seedOnStart(pool);
    switch (outcome) {
      case 'seeded':
        // runSeed() already logged what it wrote.
        break;
      case 'skipped-populated':
        console.info('Seed skipped: listings already holds rows, so there is nothing to load.');
        break;
      case 'skipped-disabled':
        console.info('Seed skipped: PROPERTY_SERVICE_SEED_ON_START is not set to 1.');
        break;
    }
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error('Seed-on-start failed:', error);
  process.exitCode = 1;
});
