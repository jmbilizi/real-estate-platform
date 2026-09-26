import { randomUUID } from 'node:crypto';

import type { SearchRequest, SearchRequestInput } from '@cribstop/property-contracts';

import {
  type AreaSyncClient,
  type AreaSyncRows,
  getAreaSync,
  recordAreaAttempt,
  recordAreaFailure,
  recordAreaOutcome,
} from './area-coverage-store';
import { needsAreaLoad, pickNextStatus } from './area-coverage';
import { getPool } from '../db/pool';
import { fetchAreaListings } from '../jobs/bright-ingest/area-fetch';
import {
  createTokenProvider,
  type FetchLike,
  type TokenProvider,
} from '../jobs/bright-ingest/bright-client';
import { type BrightConfig, resolveBrightConfig } from '../jobs/bright-ingest/config';
import { RateLimiter } from '../jobs/bright-ingest/rate-limiter';
import { type BrightStagingStore, createStagingStore } from '../jobs/bright-ingest/staging-store';
import {
  fetchListingMedia,
  type ListingMediaTarget,
} from '../jobs/bright-ingest/listing-media-fetch';
import {
  loadListingStatuses,
  mapStagedBrightMedia,
  mapStagedBrightProperties,
} from '../jobs/bright-map/run';
import { type ListingStatusLookup, searchableStatuses } from '../jobs/bright-map/status';

/**
 * `Closed` (sold) listings run last in `listing_statuses.sort_order` and can be numerous for a busy
 * city. Fetching them through the same cap as the statuses that keep a listing on the market let a
 * large sold backlog starve those statuses' resume progress and never let the area read `complete`
 * (#329). It is not a `listing_statuses` code — checked against the RESO `StandardStatus` wire
 * value `fetchAreaListings` requests — so this is a literal, not an import from `bright-map/status`.
 */
const CLOSED_STANDARD_STATUS = 'Closed';

/**
 * On-demand area load: a search for a place we do not fully hold loads that place from Bright.
 *
 * The search always reads our own database first (`repository.ts`). `routes.ts` asks `needsLoad()`
 * whether the searched place's `bright_area_sync` coverage is missing, not complete, or older than
 * the freshness window — not only when the search returned zero rows (#329). Every publicly
 * searchable status is tracked (`listing_statuses.is_publicly_searchable`, not Active alone, #330),
 * one row per `(area, status)`, so a load resumes each status from its own cursor and a capped call
 * never restarts at the beginning. Bright is slow, so the route waits at most `waitMs`; past that it
 * answers with what it has and the load finishes in the background, so the next request finds the
 * listings.
 *
 * `bright_area_sync.attempted_at` is the cooldown: shared across pods and surviving a pod restart,
 * unlike the in-memory map this replaced. A `failed` status cools down for `failedCooldownMs`, far
 * shorter than the `cooldownMs` a `complete`/`partial` status uses, so a transient Bright error does
 * not block the next search from retrying for a full hour. Concurrent searches for the same area
 * share one in-flight load (per process).
 */

export type AreaLoadOutcome = 'loaded' | 'pending' | 'skipped';

export interface AreaLoader {
  load(request: SearchRequest): Promise<AreaLoadOutcome>;
  /** Fetches one Bright listing's full photo gallery (the listing detail view). */
  loadGallery(listing: ListingMediaTarget): Promise<AreaLoadOutcome>;
  /** Whether `request`'s place needs a load: coverage missing, not complete, or stale. */
  needsLoad(request: SearchRequest): Promise<boolean>;
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

/**
 * Matches `City, ST`, `City ST`, or `City, ST 12345`, anchored on the string end.
 *
 * The trailing two-letter token is read as a state, the same way the `state` query parameter
 * itself is (`stateCode` in `search-request.ts`). Any two letters count. There is no real-state
 * lookup.
 *
 * The end anchor keeps this narrow. A city whose last word is not exactly two letters, such as
 * `Ocean City` or `New York`, never matches here. It falls through to the bare-city form below.
 */
const CITY_STATE_ZIP = /^([A-Za-z][A-Za-z .'-]*?)[,\s]+([A-Za-z]{2})(?:[,\s]+(\d{5}))?$/;

/** Bright stores city names capitalised ("Silver Spring"); search input arrives in any case. */
export function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

/** A city, with an optional state and ZIP, parsed out of free text such as `query`. */
function placeOf(text: string): Area | null {
  const match = CITY_STATE_ZIP.exec(text);
  if (match !== null) {
    const [, city, state, zip] = match;
    return {
      city: titleCase(city as string),
      state: (state as string).toUpperCase(),
      ...(zip === undefined ? {} : { zip }),
    };
  }
  return PLACE.test(text) ? { city: titleCase(text) } : null;
}

export function areaOf(request: SearchRequest): Area | null {
  const explicitState = request.state?.toUpperCase();
  const withExplicitState = explicitState === undefined ? {} : { state: explicitState };

  if (request.zip !== undefined && ZIP.test(request.zip.trim())) {
    return { zip: request.zip.trim(), ...withExplicitState };
  }
  if (request.city !== undefined && PLACE.test(request.city.trim())) {
    return { city: titleCase(request.city), ...withExplicitState };
  }

  const query = request.query?.trim();
  if (query === undefined) {
    return null;
  }
  if (ZIP.test(query)) {
    return { zip: query, ...withExplicitState };
  }
  const place = placeOf(query);
  if (place === null) {
    return null;
  }
  // An explicit `state` parameter sent alongside a free-text `query` wins over any state the query
  // text itself carried.
  return { ...place, ...withExplicitState };
}

export function areaKey(area: Area): string {
  return [area.city ?? '', area.zip ?? '', area.state ?? ''].join('|').toLowerCase();
}

/**
 * The inverse of `areaKey()`, for the scheduled refresh and reconciliation jobs (#331): both read
 * `bright_area_sync`, which stores only the composite key, and need the city/zip/state back to
 * build a Bright request. Safe because `areaKey()`'s three parts cannot themselves contain `|`
 * (`PLACE`/`CITY_STATE_ZIP` allow letters, spaces, and `.'-` only; a ZIP is digits; a state is two
 * letters), and because `titleCase()` is idempotent over its own output, so re-titlecasing the
 * lowercased city recovers the casing `areaOf()` originally applied.
 */
export function parseAreaKey(key: string): Area {
  const [cityPart, zipPart, statePart] = key.split('|');
  const city = cityPart !== undefined && cityPart.length > 0 ? titleCase(cityPart) : undefined;
  const zip = zipPart !== undefined && zipPart.length > 0 ? zipPart : undefined;
  const state =
    statePart !== undefined && statePart.length > 0 ? statePart.toUpperCase() : undefined;
  return {
    ...(city === undefined ? {} : { city }),
    ...(state === undefined ? {} : { state }),
    ...(zip === undefined ? {} : { zip }),
  };
}

/**
 * `Area`'s fields, shaped for a search request. The one mapping `placeSearchRequest()` and
 * `resolvedSearchRequest()` both need, so a field added to `Area` only has one call site to update.
 */
function placeFields(area: Area): Pick<SearchRequest, 'city' | 'state' | 'zip'> {
  return {
    ...(area.city === undefined ? {} : { city: area.city }),
    ...(area.state === undefined ? {} : { state: area.state }),
    ...(area.zip === undefined ? {} : { zip: area.zip }),
  };
}

/**
 * The place-only fields of a search request for the given `Area`. `placeHasNoListings()` in
 * `routes.ts` parses this from `areaOf()`'s result rather than from the raw request, so a free-text
 * search (`query=Frederick, MD`) and a structured one (`city=Frederick&state=MD`) share one DB
 * check and, through `areaKey()`, one Bright-load cooldown key.
 */
export function placeSearchRequest(area: Area): SearchRequestInput {
  return placeFields(area);
}

/**
 * `request`, with a free-text `query` swapped for the place `areaOf()` parsed out of it.
 *
 * The swap runs only when that place carries a state the query text itself supplied. No stored
 * column ever holds `"Frederick, MD"` as one string. `search-query.ts`'s substring match on `query`
 * can never find a row there, even after the on-demand load stages it. A bare-city or ZIP query
 * keeps matching by substring as before, because `areaOf()` never derives a state from either of
 * those.
 *
 * Never swaps when the caller sent an explicit `state`. `query` and `state` then stay two
 * independent ANDed filters, per the divergence noted in `search-query.ts`.
 */
export function resolvedSearchRequest(request: SearchRequest): SearchRequest {
  const area = areaOf(request);
  if (area === null || area.state === undefined || request.state !== undefined) {
    return request;
  }
  return { ...request, query: undefined, ...placeFields(area) };
}

export interface AreaLoaderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly waitMs?: number;
  readonly cooldownMs?: number;
  /** Cooldown after a `failed` status pass — short, so a transient error self-heals fast (#329). */
  readonly failedCooldownMs?: number;
  readonly maxRecords?: number;
  /** Independent cap for the `Closed` (sold) pass, so a sold backlog cannot borrow this budget. */
  readonly closedMaxRecords?: number;
  /** How long a `complete` area's coverage stays trusted before the next search re-triggers it. */
  readonly freshnessMs?: number;
  readonly now?: () => number;
  readonly fetchImpl?: FetchLike;
  readonly log?: (message: string) => void;
  /**
   * Test seam for every plain read/write this loader issues against `property_db` —
   * `bright_area_sync`, `listing_statuses`, and the mapper's staging reads — so a unit test can
   * pass an in-memory fake instead of opening a socket. Defaults to `getPool()`. The gallery path
   * (`fetchGallery`) still opens its own connection: it needs a transaction, which this seam's
   * plain `query()` shape does not provide.
   */
  readonly areaSyncClient?: AreaSyncClient;
  /** Test seam for the staging writes `fetchAreaListings` issues; defaults to `createStagingStore()`. */
  readonly stagingStore?: BrightStagingStore;
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

/** Most keys the cooldown map holds. Past it the oldest are dropped, so memory stays bounded. */
const MAX_TRACKED_KEYS = 2000;

/** Galleries fetched in the background after one area load. Bounded so one search stays cheap. */
const GALLERY_PREFETCH_LIMIT = 50;

export function createAreaLoader(options: AreaLoaderOptions = {}): AreaLoader {
  const env = options.env ?? process.env;
  const waitMs = options.waitMs ?? Number(env.BRIGHT_ON_DEMAND_WAIT_MS ?? 20_000);
  const galleryWaitMs = Number(env.BRIGHT_ON_DEMAND_GALLERY_WAIT_MS ?? 10_000);
  const cooldownMs =
    options.cooldownMs ?? Number(env.BRIGHT_ON_DEMAND_COOLDOWN_MS ?? 60 * 60 * 1000);
  const failedCooldownMs =
    options.failedCooldownMs ?? Number(env.BRIGHT_ON_DEMAND_FAILED_COOLDOWN_MS ?? 5 * 60 * 1000);
  const maxRecords = options.maxRecords ?? 1000;
  const closedMaxRecords =
    options.closedMaxRecords ?? Number(env.BRIGHT_ON_DEMAND_CLOSED_MAX_RECORDS ?? maxRecords);
  const freshnessMs =
    options.freshnessMs ?? Number(env.BRIGHT_AREA_FRESHNESS_MS ?? 24 * 60 * 60 * 1000);
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((message: string) => console.warn(message));
  // Lazy: `getPool()` throws when `DATABASE_URL` is unset, and a Bright-not-configured loader
  // (`config === null`) must still construct cleanly — it never reaches a call site that needs one.
  let areaSyncClient: AreaSyncClient | null = null;
  function areaSync(): AreaSyncClient {
    areaSyncClient ??= options.areaSyncClient ?? getPool();
    return areaSyncClient;
  }

  const config = resolveConfigOrNull(env);
  const inFlight = new Map<string, Promise<void>>();
  const areaInFlight = new Map<string, Promise<boolean>>();
  const galleryAttemptedAt = new Map<string, number>();
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
   * Records a gallery-fetch attempt. Expired entries are pruned first; if the map is still full,
   * the oldest (Map keeps insertion order) are dropped. Arbitrary listing keys cannot grow it
   * without limit. Area-load cooldowns are no longer tracked here — see `bright_area_sync` (#329).
   */
  function rememberGallery(key: string): void {
    if (galleryAttemptedAt.size >= MAX_TRACKED_KEYS) {
      for (const [tracked, at] of galleryAttemptedAt) {
        if (now() - at >= cooldownMs) galleryAttemptedAt.delete(tracked);
      }
      for (const tracked of galleryAttemptedAt.keys()) {
        if (galleryAttemptedAt.size < MAX_TRACKED_KEYS) break;
        galleryAttemptedAt.delete(tracked);
      }
    }
    galleryAttemptedAt.delete(key);
    galleryAttemptedAt.set(key, now());
  }

  /**
   * Starts `work` once per key per cooldown, shares an in-flight run between callers, and waits
   * at most `wait` for it. `'skipped'` means it ran recently, so nothing new will arrive.
   *
   * Gallery fetches only — an area load's cooldown lives in `bright_area_sync` and is decided by
   * `pickNextStatus()` inside `loadArea()`, not here (#329).
   */
  async function once(
    key: string,
    wait: number,
    work: () => Promise<void>,
  ): Promise<AreaLoadOutcome> {
    let pending = inFlight.get(key);
    if (pending === undefined) {
      const last = galleryAttemptedAt.get(key);
      if (last !== undefined && now() - last < cooldownMs) {
        return 'skipped';
      }
      rememberGallery(key);
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

  /**
   * The `bright_area_sync` rows for `area`, the currently searchable statuses to check them
   * against, and the raw `listing_statuses` lookup those statuses were derived from. Both callers
   * (`needsLoad`, `loadArea`) need the identical pair, so it is read once here rather than twice
   * with a chance to disagree — and `loadArea` reuses `listingStatuses` for
   * `mapStagedBrightProperties` rather than querying the table a second time.
   */
  async function coverage(
    area: Area,
    feedTier: ActiveConfig['feed'],
  ): Promise<{ rows: AreaSyncRows; statuses: string[]; listingStatuses: ListingStatusLookup[] }> {
    const listingStatuses = await loadListingStatuses(areaSync());
    const statuses = searchableStatuses(listingStatuses);
    const rows = await getAreaSync(areaSync(), areaKey(area), feedTier);
    return { rows, statuses, listingStatuses };
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
      const mapping = await mapStagedBrightMedia(client, active.feed, [listing.listingKey]);
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

  /**
   * Works on exactly one status pass per invocation — whichever `pickNextStatus` names, budgeted
   * `closedMaxRecords` for `Closed` and `maxRecords` for every other status — and persists the
   * result to `bright_area_sync` before returning. A single search may trigger several loads in a
   * row (each one advances one status), but never more than one status's cap of Bright records.
   *
   * Returns whether it actually ran a Bright request, so the in-flight wrapper can tell a `loaded`
   * outcome from `pickNextStatus` finding nothing to do (already complete, or every incomplete
   * status still cooling down).
   */
  async function loadArea(area: Area, active: ActiveConfig): Promise<boolean> {
    const started = now();
    const key = areaKey(area);
    const { rows, statuses, listingStatuses } = await coverage(area, active.feed);
    if (statuses.length === 0) {
      log(`On-demand Bright load for ${key}: no publicly searchable status is configured.`);
      return false;
    }
    const target = pickNextStatus(statuses, rows, now(), cooldownMs, failedCooldownMs);
    if (target === null) {
      return false;
    }

    await recordAreaAttempt(areaSync(), key, active.feed, target, new Date(now()));

    try {
      const prior = rows.get(target) ?? null;
      const budget = target === CLOSED_STANDARD_STATUS ? closedMaxRecords : maxRecords;
      const result = await fetchAreaListings({
        serviceRoot: active.endpoint.serviceRoot,
        serviceRootHost: active.endpoint.serviceRootHost,
        tokenProvider: tokens(active),
        store: options.stagingStore ?? createStagingStore(),
        runId: randomUUID(),
        feedTier: active.feed,
        ...area,
        status: target,
        // `complete` rows are never picked by `pickNextStatus`, so `prior` here is always
        // `undefined`, `partial`, or `failed` — and a `failed` row keeps whatever cursor the
        // attempt before it left (`recordAreaFailure`), precisely so THIS resume can use it rather
        // than restart the whole pass and double-count already-staged records into `loaded_count`.
        afterKey: prior?.resumeKey ?? null,
        pageSize: active.replication.pageSize ?? 200,
        maxRecords: budget,
        pageOptions: pageOptions(active),
      });

      const mapping =
        result.listingKeys.length === 0
          ? null
          : await mapStagedBrightProperties(areaSync(), {
              feed: active.feed,
              soldDisplayDelayDays: soldDisplayDelayDays(env),
              listingKeys: result.listingKeys,
              statuses: listingStatuses,
            });

      const totalLoaded = (prior?.loadedCount ?? 0) + result.listingKeys.length;
      await recordAreaOutcome(
        areaSync(),
        key,
        active.feed,
        target,
        {
          status: result.complete ? 'complete' : 'partial',
          loadedCount: totalLoaded,
          sourceCount: result.complete ? totalLoaded : null,
          resumeKey: result.afterKey,
          syncedAt: result.complete ? new Date(now()) : null,
        },
        new Date(now()),
      );

      log(
        `On-demand Bright load for ${key} [${target}] from ${active.endpoint.serviceRootHost}: ` +
          `${result.listingKeys.length} staged in ${result.pagesFetched} page(s), ` +
          `${mapping?.published ?? 0} published, ${now() - started} ms` +
          (result.complete ? '.' : ' (capped).'),
      );
      // Only the keys the mapper actually published, never every staged key: a rejected record
      // (missing attribution, an unrecognised status) has no gallery to show.
      prefetchGalleries(active, mapping?.publishedListingKeys ?? []);
      return true;
    } catch (error) {
      // Marks THIS status `failed`, keeping whatever the prior attempt already staged/resumed —
      // the shorter `failedCooldownMs` applies to it alone, other statuses are unaffected.
      await recordAreaFailure(areaSync(), key, active.feed, target, new Date(now()));
      throw error;
    }
  }

  /**
   * Dedupes concurrent callers for the same area (per process, via `areaInFlight`); the cooldown
   * decision itself lives in `bright_area_sync`, read fresh by `loadArea` every time.
   */
  async function onceArea(
    area: Area,
    active: ActiveConfig,
    wait: number,
  ): Promise<AreaLoadOutcome> {
    const key = areaKey(area);
    let pending = areaInFlight.get(key);
    if (pending === undefined) {
      pending = loadArea(area, active)
        .catch((error: unknown) => {
          log(
            `On-demand Bright load for ${key} failed: ` +
              (error instanceof Error ? error.message : String(error)),
          );
          return false;
        })
        .finally(() => areaInFlight.delete(key));
      areaInFlight.set(key, pending);
    }

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), wait);
    });
    const outcome = await Promise.race([
      pending.then((ran) => (ran ? ('loaded' as const) : ('skipped' as const))),
      timedOut,
    ]);
    clearTimeout(timer);
    return outcome;
  }

  return {
    async load(request) {
      const area = areaOf(request);
      if (area === null || config === null) {
        return 'skipped';
      }
      return onceArea(area, config, waitMs);
    },

    async needsLoad(request) {
      const area = areaOf(request);
      if (area === null || config === null) {
        return false;
      }
      const { rows, statuses } = await coverage(area, config.feed);
      return needsAreaLoad(rows, statuses, freshnessMs, now());
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
