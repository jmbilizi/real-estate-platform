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
    // A page in flight is safe to abandon: its checkpoint commits with its mapping, or not at all.
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await waitForSchema(getPool(), log);
  await runWorker({ config, settings, log }, () => stopping);
}

main().catch((error: unknown) => {
  console.error('[bright-sync] Fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
