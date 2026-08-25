/**
 * In-cluster seeding of `property_db` for the environments that want sample inventory (#111).
 *
 * This is the decision half only — `seed-on-start.main.ts` is the program that runs it, and
 * `migrate.js` (the `migrate` initContainer's entrypoint) is what invokes that program, immediately
 * after migrations and before any application container starts. Keeping it out of `src/main.ts` is
 * deliberate on two counts: a database round-trip before `listen()` delays the readiness probe, and
 * a per-pod trigger would race across replicas (`hetzner/test` runs 2, `hetzner/prod` runs 3).
 *
 * THREE CONDITIONS, and the flag is never the only one:
 *
 *  1. OPT-IN. `PROPERTY_SERVICE_SEED_ON_START` must be exactly `'1'`, mirroring
 *     `tests/support/fixtures.ts`'s `PROPERTY_SERVICE_E2E_FIXTURES`. It is set only in
 *     `infra/k8s/podman/local` and `infra/k8s/hetzner/dev`; `hetzner/test` and `hetzner/prod` never
 *     set it, so nothing here ever executes there.
 *  2. NOT PRODUCTION. `NODE_ENV=production` refuses independent of the flag. Note the ordering: an
 *     unset flag is a quiet skip, while the flag set *under* production throws, because that
 *     combination is a misconfiguration and must not be absorbed silently.
 *  3. EMPTY TABLE. Emptiness is a second condition, never the trigger — a fresh production
 *     `property_db` is empty by definition, and emptiness alone would self-populate it with
 *     fabricated listings.
 *
 * Re-running is a no-op by both conditions: a populated table short-circuits before any write, and
 * `runSeed()` itself is idempotent (`getOrCreateProperty()` / `upsertListing()` key on
 * `address_key`), so a partially-populated table cannot duplicate rows either.
 *
 * There is no second write path here: `runSeed()` is reused as-is, and `src/db/write.ts` remains the
 * only module that writes `listings` (asserted by `seed.spec.ts`).
 */

import { Queryable } from '../db/write';
import { runSeed, SeedConnectable } from './seed';

export type SeedOnStartOutcome = 'skipped-disabled' | 'skipped-populated' | 'seeded';

/**
 * Whether the caller has opted in to seeding. Throws — rather than returning false — when the opt-in
 * is present under `NODE_ENV=production`, so that misconfiguration fails the initContainer loudly
 * instead of quietly doing nothing and looking like it worked.
 */
export function isSeedOnStartEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const optedIn = env.PROPERTY_SERVICE_SEED_ON_START === '1';

  if (env.NODE_ENV === 'production') {
    if (optedIn) {
      throw new Error(
        'seedOnStart: refusing to seed with NODE_ENV=production, even though ' +
          'PROPERTY_SERVICE_SEED_ON_START=1. This path writes self-labelled sample inventory into ' +
          'whatever database DATABASE_URL points at, and must never touch a production one. The ' +
          'flag belongs only in infra/k8s/podman/local and infra/k8s/hetzner/dev.',
      );
    }
    return false;
  }

  return optedIn;
}

/** True when `listings` holds no rows at all. Deliberately not a COUNT — existence is the question. */
export async function isListingsTableEmpty(client: Queryable): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM listings LIMIT 1');
  return rows.length === 0;
}

/**
 * Runs the sample-data seed when all three conditions hold, and reports which one stopped it
 * otherwise. Accepts anything exposing `.connect()` so it is exercisable against a fake pool.
 */
export async function seedOnStart(
  pool: SeedConnectable,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedOnStartOutcome> {
  if (!isSeedOnStartEnabled(env)) {
    return 'skipped-disabled';
  }

  const client = await pool.connect();
  let empty: boolean;
  try {
    empty = await isListingsTableEmpty(client);
  } finally {
    client.release();
  }

  if (!empty) {
    return 'skipped-populated';
  }

  await runSeed(pool);
  return 'seeded';
}
