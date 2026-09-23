import { randomUUID } from 'node:crypto';

import type { SearchRequest } from '@cribstop/property-contracts';

import { getPool } from '../db/pool';
import { fetchAreaListings } from '../jobs/bright-ingest/area-fetch';
import {
  createTokenProvider,
  type FetchLike,
  type TokenProvider,
} from '../jobs/bright-ingest/bright-client';
import { type BrightConfig, resolveBrightConfig } from '../jobs/bright-ingest/config';
import { RateLimiter } from '../jobs/bright-ingest/rate-limiter';
import { createStagingStore } from '../jobs/bright-ingest/staging-store';
import {
  fetchListingMedia,
  type ListingMediaTarget,
} from '../jobs/bright-ingest/listing-media-fetch';
import { mapStagedBrightMedia, mapStagedBrightProperties } from '../jobs/bright-map/run';

/**
 * On-demand area load: a search for a place we hold nothing for loads that place from Bright.
 *
 * The search always reads our own database first (`repository.ts`). Only when a first-page search
 * for a city or ZIP returns zero results does the route ask this loader to fetch that area's ACTIVE
 * listings from Bright, stage them, map them, and then search again. Bright is slow, so the route
 * waits at most `waitMs`; past that it answers with what it has and the load finishes in the
 * background, so the next request finds the listings.
 *
 * Each area is attempted at most once per `cooldownMs`, so a place with no active listings does not
 * cost a Bright request on every search. Concurrent searches for the same area share one load.
 */

export type AreaLoadOutcome = 'loaded' | 'pending' | 'skipped';

export interface AreaLoader {
  load(request: SearchRequest): Promise<AreaLoadOutcome>;
  /** Fetches one Bright listing's full photo gallery (the listing detail view). */
  loadGallery(listing: ListingMediaTarget): Promise<AreaLoadOutcome>;
}

type ActiveConfig = Extract<BrightConfig, { state: 'configured' }>;

/** The place a search names, or `null` when it names none this loader can fetch. */
export interface Area {
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
}

const ZIP = /^\d{5}$/;
const PLACE = /^[A-Za-z][A-Za-z .'-]{1,59}$/;

/** Bright stores city names capitalised ("Silver Spring"); search input arrives in any case. */
function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

export function areaOf(request: SearchRequest): Area | null {
  const state = request.state?.toUpperCase();
  const withState = state === undefined ? {} : { state };
  if (request.zip !== undefined && ZIP.test(request.zip.trim())) {
    return { zip: request.zip.trim(), ...withState };
  }
  if (request.city !== undefined && PLACE.test(request.city.trim())) {
    return { city: titleCase(request.city), ...withState };
  }
  const query = request.query?.trim();
  if (query !== undefined && ZIP.test(query)) {
    return { zip: query, ...withState };
  }
  if (query !== undefined && PLACE.test(query)) {
    return { city: titleCase(query), ...withState };
  }
  return null;
}

function areaKey(area: Area): string {
  return [area.city ?? '', area.zip ?? '', area.state ?? ''].join('|').toLowerCase();
}

export interface AreaLoaderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly waitMs?: number;
  readonly cooldownMs?: number;
  readonly maxRecords?: number;
  readonly now?: () => number;
  readonly fetchImpl?: FetchLike;
  readonly log?: (message: string) => void;
}

function soldDisplayDelayDays(env: NodeJS.ProcessEnv): number | null {
  const raw = env.BRIGHT_SOLD_DISPLAY_DELAY_DAYS;
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveConfigOrNull(
  env: NodeJS.ProcessEnv,
): Extract<BrightConfig, { state: 'configured' }> | null {
  try {
    const config = resolveBrightConfig(env);
    return config.state === 'configured' ? config : null;
  } catch {
    return null;
  }
}

/** Galleries fetched in the background after one area load. Bounded so one search stays cheap. */
const GALLERY_PREFETCH_LIMIT = 50;

export function createAreaLoader(options: AreaLoaderOptions = {}): AreaLoader {
  const env = options.env ?? process.env;
  const waitMs = options.waitMs ?? Number(env.BRIGHT_ON_DEMAND_WAIT_MS ?? 20_000);
  const galleryWaitMs = Number(env.BRIGHT_ON_DEMAND_GALLERY_WAIT_MS ?? 10_000);
  const cooldownMs = options.cooldownMs ?? 60 * 60 * 1000;
  const maxRecords = options.maxRecords ?? 1000;
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((message: string) => console.warn(message));

  const config = resolveConfigOrNull(env);
  const inFlight = new Map<string, Promise<void>>();
  const attemptedAt = new Map<string, number>();
  let tokenProvider: TokenProvider | null = null;
  const limiter =
    config === null
      ? null
      : new RateLimiter({
          requestsPerSecond: config.replication.requestsPerSecond,
          requestsPerMinute: config.replication.requestsPerMinute,
          maxConcurrency: config.replication.maxConcurrency,
        });

  function tokens(active: ActiveConfig): TokenProvider {
    tokenProvider ??= createTokenProvider(active.endpoint, active.credentials, {
      fetchImpl: options.fetchImpl,
      timeoutMs: active.replication.requestTimeoutMs,
    });
    return tokenProvider;
  }

  function pageOptions(active: ActiveConfig) {
    return {
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(limiter === null ? {} : { limiter }),
      maxRetries: 1,
      timeoutMs: active.replication.requestTimeoutMs,
    };
  }

  /**
   * Starts `work` once per key per cooldown, shares an in-flight run between callers, and waits
   * at most `wait` for it. `'skipped'` means it ran recently, so nothing new will arrive.
   */
  async function once(
    key: string,
    wait: number,
    work: () => Promise<void>,
  ): Promise<AreaLoadOutcome> {
    let pending = inFlight.get(key);
    if (pending === undefined) {
      const last = attemptedAt.get(key);
      if (last !== undefined && now() - last < cooldownMs) {
        return 'skipped';
      }
      attemptedAt.set(key, now());
      pending = work()
        .catch((error: unknown) => {
          log(
            `On-demand Bright load for ${key} failed: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), wait);
    });
    const outcome = await Promise.race([pending.then(() => 'loaded' as const), timedOut]);
    clearTimeout(timer);
    return outcome;
  }

  async function fetchGallery(active: ActiveConfig, listing: ListingMediaTarget): Promise<void> {
    const started = now();
    const result = await fetchListingMedia(
      {
        serviceRoot: active.endpoint.serviceRoot,
        serviceRootHost: active.endpoint.serviceRootHost,
        tokenProvider: tokens(active),
        store: createStagingStore(),
        runId: randomUUID(),
        listing,
        pageOptions: pageOptions(active),
      },
      (filter, odataMessage) =>
        log(
          `On-demand Bright gallery: Bright refused the ${filter} filter: ${odataMessage ?? '(no message)'}`,
        ),
    );
    if (result.kind === 'unsupported') {
      log('On-demand Bright gallery: Bright refused every BrightMedia filter.');
      return;
    }
    const client = await getPool().connect();
    try {
      const mapping = await mapStagedBrightMedia(client, [listing.listingKey]);
      log(
        `On-demand Bright gallery for ${listing.listingKey}: ${result.photos} staged by ` +
          `${result.filter}, ${mapping.mediaWritten} written, ${now() - started} ms.`,
      );
    } finally {
      client.release();
    }
  }

  function prefetchGalleries(active: ActiveConfig, listingKeys: readonly string[]): void {
    void (async () => {
      for (const listingKey of listingKeys.slice(0, GALLERY_PREFETCH_LIMIT)) {
        await once(`gallery|${listingKey}`, 0, () =>
          fetchGallery(active, { listingKey, listingId: null }),
        );
        await inFlight.get(`gallery|${listingKey}`);
      }
    })();
  }

  async function loadArea(area: Area, active: ActiveConfig): Promise<void> {
    const started = now();
    const result = await fetchAreaListings({
      serviceRoot: active.endpoint.serviceRoot,
      serviceRootHost: active.endpoint.serviceRootHost,
      tokenProvider: tokens(active),
      store: createStagingStore(),
      runId: randomUUID(),
      ...area,
      pageSize: active.replication.pageSize ?? 200,
      maxRecords,
      pageOptions: pageOptions(active),
    });
    const mapping =
      result.listingKeys.length === 0
        ? null
        : await mapStagedBrightProperties(getPool(), {
            feed: active.feed,
            soldDisplayDelayDays: soldDisplayDelayDays(env),
            listingKeys: result.listingKeys,
          });
    log(
      `On-demand Bright load for ${areaKey(area)} from ${active.endpoint.serviceRootHost}: ` +
        `${result.listingKeys.length} staged in ${result.pagesFetched} page(s), ` +
        `${mapping?.published ?? 0} published, ${now() - started} ms` +
        (result.complete ? '.' : ' (capped).'),
    );
    prefetchGalleries(active, result.listingKeys);
  }

  return {
    async load(request) {
      const area = areaOf(request);
      if (area === null || config === null) {
        return 'skipped';
      }
      return once(areaKey(area), waitMs, () => loadArea(area, config));
    },

    async loadGallery(listing) {
      if (config === null) {
        return 'skipped';
      }
      return once(`gallery|${listing.listingKey}`, galleryWaitMs, () =>
        fetchGallery(config, listing),
      );
    },
  };
}
