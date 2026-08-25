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
 *  3. SOMETHING TO DO. Either `listings` is empty (first run), or the dataset has changed since the
 *     hash recorded in `seed_state` (`src/db/seed-state.ts`). Neither is ever the sole trigger — a
 *     fresh production `property_db` is empty by definition, and emptiness alone would self-populate
 *     it with fabricated listings.
 *
 * WHY A CHANGED DATASET IS A DESTRUCTIVE RE-APPLY, not an upsert. A listing REMOVED from
 * `mock-listings.ts` has to actually disappear, and no upsert expresses that. Worse, an insert-only
 * second pass does not merely fail to remove things: `seed.ts` mints a fresh `randomUUID()` per row
 * and the `listings` INSERT has no `ON CONFLICT` target (the table's only unique index is partial on
 * `source_listing_key IS NOT NULL`, which seeded rows leave NULL), so it silently duplicates the
 * entire dataset. So a re-apply deletes every `is_sample` row first, in the same transaction — see
 * `deleteSampleData()` in `src/db/write.ts`, where every statement is scoped on `is_sample = true`
 * and the durable rows are spared if any real listing still references them.
 *
 * That destructiveness is why the gate above is a safety interlock rather than a convenience. An
 * unchanged dataset is a true no-op: nothing is deleted, nothing is written, no transaction opens.
 *
 * There is no second write path here: `runSeed()` is reused, and `src/db/write.ts` remains the only
 * module that writes `listings` (asserted by `seed.spec.ts`, for DELETE as well as INSERT/UPDATE).
 */

import { readAppliedHash } from '../db/seed-state';
import { Queryable } from '../db/write';
import { computeDatasetHash } from './dataset-hash';
import { runSeed, SeedConnectable } from './seed';

export type SeedOnStartOutcome = 'skipped-disabled' | 'skipped-current' | 'seeded' | 'reseeded';

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
 * Runs the sample-data seed when the conditions hold, and reports what it decided otherwise.
 * Accepts anything exposing `.connect()` so it is exercisable against a fake pool.
 *
 * The probe runs on its own short-lived connection and writes nothing. Only once it has established
 * that there IS work to do does `runSeed()` open the transaction that deletes and inserts.
 */
export async function seedOnStart(
  pool: SeedConnectable,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SeedOnStartOutcome> {
  if (!isSeedOnStartEnabled(env)) {
    return 'skipped-disabled';
  }

  const datasetHash = computeDatasetHash();

  const client = await pool.connect();
  let empty: boolean;
  let appliedHash: string | null;
  try {
    empty = await isListingsTableEmpty(client);
    appliedHash = await readAppliedHash(client);
  } finally {
    client.release();
  }

  if (empty) {
    await runSeed(pool, { datasetHash });
    return 'seeded';
  }

  if (appliedHash === datasetHash) {
    return 'skipped-current';
  }

  await runSeed(pool, { replaceExistingSampleData: true, datasetHash });
  return 'reseeded';
}
