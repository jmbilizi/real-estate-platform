/**
 * The v1 ranker constants (#835). A change to any value here is a new `MODEL_VERSION`.
 *
 * `FEATURE_KEYS` is the Fair Housing allowlist. A new feature needs a compliance review and a
 * change to the allowlist test. No demographic, census, school, crime, religion or language data,
 * and no proxy for them, may become a feature.
 */
export const MODEL_VERSION = 'v1';

export const FEATURE_KEYS = ['geo', 'price', 'attrs', 'freshness', 'photos', 'popularity'] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Each feature is a number from 0 to 1. This type holds the six features and nothing else. */
export type FeatureVector = Readonly<Record<FeatureKey, number>>;

export const WEIGHTS: FeatureVector = {
  geo: 0.3,
  price: 0.2,
  attrs: 0.15,
  freshness: 0.15,
  photos: 0.1,
  popularity: 0.1,
};

/** Weights of the "New in {place}" row. */
export const NEW_ROW_WEIGHTS = { freshness: 0.6, geo: 0.4 } as const;

export const MMR_LAMBDA = 0.7;
export const MAX_CARDS_PER_OFFICE = 2;
export const ROW_SIZE = 8;
export const MIN_ROW_CARDS = 4;
/** One slot in this many cards is an exploration slot. */
export const EXPLORE_EVERY = 8;

export const CANDIDATE_LIMIT = 400;
/** Extra candidates from the price-drop and newly-listed indexes, per index. */
export const EXTRA_CANDIDATE_LIMIT = 50;
export const STATEMENT_TIMEOUT_MS = 2000;

/** The geo scale of a whole-state request, in km. */
export const STATE_SCALE_KM = 150;
export const FRESHNESS_HALF_SCALE_DAYS = 7;
export const CUT_WINDOW_DAYS = 14;
/** A price cut of this share counts as the maximum cut signal. */
export const CUT_FULL_SHARE = 0.05;
export const PHOTO_FULL_COUNT = 20;
export const NEW_WINDOW_DAYS = 7;
export const MIN_PRICE_POINTS = 3;
export const SAVE_WEIGHT = 3;
export const MIN_PRICE_SIGMA = 0.25;
export const PRICE_DROP_MIN_P = 0.5;
