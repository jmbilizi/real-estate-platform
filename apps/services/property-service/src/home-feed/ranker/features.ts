import type { ListingCardRow } from '@cribstop/property-contracts';
import { PROPERTY_TYPES } from '@cribstop/property-contracts';
import {
  CUT_FULL_SHARE,
  CUT_WINDOW_DAYS,
  FEATURE_KEYS,
  type FeatureVector,
  FRESHNESS_HALF_SCALE_DAYS,
  MIN_PRICE_POINTS,
  MIN_PRICE_SIGMA,
  PHOTO_FULL_COUNT,
  SAVE_WEIGHT,
  STATE_SCALE_KM,
  WEIGHTS,
} from './v1-weights';

const DAY_MS = 86_400_000;

/** One listing the ranker scores, with the per-row facts the card does not carry. */
export interface Candidate {
  readonly card: ListingCardRow;
  /** Distance to the target centre in km. Null when the address is withheld. */
  readonly distanceKm: number | null;
  readonly photoCount: number;
  readonly hasPreferredPhoto: boolean;
  /** `listing_popularity_14d.score`. 0 when the listing has no events. */
  readonly popularity: number;
}

/** What the request profile says about the visitor, from listing facts only. */
export interface ProfileModel {
  /** Weighted median and spread of ln(price). Null with fewer than 3 points. */
  readonly price: { readonly mu: number; readonly sigma: number } | null;
  /** Counts per property type and the total, or null with no items. */
  readonly types: ReadonlyMap<string, number> | null;
  readonly typeTotal: number;
  readonly bedsMode: number | null;
  readonly views: number;
  readonly saves: number;
}

export const EMPTY_MODEL: ProfileModel = {
  price: null,
  types: null,
  typeTotal: 0,
  bedsMode: null,
  views: 0,
  saves: 0,
};

export interface ProfilePoint {
  readonly card: ListingCardRow;
  readonly kind: 'view' | 'save';
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Weighted quantile of sorted `[value, weight]` pairs. */
function weightedQuantile(sorted: readonly (readonly [number, number])[], q: number): number {
  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  const target = q * total;
  let seen = 0;
  for (const [value, weight] of sorted) {
    seen += weight;
    if (seen >= target) return value;
  }
  return sorted[sorted.length - 1]?.[0] ?? 0;
}

export function buildProfileModel(points: readonly ProfilePoint[]): ProfileModel {
  if (points.length === 0) return EMPTY_MODEL;
  const priced = points
    .filter((p) => p.card.price !== null && p.card.price > 0)
    .map((p) => [Math.log(p.card.price as number), p.kind === 'save' ? SAVE_WEIGHT : 1] as const)
    .sort((a, b) => a[0] - b[0]);
  let price: ProfileModel['price'] = null;
  if (priced.length >= MIN_PRICE_POINTS) {
    const mu = weightedQuantile(priced, 0.5);
    const iqr = weightedQuantile(priced, 0.75) - weightedQuantile(priced, 0.25);
    price = { mu, sigma: Math.max(MIN_PRICE_SIGMA, iqr / 1.35) };
  }
  const types = new Map<string, number>();
  const beds = new Map<number, number>();
  for (const { card } of points) {
    types.set(card.propertyType, (types.get(card.propertyType) ?? 0) + 1);
    if (card.beds !== null) beds.set(card.beds, (beds.get(card.beds) ?? 0) + 1);
  }
  let bedsMode: number | null = null;
  let best = 0;
  for (const [count, n] of beds) {
    if (n > best || (n === best && bedsMode !== null && count > bedsMode)) {
      best = n;
      bedsMode = count;
    }
  }
  return {
    price,
    types,
    typeTotal: points.length,
    bedsMode,
    views: points.filter((p) => p.kind === 'view').length,
    saves: points.filter((p) => p.kind === 'save').length,
  };
}

/** The share of the price cut over the last 14 days, 0 to 1 after the 5% scale. */
export function cutShare(card: ListingCardRow, now: number): number {
  if (card.price === null || card.previousPrice === null || card.priceChangedAt === null) return 0;
  if (card.previousPrice <= card.price) return 0;
  const age = (now - Date.parse(card.priceChangedAt)) / DAY_MS;
  if (age > CUT_WINDOW_DAYS) return 0;
  return (card.previousPrice - card.price) / card.previousPrice;
}

function daysOnMarket(card: ListingCardRow, now: number): number | null {
  if (card.daysOnMarket !== null) return card.daysOnMarket;
  if (card.listedAt !== null) return Math.max(0, (now - Date.parse(card.listedAt)) / DAY_MS);
  return null;
}

function geoFeature(distanceKm: number | null, radiusKm: number | null): number {
  if (distanceKm === null) return 0;
  return clamp01(Math.exp(-distanceKm / (radiusKm ?? STATE_SCALE_KM)));
}

function priceFeature(card: ListingCardRow, model: ProfileModel): number {
  if (model.price === null || card.price === null || card.price <= 0) return 0.5;
  const z = (Math.log(card.price) - model.price.mu) / model.price.sigma;
  return clamp01(Math.exp(-0.5 * z * z));
}

function attrsFeature(card: ListingCardRow, model: ProfileModel): number {
  if (model.types === null || model.typeTotal === 0) return 0.5;
  const k = PROPERTY_TYPES.length;
  const share = (type: string): number =>
    ((model.types?.get(type) ?? 0) + 1) / (model.typeTotal + k);
  const maxShare = Math.max(...PROPERTY_TYPES.map(share));
  const typeShare = share(card.propertyType) / maxShare;
  let bedsMatch = 0.5;
  if (model.bedsMode !== null) {
    const gap = card.beds === null ? Infinity : Math.abs(card.beds - model.bedsMode);
    bedsMatch = gap <= 1 ? 1 : gap <= 2 ? 0.5 : 0;
  }
  return clamp01(0.5 * typeShare + 0.5 * bedsMatch);
}

function freshnessFeature(card: ListingCardRow, now: number): number {
  const dom = daysOnMarket(card, now);
  const fresh = dom === null ? 0 : Math.exp(-dom / FRESHNESS_HALF_SCALE_DAYS);
  const cut = Math.min(1, cutShare(card, now) / CUT_FULL_SHARE);
  return clamp01(Math.max(fresh, cut));
}

function photosFeature(candidate: Candidate): number {
  return clamp01(
    0.7 * Math.min(1, candidate.photoCount / PHOTO_FULL_COUNT) +
      0.3 * (candidate.hasPreferredPhoto ? 1 : 0),
  );
}

/** The six features. The return type is the allowlist: no other key can be returned. */
export function computeFeatures(
  candidate: Candidate,
  model: ProfileModel,
  radiusKm: number | null,
  now: number,
): FeatureVector {
  return {
    geo: geoFeature(candidate.distanceKm, radiusKm),
    price: priceFeature(candidate.card, model),
    attrs: attrsFeature(candidate.card, model),
    freshness: freshnessFeature(candidate.card, now),
    photos: photosFeature(candidate),
    popularity: clamp01(candidate.popularity),
  };
}

export function score(features: FeatureVector): number {
  return FEATURE_KEYS.reduce((sum, key) => sum + WEIGHTS[key] * features[key], 0);
}
