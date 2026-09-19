/**
 * Program entry for the Bright MLS ingestion job (#91). Bundled by webpack as `bright-ingest.js`
 * alongside `main.js` (see `webpack.config.js` → `additionalEntryPoints`) and invoked by the
 * `bright-mls-ingest` CronJob as `node bright-ingest.js`.
 *
 * A separate file from `run.ts` — rather than a `require.main === module` guard — because that guard
 * does not hold inside a webpack bundle: every module is wrapped, so `module` is webpack's own object
 * and the comparison is silently always false. A bundled entry has to do its work unconditionally at
 * top level, which is why this file holds no decision logic.
 *
 * `runBrightIngest()` never throws, so the only thing left here is the exit code, and it carries a
 * real distinction:
 *
 *   - `not_configured` → **0**. Expected in an environment that waits on #117. Failing here would
 *     make the CronJob retry and back off over a condition that is not a fault, burying real
 *     failures in noise.
 *   - `replicated` → **0**. Staging was written. A capped run is still a success: the cursor moved,
 *     and the next scheduled run continues from it.
 *   - `failed` → **1**. Something present was unusable, or Bright refused us. The CronJob's
 *     `backoffLimit` bounds the retries so this surfaces as a failed Job, never a crash loop.
 *
 * The pool is closed on every path. `runBrightIngest` opens one to write staging, and an open pool
 * keeps the event loop alive — the pod would sit at "finished" until `activeDeadlineSeconds` killed
 * it, which reads as a hung run rather than a completed one.
 */

import { closePool } from '../../db/pool';

import { runBrightIngest } from './run';

runBrightIngest()
  .then((result) => {
    process.exitCode = result.outcome === 'failed' ? 1 : 0;
  })
  .catch((error: unknown) => {
    // Unreachable by contract; kept so an unforeseen throw is still a legible, non-zero exit rather
    // than an unhandled rejection whose message depends on the Node version.
    console.error(
      JSON.stringify({
        job: 'bright-mls-ingest',
        event: 'run_crashed',
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  // `.catch` AFTER `.finally`: a pool that fails to drain would otherwise reject with nothing
  // attached, and Node 20 turns an unhandled rejection into a crash — converting a successful run
  // that has already set exit 0 into ERR_UNHANDLED_REJECTION.
  .finally(() => closePool())
  .catch((error: unknown) => {
    console.error(
      JSON.stringify({
        job: 'bright-mls-ingest',
        event: 'pool_close_failed',
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
