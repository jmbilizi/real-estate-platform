/**
 * The probe sweep (#715). Reconcile infers absence from a full key read and misses a key that
 * Bright dropped without a status change. The sweep asks Bright about every live local key
 * directly, in `ListingKey in (...)` batches, and takes down what Bright no longer lists live.
 *
 * Bright rejects a batched `or` filter. `in` works.
 *
 * A key comes down only on positive evidence from a complete answer:
 * - Bright returned the key in a status that search does not show, or
 * - a complete batch answer omitted the key, and a read of that key alone omitted it too.
 * A failed, truncated or malformed answer never counts as absence. The run skips the batch and
 * counts it as an error.
 */

import type { BrightPage } from '../bright-ingest/bright-client';
import type { ListingStatusLookup } from '../bright-map/status';
import { mapStandardStatus } from '../bright-map/status';

import { listingKeyOf } from './sync';

/** Keys per request. 100 quoted keys stay near 2 KB of URL. */
export const PROBE_BATCH_SIZE = 100;

/** Most keys one run takes down. Above it, the run takes down nothing and aborts. */
export const PROBE_DEFAULT_MAX_TAKEDOWN = 500;

export interface ProbeDeps {
  readonly serviceRoot: string;
  readonly fetchPage: (url: string) => Promise<BrightPage>;
  /** Local live Bright listings that search shows: key to listing id. */
  readonly listLive: () => Promise<Map<string, string>>;
  /** Marks the listings Off Market through `markListingsOffMarket`. Returns the count changed. */
  readonly takeDown: (listingIds: readonly string[], reason: string) => Promise<number>;
  readonly statuses: readonly ListingStatusLookup[];
  /** Batches read at once. */
  readonly concurrency?: number;
  readonly batchSize?: number;
  readonly log: (message: string) => void;
}

export interface ProbeOptions {
  readonly maxTakedown: number;
}

export interface ProbeReport extends Record<string, unknown> {
  readonly checked: number;
  readonly kept: number;
  readonly takenDown: number;
  readonly errors: number;
  readonly aborted: boolean;
  readonly candidates: number;
  readonly brightRequests: number;
}

type Verdict = 'keep' | 'gone' | 'unknown';

/**
 * Search shows the key only for a searchable, non-terminal status. A named status outside the
 * vocabulary is not live, the same rule `applyPage` uses. A missing status is no answer.
 */
function verdictFor(status: unknown, statuses: readonly ListingStatusLookup[]): Verdict {
  if (typeof status !== 'string' || status.trim() === '') return 'unknown';
  const mapped = mapStandardStatus(status, statuses);
  if (mapped === null || mapped.isTerminal) return 'gone';
  const lookup = statuses.find((s) => s.code === mapped.code);
  return lookup?.isPubliclySearchable === true ? 'keep' : 'gone';
}

function probeUrl(serviceRoot: string, keys: readonly string[]): string {
  const search = new URLSearchParams();
  // `ListingKey` is `Edm.Int64`. A quoted key is a 400 (measured on production, 2026-10-08).
  search.set('$filter', `ListingKey in (${keys.join(',')})`);
  search.set('$select', 'ListingKey,StandardStatus');
  search.set('$top', String(keys.length));
  search.set('$count', 'true');
  return `${serviceRoot.replace(/\/+$/, '')}/BrightProperties?${search.toString()}`;
}

/**
 * Reads one batch: key to verdict for each key Bright answered. Throws unless the answer is
 * complete. Complete means no next page, no more records than keys, every record a requested key,
 * and `@odata.count` equal to the record count when Bright sends it.
 */
async function readBatch(deps: ProbeDeps, keys: readonly string[]): Promise<Map<string, Verdict>> {
  const page = await deps.fetchPage(probeUrl(deps.serviceRoot, keys));
  if (page.nextLink !== null) throw new Error('Bright answered a probe with a next page.');
  if (page.count !== undefined && page.count !== page.records.length) {
    throw new Error(`Bright counted ${page.count} but returned ${page.records.length} records.`);
  }
  if (page.records.length > keys.length) {
    throw new Error(`Bright returned ${page.records.length} records for ${keys.length} keys.`);
  }
  const wanted = new Set(keys);
  const answered = new Map<string, Verdict>();
  for (const record of page.records) {
    const key = listingKeyOf(record);
    if (!wanted.has(key)) throw new Error(`Bright returned unrequested key ${key}.`);
    answered.set(key, verdictFor(record.StandardStatus, deps.statuses));
  }
  return answered;
}

async function mapLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await work(items[index] as T);
    }
  });
  await Promise.all(lanes);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function runProbeSweep(deps: ProbeDeps, options: ProbeOptions): Promise<ProbeReport> {
  const live = await deps.listLive();
  // A key that is not all digits cannot go into the filter safely. It stays live.
  const keys = [...live.keys()].filter((key) => /^\d+$/.test(key));
  let errors = live.size - keys.length;
  const size = deps.batchSize ?? PROBE_BATCH_SIZE;
  const batches: string[][] = [];
  for (let start = 0; start < keys.length; start += size) {
    batches.push(keys.slice(start, start + size));
  }

  let requests = 0;
  let kept = 0;
  const gone = new Set<string>();
  const absent: string[] = [];

  await mapLimited(batches, deps.concurrency ?? 1, async (batch) => {
    try {
      requests += 1;
      const answered = await readBatch(deps, batch);
      for (const key of batch) {
        const verdict = answered.get(key);
        if (verdict === undefined) absent.push(key);
        else if (verdict === 'keep') kept += 1;
        else if (verdict === 'gone') gone.add(key);
        else errors += 1;
      }
    } catch (error) {
      errors += batch.length;
      deps.log(`Bright probe: batch of ${batch.length} failed, left live: ${messageOf(error)}`);
    }
  });

  if (keys.length > 0 && kept + gone.size + absent.length === 0) {
    throw new Error(`Bright probe: every batch failed (${errors} keys unchecked).`);
  }

  const abort = (candidates: number): ProbeReport => {
    deps.log(
      `Bright probe: ABORT. ${candidates} listing(s) would come down, above the cap of ` +
        `${options.maxTakedown}. Checked ${keys.length}, kept ${kept}, errors ${errors}. ` +
        'Nothing was taken down.',
    );
    return {
      checked: keys.length,
      kept,
      takenDown: 0,
      errors,
      aborted: true,
      candidates,
      brightRequests: requests,
    };
  };
  if (gone.size + absent.length > options.maxTakedown) return abort(gone.size + absent.length);

  // A batch omission counts only after a read of the key alone omits it too.
  await mapLimited(absent, deps.concurrency ?? 1, async (key) => {
    try {
      requests += 1;
      const verdict = (await readBatch(deps, [key])).get(key);
      if (verdict === 'keep') kept += 1;
      else if (verdict === undefined || verdict === 'gone') gone.add(key);
      else errors += 1;
    } catch (error) {
      errors += 1;
      deps.log(`Bright probe: single read of ${key} failed, left live: ${messageOf(error)}`);
    }
  });
  const candidates = gone.size;
  if (candidates > options.maxTakedown) return abort(candidates);

  const ids = [...gone].map((key) => live.get(key) as string);
  const takenDown = await deps.takeDown(ids, 'Bright probe sweep: no longer live on Bright');
  deps.log(
    `Bright probe: checked ${keys.length}, kept ${kept}, taken down ${takenDown}, ` +
      `errors ${errors}, aborted no.`,
  );
  return {
    checked: keys.length,
    kept,
    takenDown,
    errors,
    aborted: false,
    candidates,
    brightRequests: requests,
  };
}
