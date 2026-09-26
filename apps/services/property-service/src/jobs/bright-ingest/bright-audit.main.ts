/**
 * Program entry for the Bright `$count` audit (#328): `node bright-audit.js <city> [<city> ...]`.
 *
 * Run this by hand against a configured Bright tier — production or test, whichever
 * `BRIGHT_MLS_ENV`/`BRIGHT_MLS_CLIENT_ID`/`BRIGHT_MLS_CLIENT_SECRET` name (`config.ts`) — to measure
 * the gap between Bright's own count and our local read model's count, per city, across every
 * publicly searchable status. It never touches a consumer table (`no-consumer-writes.spec.ts`
 * covers this file the same as every other one in the directory) and never triggers the website's
 * on-demand loader: it is a read against Bright's `$count` endpoint and a read against Postgres,
 * nothing more.
 *
 * Bundled as its own webpack entry (`bright-audit`, see `webpack.config.js`) for the same reason
 * `bright-ingest.main.ts` and `seed-on-start.main.ts` are: nothing on the request-serving startup
 * path imports this file, so without its own entry it would never reach the runtime image.
 *
 * City list: positional CLI arguments, or `BRIGHT_AUDIT_CITIES` (comma-separated) if none are given.
 * Neither present is a usage error, not a silent no-op — an empty audit produces an empty table that
 * looks like ten cities of zero gap, which is a worse failure than refusing to run at all.
 */

import { closePool, getPool } from '../../db/pool';

import { countListingsByCityAndStatus } from '../../listings/repository';

import { loadListingStatuses } from '../bright-map/run';

import { type AuditStatus, formatAuditTable, runAudit } from './audit';
import { createTokenProvider, fetchCount } from './bright-client';
import { resolveBrightConfig } from './config';
import { buildAreaCountQuery } from './odata-query';

function resolveCities(argv: readonly string[], env: NodeJS.ProcessEnv): string[] {
  const positional = argv
    .slice(2)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  if (positional.length > 0) {
    return positional;
  }
  const fromEnv = (env.BRIGHT_AUDIT_CITIES ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return fromEnv;
}

/** The searchable status vocabulary the audit compares against, derived from `listing_statuses`. */
function toAuditStatuses(statuses: Awaited<ReturnType<typeof loadListingStatuses>>): AuditStatus[] {
  return statuses
    .filter((s) => s.isPubliclySearchable === true && s.resoStandardStatus !== null)
    .map((s) => ({ code: s.code, resoStandardStatus: s.resoStandardStatus as string }));
}

async function main(): Promise<void> {
  const cities = resolveCities(process.argv, process.env);
  if (cities.length === 0) {
    console.error(
      'No cities given. Pass one or more as CLI arguments, or set BRIGHT_AUDIT_CITIES ' +
        '(comma-separated).',
    );
    process.exitCode = 1;
    return;
  }

  const config = resolveBrightConfig();
  if (config.state !== 'configured') {
    console.error(
      `Bright MLS credentials are not configured: ${config.missing.join(', ')} unset or still the ` +
        'committed placeholder. See docs/bright-mls-day-one-checklist.md.',
    );
    process.exitCode = 1;
    return;
  }

  const pool = getPool();
  try {
    const statuses = toAuditStatuses(await loadListingStatuses(pool));
    if (statuses.length === 0) {
      console.error('No status in listing_statuses is publicly searchable. Nothing to audit.');
      process.exitCode = 1;
      return;
    }

    const tokenProvider = createTokenProvider(config.endpoint, config.credentials);

    const results = await runAudit(cities, statuses, {
      fetchBrightCount: (city, status) =>
        fetchCount(
          buildAreaCountQuery({
            serviceRoot: config.endpoint.serviceRoot,
            city,
            standardStatus: status.resoStandardStatus,
          }),
          tokenProvider,
          config.endpoint.serviceRootHost,
        ),
      fetchLocalCount: (city, status) =>
        countListingsByCityAndStatus(pool, { city, status: status.code }),
    });

    console.info(`Bright feed tier: ${config.feed}`);
    console.info(`Statuses: ${statuses.map((s) => s.code).join(', ')}`);
    console.info(formatAuditTable(results));
  } catch (error) {
    console.error(
      `Bright count audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Bright count audit crashed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
