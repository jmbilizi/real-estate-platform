import { Queryable } from './write';

/**
 * Read/write access to `seed_state` — the record of which sample dataset a database already holds
 * (#111).
 *
 * Separate from `write.ts` because that module's containment rule is about `listings` specifically;
 * this table holds no inventory, only bookkeeping, and must survive the `is_sample` sweep a re-seed
 * performs.
 */

/** The `seed_state.key` under which the sample dataset's applied hash is recorded. */
export const SEED_DATASET_KEY = 'sample-dataset';

/** The hash last applied under `key`, or null when this database has never been seeded. */
export async function readAppliedHash(
  client: Queryable,
  key = SEED_DATASET_KEY,
): Promise<string | null> {
  const { rows } = await client.query('SELECT applied_hash FROM seed_state WHERE key = $1', [key]);
  const appliedHash = rows[0]?.applied_hash;
  return typeof appliedHash === 'string' ? appliedHash : null;
}

/**
 * Records the hash just applied. Called inside the seeding transaction, so a rolled-back seed leaves
 * no claim that it succeeded.
 */
export async function recordAppliedHash(
  client: Queryable,
  hash: string,
  key = SEED_DATASET_KEY,
): Promise<void> {
  await client.query(
    // `applied_at` takes its column default on insert and is advanced explicitly on conflict — a
    // `now()` literal inside the VALUES list would consume no placeholder and silently shift every
    // later column out of step with its bound value.
    `INSERT INTO seed_state (key, applied_hash)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET applied_hash = EXCLUDED.applied_hash,
                                     applied_at = now()`,
    [key, hash],
  );
}
