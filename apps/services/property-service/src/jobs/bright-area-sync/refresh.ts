/**
 * Pure decision logic for the scheduled per-area freshness refresh (#331).
 *
 * `bright_area_sync` (#329) tracks one row per `(area_key, feed_tier, source_status)`. Once a row
 * reaches `complete`, nothing re-visits it: a listing that goes Pending, Sold, or Withdrawn at
 * Bright stays in its old status here, and the area silently drifts stale. This module decides
 * WHICH tracked areas are due for a bounded refresh; `run-refresh.ts` does the fetching and writing.
 *
 * Kept apart from the DB/HTTP seam for the same reason `area-coverage.ts` is: a decision this simple
 * should be testable with plain arrays, not a pool or a fetch fake.
 */

import type { TrackedArea } from '../../listings/area-coverage-store';

export interface RefreshWindow {
  readonly areaKey: string;
  readonly sourceStatus: string;
  /** `ModificationTimestamp gt this` — the area's last watermark, minus overlap. */
  readonly modifiedAfter: string;
  /** `ModificationTimestamp le this` — this run's start instant. */
  readonly modifiedUntil: string;
}

/**
 * A tracked area/status is due once `intervalMs` has passed since it last synced. The NAR IDX rule
 * requires a refresh at least every 12 hours; the CronJob schedule and `intervalMs` are both set
 * well under that so a missed or delayed run still leaves margin.
 *
 * `overlapMs` is subtracted from the stored `synced_at` to build `modifiedAfter`, so a record whose
 * `ModificationTimestamp` landed exactly on the previous watermark is read again rather than missed
 * by one instant. Bright's filter is `gt`, not `ge` (unlike the whole-feed cursor, this window is
 * also closed on the right by `modifiedUntil`, so re-reading the boundary costs one extra record,
 * not an unbounded re-scan), and the staging upsert makes the re-read free.
 *
 * Capped by `maxAreas` so one run's total Bright traffic stays bounded; the areas left over are
 * still overdue and are read first on the next run, since `listTrackedAreas()` has no ordering
 * guarantee of its own — `dueForRefresh` sorts by how overdue each row is, oldest first.
 */
export function dueForRefresh(
  rows: readonly TrackedArea[],
  nowMs: number,
  intervalMs: number,
  overlapMs: number,
  maxAreas: number,
): RefreshWindow[] {
  const modifiedUntil = new Date(nowMs).toISOString();
  return rows
    .filter((row) => nowMs - row.syncedAt.getTime() >= intervalMs)
    .sort((a, b) => a.syncedAt.getTime() - b.syncedAt.getTime())
    .slice(0, maxAreas)
    .map((row) => ({
      areaKey: row.areaKey,
      sourceStatus: row.sourceStatus,
      modifiedAfter: new Date(row.syncedAt.getTime() - overlapMs).toISOString(),
      modifiedUntil,
    }));
}
