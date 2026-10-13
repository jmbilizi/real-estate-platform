import type { HomeFeedRow } from '@cribstop/property-contracts';
import { type Candidate, computeFeatures, cutShare, type ProfileModel, score } from './features';
import { type Scored, selectRow } from './mmr';
import {
  type FeatureVector,
  MIN_ROW_CARDS,
  MODEL_VERSION,
  NEW_ROW_WEIGHTS,
  NEW_WINDOW_DAYS,
  PRICE_DROP_MIN_P,
  ROW_SIZE,
} from './v1-weights';

export type RowId = HomeFeedRow['rowId'];

export interface FeedInput {
  readonly candidates: readonly Candidate[];
  readonly model: ProfileModel;
  /** One search, 3 or more views, or any save. */
  readonly warm: boolean;
  /** The place name for titles. Facts only. */
  readonly place: string;
  readonly radiusKm: number | null;
  readonly variant: string;
  readonly now: number;
  readonly rng: () => number;
}

interface Entry {
  readonly candidate: Candidate;
  readonly features: FeatureVector;
  readonly total: number;
}

interface RowSpec {
  readonly id: RowId;
  readonly title: string;
  readonly eligible: (entry: Entry, input: FeedInput) => boolean;
  readonly rank: (entry: Entry) => number;
}

const DAY_MS = 86_400_000;

function listedWithinDays(entry: Entry, now: number): boolean {
  const card = entry.candidate.card;
  if (card.listedAt !== null) return now - Date.parse(card.listedAt) <= NEW_WINDOW_DAYS * DAY_MS;
  return card.daysOnMarket !== null && card.daysOnMarket <= NEW_WINDOW_DAYS;
}

const byTotal = (entry: Entry): number => entry.total;
const byFreshness = (entry: Entry): number =>
  NEW_ROW_WEIGHTS.freshness * entry.features.freshness + NEW_ROW_WEIGHTS.geo * entry.features.geo;

function specs(place: string, warm: boolean): RowSpec[] {
  const picked: RowSpec = {
    id: 'picked',
    title: `Picked for you in ${place}`,
    eligible: () => true,
    rank: byTotal,
  };
  const fresh = (id: 'new' | 'just-listed', title: string): RowSpec => ({
    id,
    title,
    eligible: (entry, input) => listedWithinDays(entry, input.now),
    rank: byFreshness,
  });
  const drops: RowSpec = {
    id: 'price-drops',
    title: warm ? 'Price drops in your range' : `Price drops in ${place}`,
    eligible: (entry, input) =>
      cutShare(entry.candidate.card, input.now) > 0 &&
      (!warm || entry.features.price >= PRICE_DROP_MIN_P),
    rank: byTotal,
  };
  const near: RowSpec = {
    id: 'near-you',
    title: `Homes near ${place}`,
    eligible: () => true,
    rank: byTotal,
  };
  const soon: RowSpec = {
    id: 'coming-soon',
    title: `Coming soon in ${place}`,
    eligible: (entry) => entry.candidate.card.status === 'Coming Soon',
    rank: byTotal,
  };
  return warm
    ? [picked, fresh('new', `New in ${place}`), drops, near, soon]
    : [near, fresh('just-listed', `Just listed in ${place}`), soon, drops];
}

/**
 * Builds the rows in page order. One `shown` set spans the page, so a later row never repeats a
 * listing or a home of an earlier row. A row with fewer than `MIN_ROW_CARDS` cards is left out and
 * adds nothing to `shown`.
 */
export function buildRows(input: FeedInput): HomeFeedRow[] {
  const entries: Entry[] = input.candidates.map((candidate) => {
    const features = computeFeatures(candidate, input.model, input.radiusKm, input.now);
    return { candidate, features, total: score(features) };
  });

  const shownListings = new Set<string>();
  const shownHomes = new Set<string>();
  const rows: HomeFeedRow[] = [];

  for (const spec of specs(input.place, input.warm)) {
    const pool: Scored[] = entries
      .filter(
        (entry) =>
          !shownListings.has(entry.candidate.card.id) &&
          !shownHomes.has(entry.candidate.card.propertyId) &&
          spec.eligible(entry, input),
      )
      .map((entry) => ({ candidate: entry.candidate, score: spec.rank(entry) }))
      .sort((a, b) => b.score - a.score || a.candidate.card.id.localeCompare(b.candidate.card.id));

    const picked = selectRow(pool, ROW_SIZE, input.rng);
    if (picked.length < MIN_ROW_CARDS) continue;
    for (const { item } of picked) {
      shownListings.add(item.candidate.card.id);
      shownHomes.add(item.candidate.card.propertyId);
    }
    rows.push({
      rowId: spec.id,
      title: spec.title,
      modelVersion: MODEL_VERSION,
      variant: input.variant,
      listings: picked.map(({ item, explore }) => ({ listing: item.candidate.card, explore })),
    });
  }
  return rows;
}
