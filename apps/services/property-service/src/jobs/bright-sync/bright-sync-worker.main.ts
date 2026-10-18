/**
 * Program entry for the `bright-sync-worker` Deployment (#338): `node bright-sync-worker.js`.
 *
 * A separate file because `require.main === module` is always false inside a webpack bundle. An
 * unconfigured environment idles instead of exiting, so the Deployment does not crash-loop over an
 * expected state. Provisioning the credential needs a pod restart.
 */

import { getPool } from '../../db/pool';
import {
  resolveActiveConfig,
  resolveWorkerPoolConfig,
  resolveWorkerSettings,
  runWorker,
  waitForSchema,
} from './worker';

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
  // At most 4 connections and a 60 s statement cap (#954), so the sync cannot starve the API on the
  // shared role. The cap replaces the API's 4 s default (#388), which a bulk apply can exceed.
  getPool(resolveWorkerPoolConfig(process.env));
  await waitForSchema(getPool(), log);
  await runWorker({ config, settings, log }, () => stopping);
}

main().catch((error: unknown) => {
  console.error('[bright-sync] Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
