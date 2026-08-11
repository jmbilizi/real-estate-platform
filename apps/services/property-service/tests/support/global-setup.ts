import { waitForPortOpen } from '@nx/node/utils';
import { closePool, getPool } from '../../src/db/pool';
import { loadComplianceFixtures } from './fixtures';

/* eslint-disable */
// `__TEARDOWN_MESSAGE__` is typed in ./globals.d.ts.

module.exports = async function () {
  // Start services that the app needs to run (e.g. database, docker-compose, etc.).
  console.log('\nSetting up...\n');

  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ? Number(process.env.PORT) : 3002;
  await waitForPortOpen(port, { host });

  // Guarded compliance fixtures (#22): the seed dataset alone has zero suppressed addresses, zero
  // suppressed listings, zero unapproved descriptions, zero non-consumer statuses, zero `Land` rows
  // and zero NULL beds/baths/sqft, so without these every compliance assertion the e2e suite makes
  // would be vacuously true. Loading is opt-in (`PROPERTY_SERVICE_E2E_FIXTURES=1`) because this talks
  // directly to whatever `DATABASE_URL` points at.
  //
  // `globalSetup` runs once in Jest's PARENT process, BEFORE it forks the workers that actually run
  // `tests/**/*.e2e.spec.ts`. A `process.env` mutation made here is inherited by every forked worker,
  // because each worker's env is a copy taken at fork time — after this function has already run.
  // `globalThis`, by contrast, is NOT shared with the workers (they are separate processes, not
  // threads), which is why `__TEARDOWN_MESSAGE__` below only ever needs to reach `global-teardown.ts`
  // — that runs back in THIS SAME parent process, never inside a worker. Fixture ids therefore have to
  // cross via `process.env`, not `globalThis`, or spec files would never see them.
  if (process.env.PROPERTY_SERVICE_E2E_FIXTURES === '1') {
    const pool = getPool();
    try {
      const fixtureIds = await loadComplianceFixtures(pool);
      process.env.PROPERTY_SERVICE_E2E_FIXTURE_IDS = JSON.stringify(fixtureIds);
    } finally {
      await closePool();
    }
  }

  // Hint: Use `globalThis` to pass variables to global teardown.
  globalThis.__TEARDOWN_MESSAGE__ = '\nTearing down...\n';
};
