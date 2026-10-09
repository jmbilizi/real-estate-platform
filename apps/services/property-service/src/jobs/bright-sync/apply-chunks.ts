import type { PageResult } from './sync';

/**
 * #755. The sync writes through short transactions and rests between them.
 *
 * One slice holds up to 5,000 records. Written as one transaction, a slice keeps the database busy
 * for seconds, and the API reads that share the same database slow past the gateway timeout. A
 * full backfill (the `$select` fingerprint reset, #743) is hundreds of such slices in a row.
 *
 * Two limits keep the writer from starving reads:
 *  - a chunk is a small transaction, so each commit is short and each lock is brief;
 *  - after every chunk the writer rests for `paceRatio` times the chunk's own duration. A ratio of 1
 *    keeps the writer to half of one connection's time, 2 to a third.
 */
export interface ApplyChunkOptions {
  /** Records per transaction. At least 1. */
  readonly chunkSize: number;
  /** Rest after a chunk, as a multiple of the chunk's duration. 0 turns the rest off. */
  readonly paceRatio: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/** The longest single rest, so a stalled chunk cannot park the writer for minutes. */
export const MAX_PACE_REST_MS = 10_000;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function addCounts(
  target: Record<string, number>,
  source: Readonly<Record<string, number>> | undefined,
): void {
  for (const [key, count] of Object.entries(source ?? {})) {
    target[key] = (target[key] ?? 0) + count;
  }
}

/** Adds the counts of several chunk results into one page result. */
export function mergePageResults(results: readonly PageResult[]): PageResult {
  const withheldByReason: Record<string, number> = {};
  const suppressedByFlag: Record<string, number> = {};
  const suppressionAnomalies: Record<string, number> = {};
  let staged = 0;
  let mapped = 0;
  let published = 0;
  let withheld = 0;
  let takenDown = 0;
  for (const result of results) {
    staged += result.staged;
    mapped += result.mapped;
    published += result.published;
    withheld += result.withheld;
    takenDown += result.takenDown;
    addCounts(withheldByReason, result.withheldByReason);
    addCounts(suppressedByFlag, result.suppressedByFlag);
    addCounts(suppressionAnomalies, result.suppressionAnomalies);
  }
  return {
    staged,
    mapped,
    published,
    withheld,
    takenDown,
    withheldByReason,
    suppressedByFlag,
    suppressionAnomalies,
  };
}

/** Runs `applyChunk` over `records` in order, one chunk at a time, resting after each chunk. */
export async function applyInChunks(
  records: readonly Record<string, unknown>[],
  applyChunk: (chunk: readonly Record<string, unknown>[]) => Promise<PageResult>,
  options: ApplyChunkOptions,
): Promise<PageResult> {
  const chunkSize = Math.max(1, Math.floor(options.chunkSize));
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const results: PageResult[] = [];

  for (let start = 0; start < records.length; start += chunkSize) {
    const began = now();
    results.push(await applyChunk(records.slice(start, start + chunkSize)));
    // The last chunk rests too: the caller holds its apply slot until this returns, so the rest
    // also spaces this slice from the next one.
    if (options.paceRatio > 0) {
      const rest = Math.min(MAX_PACE_REST_MS, Math.round((now() - began) * options.paceRatio));
      if (rest > 0) await sleep(rest);
    }
  }
  return mergePageResults(results);
}
