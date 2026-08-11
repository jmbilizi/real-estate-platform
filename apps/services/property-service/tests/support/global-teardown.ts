import { killPort } from '@nx/node/utils';
import { closePool, getPool } from '../../src/db/pool';
import { removeComplianceFixtures } from './fixtures';
/* eslint-disable */

module.exports = async function () {
  // Put clean up logic here (e.g. stopping services, docker-compose, etc.).
  const port = process.env.PORT ? Number(process.env.PORT) : 3002;
  try {
    // Guarded the same way global-setup.ts guards the load, and on the same env var: teardown must
    // only ever touch a database it was explicitly told it's allowed to write to.
    if (process.env.PROPERTY_SERVICE_E2E_FIXTURES === '1') {
      await removeComplianceFixtures(getPool());
      await closePool();
    }
  } finally {
    // A fixture-removal failure must still tear the port down — leaving the service listening after
    // a failed run is what would make the NEXT run's `waitForPortOpen` silently answer from a stale
    // process instead of failing loudly.
    await killPort(port);
  }
  // Hint: `globalThis` is shared between setup and teardown.
  console.log(globalThis.__TEARDOWN_MESSAGE__);
};
