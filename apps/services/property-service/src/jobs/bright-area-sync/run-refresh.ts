/**
 * Orchestrates the scheduled per-area refresh (#331): decides which windows are due
 * (`dueForRefresh`), fetches each from Bright, maps what staged, and records success.
 *
 * Every Bright/DB/mapping call is injected, so `run-refresh.spec.ts` drives this with plain fakes.
 * The real wiring (`bright-area-sync.main.ts`) passes `fetchAreaListings`, `mapStagedBrightProperties`,
 * and `recordAreaRefresh` — the exact pieces #329/#330 already built for the on-demand loader.
 */

import type { Area } from '../../listings/on-demand';
import { dueForRefresh, type RefreshWindow } from './refresh';
import type { TrackedArea } from '../../listings/area-coverage-store';

export interface RefreshFetchResult {
  readonly listingKeys: readonly string[];
  /** True when the bounded window was read to its end within this call's record cap. */
  readonly complete: boolean;
}

export interface RefreshDeps {
  readonly listTracked: () => Promise<TrackedArea[]>;
  readonly parseArea: (areaKey: string) => Area;
  readonly fetchWindow: (params: {
    area: Area;
    sourceStatus: string;
    modifiedAfter: string;
    modifiedUntil: string;
  }) => Promise<RefreshFetchResult>;
  /** Maps the staged listing keys into the consumer schema; returns how many published. */
  readonly mapRecords: (listingKeys: readonly string[]) => Promise<{ published: number }>;
  readonly recordSuccess: (areaKey: string, sourceStatus: string, syncedAt: Date) => Promise<void>;
  readonly log: (message: string) => void;
  readonly now: () => number;
}

export interface RefreshOptions {
  /** How long a synced area is trusted before it is due again. Well under the 12h NAR IDX rule. */
  readonly intervalMs: number;
  /** Subtracted from the stored watermark so a record on the boundary is never skipped. */
  readonly overlapMs: number;
  /** Bounds one run's total Bright traffic. Areas left over are read first next run. */
  readonly maxAreasPerRun: number;
}

export interface RefreshRunReport {
  readonly areasDue: number;
  readonly refreshed: number;
  readonly capped: number;
  readonly failed: number;
  readonly recordsMapped: number;
}

export async function runAreaRefresh(
  deps: RefreshDeps,
  options: RefreshOptions,
): Promise<RefreshRunReport> {
  const rows = await deps.listTracked();
  const windows: readonly RefreshWindow[] = dueForRefresh(
    rows,
    deps.now(),
    options.intervalMs,
    options.overlapMs,
    options.maxAreasPerRun,
  );

  let refreshed = 0;
  let capped = 0;
  let failed = 0;
  let recordsMapped = 0;

  for (const window of windows) {
    const area = deps.parseArea(window.areaKey);
    try {
      const result = await deps.fetchWindow({
        area,
        sourceStatus: window.sourceStatus,
        modifiedAfter: window.modifiedAfter,
        modifiedUntil: window.modifiedUntil,
      });

      if (result.listingKeys.length > 0) {
        const mapping = await deps.mapRecords(result.listingKeys);
        recordsMapped += mapping.published;
      }

      if (result.complete) {
        await deps.recordSuccess(
          window.areaKey,
          window.sourceStatus,
          new Date(window.modifiedUntil),
        );
        refreshed += 1;
        deps.log(
          `Bright area refresh for ${window.areaKey} [${window.sourceStatus}]: ` +
            `${result.listingKeys.length} record(s) changed since the last sync.`,
        );
      } else {
        // Synced_at is left untouched: the same (now stale-by-more) window is retried next run,
        // rather than persisting a second resume cursor for what should be a small delta pass.
        capped += 1;
        deps.log(
          `Bright area refresh for ${window.areaKey} [${window.sourceStatus}] capped at the ` +
            'record limit; retrying the same window next run.',
        );
      }
    } catch (error) {
      failed += 1;
      deps.log(
        `Bright area refresh for ${window.areaKey} [${window.sourceStatus}] failed: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { areasDue: windows.length, refreshed, capped, failed, recordsMapped };
}
