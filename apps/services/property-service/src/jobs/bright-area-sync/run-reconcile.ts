/**
 * Orchestrates the daily key reconciliation (#331): for each tracked area, reads the live
 * `ListingKey` set across every tracked status, then soft-deletes local listings absent from it.
 *
 * Grouped by area (not by area+status) so the diff can take the UNION of every tracked status's
 * live keys before deciding a key is gone — see `reconcile.ts` for why that is load-bearing. Every
 * Bright/DB call is injected; `run-reconcile.spec.ts` drives this with plain fakes.
 */

import type { Area } from '../../listings/on-demand';
import type { TrackedArea } from '../../listings/area-coverage-store';
import { type LocalBrightListing, staleListingIds } from './reconcile';

export interface LiveKeysResult {
  readonly listingKeys: readonly string[];
  /** False when the area+status pass was capped before reading every live record. */
  readonly complete: boolean;
}

export interface ReconcileDeps {
  readonly listTracked: () => Promise<TrackedArea[]>;
  readonly parseArea: (areaKey: string) => Area;
  readonly fetchLiveKeys: (params: { area: Area; sourceStatus: string }) => Promise<LiveKeysResult>;
  /** `listing_statuses.reso_standard_status` -> `listing_statuses.code`; `null` for no match. */
  readonly wireToLocalCode: (wireStatus: string) => string | null;
  readonly listLocal: (params: {
    area: Area;
    statusCodes: readonly string[];
  }) => Promise<readonly LocalBrightListing[]>;
  readonly softDelete: (listingIds: readonly string[], reason: string) => Promise<number>;
  readonly log: (message: string) => void;
  readonly now: () => number;
}

export interface ReconcileRunReport {
  readonly areasChecked: number;
  readonly areasSkippedIncomplete: number;
  readonly listingsSoftDeleted: number;
}

function groupByArea(rows: readonly TrackedArea[]): Map<string, TrackedArea[]> {
  const groups = new Map<string, TrackedArea[]>();
  for (const row of rows) {
    const group = groups.get(row.areaKey);
    if (group === undefined) {
      groups.set(row.areaKey, [row]);
    } else {
      group.push(row);
    }
  }
  return groups;
}

export async function runAreaReconcile(deps: ReconcileDeps): Promise<ReconcileRunReport> {
  const rows = await deps.listTracked();
  const groups = groupByArea(rows);

  let areasChecked = 0;
  let areasSkippedIncomplete = 0;
  let listingsSoftDeleted = 0;
  const reconciledAt = new Date(deps.now()).toISOString();

  for (const [areaKey, statuses] of groups) {
    const area = deps.parseArea(areaKey);
    const liveKeys = new Set<string>();
    let incomplete = false;

    for (const status of statuses) {
      const result = await deps.fetchLiveKeys({ area, sourceStatus: status.sourceStatus });
      if (!result.complete) {
        incomplete = true;
        break;
      }
      for (const key of result.listingKeys) {
        liveKeys.add(key);
      }
    }

    if (incomplete) {
      areasSkippedIncomplete += 1;
      deps.log(
        `Bright area reconciliation for ${areaKey}: a status's live key read was capped, ` +
          'skipping this area rather than risking a false delete. Retrying next run.',
      );
      continue;
    }

    const statusCodes = statuses
      .map((status) => deps.wireToLocalCode(status.sourceStatus))
      .filter((code): code is string => code !== null);
    const local = await deps.listLocal({ area, statusCodes });
    const staleIds = staleListingIds(liveKeys, local);

    areasChecked += 1;
    if (staleIds.length > 0) {
      const deleted = await deps.softDelete(
        staleIds,
        `Bright reconciliation ${reconciledAt}: absent from Bright's live key set for ${areaKey}.`,
      );
      listingsSoftDeleted += deleted;
      deps.log(`Bright area reconciliation for ${areaKey}: soft-deleted ${deleted} listing(s).`);
    }
  }

  return { areasChecked, areasSkippedIncomplete, listingsSoftDeleted };
}
