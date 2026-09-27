import { randomUUID } from 'node:crypto';

import { getPool } from '../db/pool';
import {
  createTokenProvider,
  type FetchLike,
  type TokenProvider,
} from '../jobs/bright-ingest/bright-client';
import { type BrightConfig, resolveBrightConfig } from '../jobs/bright-ingest/config';
import {
  fetchListingMedia,
  type ListingMediaTarget,
} from '../jobs/bright-ingest/listing-media-fetch';
import { RateLimiter } from '../jobs/bright-ingest/rate-limiter';
import { type BrightStagingStore, createStagingStore } from '../jobs/bright-ingest/staging-store';
import { mapStagedBrightMedia } from '../jobs/bright-map/run';

/**
 * The listing-detail gallery fetch: a Bright listing opened with at most its `ListPictureURL`
 * photo loads its full `BrightMedia` gallery. One listing, one bounded request, so the detail route
 * waits for it up to `BRIGHT_ON_DEMAND_GALLERY_WAIT_MS`. Search never calls Bright (#337, #338).
 */

export type GalleryLoadOutcome = 'loaded' | 'pending' | 'skipped';

export interface GalleryLoader {
  loadGallery(listing: ListingMediaTarget): Promise<GalleryLoadOutcome>;
}

type ActiveConfig = Extract<BrightConfig, { state: 'configured' }>;

export interface GalleryLoaderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cooldownMs?: number;
  readonly now?: () => number;
  readonly fetchImpl?: FetchLike;
  readonly log?: (message: string) => void;
  readonly stagingStore?: BrightStagingStore;
}

function resolveConfigOrNull(env: NodeJS.ProcessEnv): ActiveConfig | null {
  try {
    const config = resolveBrightConfig(env);
    return config.state === 'configured' ? config : null;
  } catch {
    return null;
  }
}

/** Most keys the cooldown map holds. Past it the oldest are dropped, so memory stays bounded. */
const MAX_TRACKED_KEYS = 2000;

export function createGalleryLoader(options: GalleryLoaderOptions = {}): GalleryLoader {
  const env = options.env ?? process.env;
  const galleryWaitMs = Number(env.BRIGHT_ON_DEMAND_GALLERY_WAIT_MS ?? 10_000);
  const cooldownMs =
    options.cooldownMs ?? Number(env.BRIGHT_ON_DEMAND_COOLDOWN_MS ?? 60 * 60 * 1000);
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

  /** Prunes expired entries first, then the oldest, so arbitrary keys cannot grow the map. */
  function remember(key: string): void {
    if (attemptedAt.size >= MAX_TRACKED_KEYS) {
      for (const [tracked, at] of attemptedAt) {
        if (now() - at >= cooldownMs) attemptedAt.delete(tracked);
      }
      for (const tracked of attemptedAt.keys()) {
        if (attemptedAt.size < MAX_TRACKED_KEYS) break;
        attemptedAt.delete(tracked);
      }
    }
    attemptedAt.delete(key);
    attemptedAt.set(key, now());
  }

  async function fetchGallery(active: ActiveConfig, listing: ListingMediaTarget): Promise<void> {
    const started = now();
    const result = await fetchListingMedia(
      {
        serviceRoot: active.endpoint.serviceRoot,
        serviceRootHost: active.endpoint.serviceRootHost,
        tokenProvider: tokens(active),
        store: options.stagingStore ?? createStagingStore(),
        runId: randomUUID(),
        feedTier: active.feed,
        listing,
        pageOptions: {
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
          ...(limiter === null ? {} : { limiter }),
          maxRetries: 1,
          timeoutMs: active.replication.requestTimeoutMs,
        },
      },
      (filter, odataMessage) =>
        log(`Bright gallery: Bright refused the ${filter} filter: ${odataMessage ?? '(none)'}`),
    );
    if (result.kind === 'unsupported') {
      log('Bright gallery: Bright refused every BrightMedia filter.');
      return;
    }
    const client = await getPool().connect();
    try {
      const mapping = await mapStagedBrightMedia(client, active.feed, [listing.listingKey]);
      log(
        `Bright gallery for ${listing.listingKey}: ${result.photos} staged by ${result.filter}, ` +
          `${mapping.mediaWritten} written, ${now() - started} ms.`,
      );
    } finally {
      client.release();
    }
  }

  return {
    async loadGallery(listing) {
      if (config === null) {
        return 'skipped';
      }
      const key = listing.listingKey;
      let pending = inFlight.get(key);
      if (pending === undefined) {
        const last = attemptedAt.get(key);
        if (last !== undefined && now() - last < cooldownMs) {
          return 'skipped';
        }
        remember(key);
        pending = fetchGallery(config, listing)
          .catch((error: unknown) => {
            log(
              `Bright gallery for ${key} failed: ` +
                (error instanceof Error ? error.message : String(error)),
            );
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }

      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<'pending'>((resolve) => {
        timer = setTimeout(() => resolve('pending'), galleryWaitMs);
      });
      const outcome = await Promise.race([pending.then(() => 'loaded' as const), timedOut]);
      clearTimeout(timer);
      return outcome;
    },
  };
}
