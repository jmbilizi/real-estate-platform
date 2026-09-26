import type { AreaSyncRow, AreaSyncStatus } from './area-coverage-store';

/**
 * Pure coverage decisions over a `bright_area_sync` read (#329). Kept apart from the DB seam
 * (`area-coverage-store.ts`) and the Bright/`AreaLoader` wiring (`on-demand.ts`) so both can be
 * unit-tested without a pool or a fetch fake.
 */

/** True once every currently searchable status has a `complete` row on record. */
export function isAreaComplete(
  rows: ReadonlyMap<string, AreaSyncRow>,
  searchableStatuses: readonly string[],
): boolean {
  return searchableStatuses.every((status) => rows.get(status)?.status === 'complete');
}

/**
 * True when a complete area's oldest `synced_at`, across the currently searchable statuses, is
 * older than `freshnessMs`. Meaningless (and never called) when the area is not complete: a
 * missing or partial status already needs a load regardless of how recently it was attempted.
 */
function isStale(
  rows: ReadonlyMap<string, AreaSyncRow>,
  searchableStatuses: readonly string[],
  freshnessMs: number,
  nowMs: number,
): boolean {
  const syncedTimes = searchableStatuses.map(
    (status) => rows.get(status)?.syncedAt?.getTime() ?? 0,
  );
  const oldest = Math.min(...syncedTimes);
  return nowMs - oldest > freshnessMs;
}

/** The trigger condition routes.ts acts on: missing, not complete, or stale. */
export function needsAreaLoad(
  rows: ReadonlyMap<string, AreaSyncRow>,
  searchableStatuses: readonly string[],
  freshnessMs: number,
  nowMs: number,
): boolean {
  if (searchableStatuses.length === 0) {
    return false;
  }
  if (!isAreaComplete(rows, searchableStatuses)) {
    return true;
  }
  return isStale(rows, searchableStatuses, freshnessMs, nowMs);
}

function cooldownFor(status: AreaSyncStatus, cooldownMs: number, failedCooldownMs: number): number {
  return status === 'failed' ? failedCooldownMs : cooldownMs;
}

/**
 * The next status a load should work on: the first, in `searchableStatuses` order (Bright
 * `listing_statuses.sort_order`, `Closed` last), that has no row at all or whose cooldown has
 * elapsed. A status that is `complete`, or still cooling down, is skipped — not a stopping point —
 * so a busy or cooling-down status earlier in the order (a large `Active` backlog, say) can never
 * block progress on one later in it, `Closed` included (#329). `null` means nothing is pickable
 * this call: every status is complete, or every incomplete one is still cooling down.
 *
 * A `failed` row uses the shorter `failedCooldownMs`, not the full `cooldownMs`: a transient
 * error must not block the next search from retrying for a whole hour (#329).
 */
export function pickNextStatus(
  searchableStatuses: readonly string[],
  rows: ReadonlyMap<string, AreaSyncRow>,
  nowMs: number,
  cooldownMs: number,
  failedCooldownMs: number,
): string | null {
  for (const status of searchableStatuses) {
    const row = rows.get(status);
    if (row === undefined) {
      return status;
    }
    if (row.status === 'complete') {
      continue;
    }
    if (
      nowMs - row.attemptedAt.getTime() >=
      cooldownFor(row.status, cooldownMs, failedCooldownMs)
    ) {
      return status;
    }
  }
  return null;
}
