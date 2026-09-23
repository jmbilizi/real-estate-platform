import { deleteSampleData, type Queryable } from '../../db/write';

import type { BrightFeedTier } from './sample';

/**
 * Sweeps the OTHER Bright feed tier's leftovers before a run replicates under a switched tier
 * (#314): the other tier's staging rows, its cursors, and every `is_sample = true` listing.
 *
 * Lives here, not in `bright-ingest/`, because it calls `db/write.ts`, which that directory's
 * structural guard forbids importing. See the ticket for the full rationale.
 */

interface CountingQueryable extends Queryable {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export interface SweepReport {
  /** False when every staged row already carries the current tier. Nothing was deleted. */
  readonly swept: boolean;
  /** Feed tier value(s) found on rows that were not the current tier. */
  readonly otherTiers: readonly string[];
  readonly stagingRowsDeleted: number;
  readonly cursorRowsDeleted: number;
  readonly sampleListingsDeleted: number;
}

export const ZERO_SWEEP_REPORT: SweepReport = {
  swept: false,
  otherTiers: [],
  stagingRowsDeleted: 0,
  cursorRowsDeleted: 0,
  sampleListingsDeleted: 0,
};

async function otherTiersPresent(
  client: CountingQueryable,
  currentTier: BrightFeedTier,
): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT feed_tier FROM bright_staging_records WHERE feed_tier != $1
     UNION
     SELECT feed_tier FROM bright_replication_cursor WHERE feed_tier != $1`,
    [currentTier],
  );
  return rows.map((row) => String(row.feed_tier));
}

/** Rows currently marked `is_sample = true`, counted before `deleteSampleData()` removes them. */
async function countSampleListings(client: CountingQueryable): Promise<number> {
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM listings WHERE is_sample = true',
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Sweeps the other tier's staging rows, cursors, and every sample-marked listing, if any exist.
 *
 * A no-op, reported as `swept: false`, when every staged row already carries `currentTier` — the
 * common case on every run once a tier switch has been swept once.
 */
export async function sweepOtherFeedTiers(
  client: CountingQueryable,
  currentTier: BrightFeedTier,
): Promise<SweepReport> {
  const otherTiers = await otherTiersPresent(client, currentTier);
  if (otherTiers.length === 0) {
    return ZERO_SWEEP_REPORT;
  }

  await client.query('BEGIN');
  try {
    const sampleListingsDeleted = await countSampleListings(client);
    // db/write.ts stays the only module that writes `listings`; this only counts and calls it.
    await deleteSampleData(client);

    const staging = await client.query('DELETE FROM bright_staging_records WHERE feed_tier != $1', [
      currentTier,
    ]);
    const cursors = await client.query(
      'DELETE FROM bright_replication_cursor WHERE feed_tier != $1',
      [currentTier],
    );

    await client.query('COMMIT');
    return {
      swept: true,
      otherTiers,
      stagingRowsDeleted: staging.rowCount ?? 0,
      cursorRowsDeleted: cursors.rowCount ?? 0,
      sampleListingsDeleted,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
