import type { HomeFeedRequest, HomeFeedResponse, HomeFeedRow } from '@cribstop/property-contracts';
import { findListingCardsByIds, type ReadPool } from '../listings/repository';
import { findFeedCandidates } from './candidates';
import { buildProfileModel, EMPTY_MODEL, type ProfilePoint } from './ranker/features';
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

  const cacheKey = `${place.toLowerCase()}|${request.side}|${request.radiusKm}|${request.variant}`;
  if (isCold) {
    const hit = coldCache.get(cacheKey);
    if (hit !== undefined && now - hit.at < COLD_CACHE_TTL_MS) {
      return { modelVersion: MODEL_VERSION, variant: request.variant, rows: hit.rows };
    }
  }

  const sideItems = items.filter((item) => item.side === request.side);
  const ids = [...new Set(sideItems.map((item) => item.listingId))];
  const cards = await findListingCardsByIds(pool, ids);
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
  const candidates = await findFeedCandidates(
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
