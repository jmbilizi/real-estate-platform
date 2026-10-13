import type {
  HomeFeedRequest,
  HomeFeedResponse,
  HomeFeedRow,
  ListingCardRow,
} from '@cribstop/property-contracts';
import { findListingCardsByIds, type ReadPool } from '../listings/repository';
import { findFallbackCandidates, findFeedCandidates, withReadTimeout } from './candidates';
import {
  buildProfileModel,
  type Candidate,
  EMPTY_MODEL,
  type ProfilePoint,
} from './ranker/features';
import { buildRows } from './ranker/rows';
import { MODEL_VERSION } from './ranker/v1-weights';

const COLD_CACHE_TTL_MS = 60_000;
const COLD_CACHE_MAX = 200;
/** A cold feed is the same for every visitor of a place and side, so one short-lived entry serves all. */
const coldCache = new Map<string, { rows: HomeFeedRow[]; at: number }>();

export function clearColdCache(): void {
  coldCache.clear();
}

export interface FeedDeps {
  readonly now?: () => number;
  readonly rng?: () => number;
}

const WARM_VIEWS = 3;

const FALLBACK_VARIANT = 'fallback';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The degraded feed: popularity-ordered listings of the state, cold row order, no personal
 * signal, `variant: "fallback"`. It is never cached. If this read fails too, the rows are empty.
 */
async function buildFallbackFeed(
  pool: ReadPool,
  request: HomeFeedRequest,
  place: string,
  now: number,
  rng: () => number,
): Promise<HomeFeedResponse> {
  let candidates: Candidate[] = [];
  try {
    candidates = await findFallbackCandidates(pool, {
      side: request.side,
      state: request.target.state,
    });
  } catch (error) {
    console.warn('Home feed fallback read failed:', errorMessage(error));
  }
  const rows = buildRows({
    candidates,
    model: EMPTY_MODEL,
    warm: false,
    place,
    radiusKm: null,
    variant: FALLBACK_VARIANT,
    now,
    rng,
  });
  return { modelVersion: MODEL_VERSION, variant: FALLBACK_VARIANT, rows };
}

/**
 * Ranks one visitor's home feed. The profile arrives in the request, is read here and is never
 * stored or logged. The model keeps listing facts only: price, type and beds of the listings the
 * visitor viewed or saved. Nothing about people or neighbourhoods enters.
 */
export async function buildHomeFeed(
  pool: ReadPool,
  request: HomeFeedRequest,
  deps: FeedDeps = {},
): Promise<HomeFeedResponse> {
  const now = (deps.now ?? Date.now)();
  const rng = deps.rng ?? Math.random;
  const profile = request.profile;
  const items = profile?.items ?? [];
  const places = profile?.places ?? [];
  const isCold = items.length === 0 && places.length === 0;
  const place = `${request.target.city}, ${request.target.state.toUpperCase()}`;

  const centreKey = `${request.target.lat?.toFixed(3) ?? '-'},${request.target.lng?.toFixed(3) ?? '-'}`;
  const cacheKey = `${place.toLowerCase()}|${centreKey}|${request.side}|${request.radiusKm}|${request.variant}`;
  if (isCold) {
    const hit = coldCache.get(cacheKey);
    if (hit !== undefined && now - hit.at < COLD_CACHE_TTL_MS) {
      return { modelVersion: MODEL_VERSION, variant: request.variant, rows: hit.rows };
    }
  }

  const sideItems = items.filter((item) => item.side === request.side);
  const ids = [...new Set(sideItems.map((item) => item.listingId))];
  // A failed profile read costs personalisation, never the feed.
  const cards = await withReadTimeout(pool, (client) => findListingCardsByIds(client, ids)).catch(
    (error: unknown) => {
      console.warn('Home feed profile read failed:', errorMessage(error));
      return new Map<string, ListingCardRow>();
    },
  );
  const points: ProfilePoint[] = [];
  for (const item of sideItems) {
    const card = cards.get(item.listingId);
    if (card !== undefined && card.listingType === request.side) {
      points.push({ card, kind: item.kind });
    }
  }
  const model = points.length === 0 ? EMPTY_MODEL : buildProfileModel(points);

  const views = items.filter((item) => item.kind === 'view').length;
  const saves = items.filter((item) => item.kind === 'save').length;
  const warm = places.length >= 1 || views >= WARM_VIEWS || saves >= 1;

  const centre =
    request.target.lat !== undefined && request.target.lng !== undefined
      ? { lat: request.target.lat, lng: request.target.lng }
      : null;
  let candidates: Candidate[];
  try {
    candidates = await findFeedCandidates(
      pool,
      {
        side: request.side,
        city: request.target.city,
        state: request.target.state,
        centre,
        radiusKm: request.radiusKm,
      },
      now,
    );
  } catch (error) {
    console.warn('Home feed candidate read failed, serving the fallback:', errorMessage(error));
    return buildFallbackFeed(pool, request, place, now, rng);
  }

  const rows = buildRows({
    candidates,
    model,
    warm,
    place,
    radiusKm: request.radiusKm,
    variant: request.variant,
    now,
    rng,
  });

  if (isCold) {
    if (coldCache.size >= COLD_CACHE_MAX) coldCache.clear();
    coldCache.set(cacheKey, { rows, at: now });
  }
  return { modelVersion: MODEL_VERSION, variant: request.variant, rows };
}
