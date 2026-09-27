/**
 * Program entry for the `bright-sync-worker` Deployment (#338): `node bright-sync-worker.js`.
 *
 * A separate file because `require.main === module` is always false inside a webpack bundle. An
 * unconfigured environment idles instead of exiting, so the Deployment does not crash-loop over an
 * expected state. Provisioning the credential needs a pod restart.
 */

import { getPool } from '../../db/pool';
import { resolveActiveConfig, resolveWorkerSettings, runWorker, waitForSchema } from './worker';

const log = (message: string): void => console.info(`[bright-sync] ${message}`);

async function main(): Promise<void> {
  const settings = resolveWorkerSettings(process.env);
  const config = resolveActiveConfig(process.env, log);
  if (config === null) {
    // Idle. The timer keeps the event loop alive until the pod stops.
    setInterval(() => undefined, 60 * 60 * 1000);
    return;
  }
  let stopping = false;
  const stop = (): void => {
    stopping = true;
    log('Stop signal received. Exiting.');
    // A page in flight is safe to abandon: a restart re-applies it, which the upserts make a no-op
    // past whatever already committed (#359).
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // +6 headroom over `applyConcurrency` (#359): the lock connection held for the worker's life, and
  // a couple of overlapping staging/mapping connections at the moment concurrent applies hand off
  // between them. Postgres defaults to 100 `max_connections`, so this is nowhere near the ceiling.
  //
  // `statement_timeout: 0` (#388) opts out of the API's default 4 s cap: a bulk page apply can
  // legitimately run longer, and this pool is never shared with the API process.
  getPool({ max: settings.applyConcurrency + 6, statement_timeout: 0 });
  await waitForSchema(getPool(), log);
  await runWorker({ config, settings, log }, () => stopping);
}

main().catch((error: unknown) => {
  console.error('[bright-sync] Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
