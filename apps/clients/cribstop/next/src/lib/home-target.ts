/**
 * Which place the home page rows target. One pure function owns the precedence, so no row
 * decides alone. The home page used to read the IP region in one row and the last search in
 * another, and the two disagreed.
 *
 * Precedence, first match wins:
 *  1. explicit      the search the visitor is making now (URL place)
 *  2. last-search   the newest recent search, no older than `LAST_SEARCH_MAX_AGE_DAYS`
 *  3. geolocation   the browser position, only when permission is already granted
 *  4. looking-for   the first city place in the "What I'm looking for" preferences (#768)
 *  5. saved-home    the city of the newest saved home (#364)
 *  6. ip            the IP region (#363). The ingress may hide the visitor IP, so it ranks low.
 *  7. default       the configured default market, if any
 */

export type TargetSource =
  | 'explicit'
  | 'last-search'
  | 'geolocation'
  | 'looking-for'
  | 'saved-home'
  | 'ip'
  | 'default';

export interface TargetPlace {
  city: string;
  state: string;
}

export interface HomeTarget extends TargetPlace {
  source: TargetSource;
}

export interface LastSearch extends TargetPlace {
  /** Epoch ms. Older entries have none, and count as fresh because their age is unknown. */
  searchedAt?: number | null;
}

export interface HomeTargetInputs {
  explicit?: TargetPlace | null;
  lastSearch?: LastSearch | null;
  geolocation?: TargetPlace | null;
  lookingFor?: TargetPlace | null;
  savedHome?: TargetPlace | null;
  ip?: TargetPlace | null;
  defaultMarket?: TargetPlace | null;
  /** Epoch ms. Injected so tests control the clock. */
  now?: number;
}

export const LAST_SEARCH_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function usable(place: TargetPlace | null | undefined): place is TargetPlace {
  return !!place && !!place.city?.trim() && /^[A-Za-z]{2}$/.test(place.state ?? '');
}

function fresh(search: LastSearch, now: number): boolean {
  if (search.searchedAt == null) return true;
  return now - search.searchedAt <= LAST_SEARCH_MAX_AGE_DAYS * DAY_MS;
}

function pick(place: TargetPlace, source: TargetSource): HomeTarget {
  return { city: place.city.trim(), state: place.state.toUpperCase(), source };
}

export function resolveHomeTarget(inputs: HomeTargetInputs): HomeTarget | null {
  const now = inputs.now ?? Date.now();
  if (usable(inputs.explicit)) return pick(inputs.explicit, 'explicit');
  if (usable(inputs.lastSearch) && fresh(inputs.lastSearch, now)) {
    return pick(inputs.lastSearch, 'last-search');
  }
  if (usable(inputs.geolocation)) return pick(inputs.geolocation, 'geolocation');
  if (usable(inputs.lookingFor)) return pick(inputs.lookingFor, 'looking-for');
  if (usable(inputs.savedHome)) return pick(inputs.savedHome, 'saved-home');
  if (usable(inputs.ip)) return pick(inputs.ip, 'ip');
  if (usable(inputs.defaultMarket)) return pick(inputs.defaultMarket, 'default');
  return null;
}

/** The first `city` place of the preferences. A zip, street or neighborhood has no city to scope by. */
export function placeFromLookingFor(
  items: { places: { kind: string; city?: string; state: string }[] }[],
): TargetPlace | null {
  for (const item of items) {
    const place = item.places.find((p) => p.kind === 'city' && p.city && p.state);
    if (place?.city) return { city: place.city, state: place.state };
  }
  return null;
}

/**
 * A coordinate rounded to two decimals (about 1 km). The reverse lookup needs no more, and the
 * server cache then shares one entry between nearby visitors.
 */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The same-visit refinement bet (#834). Off unless the build flag or the local flag is set. */
export function sameVisitRefineEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_FEED_SAME_VISIT_REFINE === '1') return true;
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage.getItem('cribstop_feed_same_visit') === '1'
    );
  } catch {
    return false;
  }
}

/** Debug output is off unless the build flag or the local flag is set. */
export function homeTargetDebugEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_HOME_TARGET_DEBUG === '1') return true;
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage.getItem('cribstop_debug_home_target') === '1'
    );
  } catch {
    return false;
  }
}

// --- Weighted inference (#834) ---------------------------------------------------------------
// `resolveHomeTarget` above stays the precedence rule for a search or position the visitor gave
// now. `inferHomeTarget` adds the weighted signals below it and says how sure it is.
// The input is only the visitor's own actions and the IP region. No demographic signal enters.

export interface TimedPlace extends TargetPlace {
  /** Epoch ms of the action. Missing means the age is unknown, and counts as new. */
  at?: number | null;
}

export type InferredSource = TargetSource | 'viewed-homes' | 'visit-views' | 'rotation';

export interface InferredTarget extends TargetPlace {
  source: InferredSource;
  /** 0 to 1. The summed weight of the winning place, capped at 1. */
  confidence: number;
  /** Search radius in km. Null means the whole state. */
  radiusKm: number | null;
}

export interface InferInputs extends HomeTargetInputs {
  /** Saved homes of this visitor. */
  savedPlaces?: TimedPlace[];
  /** Viewed homes, newest first. Only the first `MAX_VIEWED` count. */
  viewedPlaces?: TimedPlace[];
  /** Cold-start markets, from config. Never a constant in code. */
  markets?: TargetPlace[];
  /** Load counter. The cold start picks `markets[loadIndex % markets.length]`. */
  loadIndex?: number;
  /** Epoch ms. Start of this visit (tab session). */
  visitStart?: number;
  /** Flag for the same-visit refinement bet. */
  sameVisitRefine?: boolean;
}

export const SIGNAL_WEIGHT = {
  search: 1.0,
  geolocation: 1.0,
  lookingFor: 0.9,
  save: 0.8,
  view: 0.25,
  visitView: 0.5,
  ip: 0.3,
} as const;
export const VIEW_WEIGHT_CAP = 0.6;
export const MAX_VIEWED = 50;
export const SEARCH_HALF_LIFE_DAYS = 14;
export const SAVE_HALF_LIFE_DAYS = 30;
export const VIEW_HALF_LIFE_DAYS = 7;
/** Views in one place, inside one visit, before the same-visit refinement acts. */
export const SAME_VISIT_MIN_VIEWS = 2;

export const RADIUS_HIGH_KM = 8;
export const RADIUS_MID_KM = 20;
export const CONFIDENCE_HIGH = 0.8;
export const CONFIDENCE_MID = 0.4;

export function radiusForConfidence(confidence: number): number | null {
  if (confidence >= CONFIDENCE_HIGH) return RADIUS_HIGH_KM;
  if (confidence >= CONFIDENCE_MID) return RADIUS_MID_KM;
  return null;
}

function decay(at: number | null | undefined, now: number, halfLifeDays?: number): number {
  if (halfLifeDays == null || at == null) return 1;
  const ageDays = Math.max(0, now - at) / DAY_MS;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function placeKey(place: TargetPlace): string {
  return `${place.city.trim().toLowerCase()}|${place.state.toUpperCase()}`;
}

/** Lower is stronger. Breaks a tie between equal weights. */
const RANK: Record<InferredSource, number> = {
  explicit: 0,
  'visit-views': 1,
  'last-search': 2,
  geolocation: 3,
  'looking-for': 4,
  'saved-home': 5,
  'viewed-homes': 6,
  ip: 7,
  default: 8,
  rotation: 9,
};

interface Contribution {
  place: TargetPlace;
  source: InferredSource;
  weight: number;
}

function collect(inputs: InferInputs, now: number): Contribution[] {
  const out: Contribution[] = [];
  const add = (place: TargetPlace | null | undefined, source: InferredSource, weight: number) => {
    if (usable(place) && weight > 0) out.push({ place, source, weight });
  };

  add(inputs.explicit, 'explicit', SIGNAL_WEIGHT.search);
  if (usable(inputs.lastSearch)) {
    add(
      inputs.lastSearch,
      'last-search',
      SIGNAL_WEIGHT.search * decay(inputs.lastSearch.searchedAt, now, SEARCH_HALF_LIFE_DAYS),
    );
  }
  add(inputs.geolocation, 'geolocation', SIGNAL_WEIGHT.geolocation);
  add(inputs.lookingFor, 'looking-for', SIGNAL_WEIGHT.lookingFor);
  for (const save of inputs.savedPlaces ?? []) {
    add(save, 'saved-home', SIGNAL_WEIGHT.save * decay(save.at, now, SAVE_HALF_LIFE_DAYS));
  }
  add(inputs.ip, 'ip', SIGNAL_WEIGHT.ip);

  // Views: one cluster per place. A view in this visit may count more (the flagged bet).
  const views = (inputs.viewedPlaces ?? []).filter((v) => usable(v)).slice(0, MAX_VIEWED);
  const inVisit = (v: TimedPlace) =>
    !!inputs.sameVisitRefine && inputs.visitStart != null && (v.at ?? 0) >= inputs.visitStart;
  const visitCount = new Map<string, number>();
  for (const v of views) {
    if (inVisit(v)) visitCount.set(placeKey(v), (visitCount.get(placeKey(v)) ?? 0) + 1);
  }
  const refined = new Set(
    [...visitCount].filter(([, n]) => n >= SAME_VISIT_MIN_VIEWS).map(([k]) => k),
  );
  const viewSum = new Map<string, { place: TargetPlace; sum: number }>();
  for (const v of views) {
    const key = placeKey(v);
    if (refined.has(key) && inVisit(v)) {
      add(v, 'visit-views', SIGNAL_WEIGHT.visitView);
      continue;
    }
    const entry = viewSum.get(key) ?? { place: v, sum: 0 };
    entry.sum += SIGNAL_WEIGHT.view * decay(v.at, now, VIEW_HALF_LIFE_DAYS);
    viewSum.set(key, entry);
  }
  for (const { place, sum } of viewSum.values()) {
    add(place, 'viewed-homes', Math.min(VIEW_WEIGHT_CAP, sum));
  }
  return out;
}

function finish(group: Contribution[], pickedSource?: InferredSource): InferredTarget {
  const confidence = Math.min(
    1,
    group.reduce((total, c) => total + c.weight, 0),
  );
  const strongest = [...group].sort(
    (a, b) => RANK[a.source] - RANK[b.source] || b.weight - a.weight,
  )[0];
  const place = strongest.place;
  return {
    city: place.city.trim(),
    state: place.state.toUpperCase(),
    source: pickedSource ?? strongest.source,
    confidence,
    radiusKm: radiusForConfidence(confidence),
  };
}

/**
 * One target place, with a confidence and a radius.
 *
 * 1. A search or position the visitor gave (`resolveHomeTarget` precedence) wins. This is the
 *    high-confidence path of #822. In the flagged bet, 2 or more views in one place in this visit
 *    replace a search or position that is not explicit.
 * 2. With none of those, the place with the highest summed weight wins.
 * 3. With no signal at all, the cold start rotates through the licensed markets.
 */
export function inferHomeTarget(inputs: InferInputs): InferredTarget | null {
  const now = inputs.now ?? Date.now();
  const byPlace = new Map<string, Contribution[]>();
  for (const c of collect(inputs, now)) {
    const key = placeKey(c.place);
    byPlace.set(key, [...(byPlace.get(key) ?? []), c]);
  }

  const refinedGroup = [...byPlace.values()].find((g) => g.some((c) => c.source === 'visit-views'));
  const precedence = resolveHomeTarget({
    explicit: inputs.explicit,
    lastSearch: inputs.lastSearch,
    geolocation: inputs.geolocation,
    now,
  });
  if (precedence && !(refinedGroup && precedence.source !== 'explicit')) {
    return finish(byPlace.get(placeKey(precedence)) ?? [], precedence.source);
  }
  if (refinedGroup) return finish(refinedGroup, 'visit-views');

  const groups = [...byPlace.values()].map((group) => ({
    group,
    total: group.reduce((t, c) => t + c.weight, 0),
    rank: Math.min(...group.map((c) => RANK[c.source])),
  }));
  groups.sort((a, b) => b.total - a.total || a.rank - b.rank);
  if (groups.length > 0) return finish(groups[0].group);

  const markets = (inputs.markets ?? []).filter(usable);
  if (markets.length === 0) return null;
  const market = markets[Math.abs(inputs.loadIndex ?? 0) % markets.length];
  return {
    city: market.city.trim(),
    state: market.state.toUpperCase(),
    source: 'rotation',
    confidence: 0,
    radiusKm: null,
  };
}

export interface SideSignal {
  side: 'sale' | 'rent';
  at: number;
}

/** Rent first when the last search was rent, or most views in the last 7 days were rent. */
export function prefersRentFirst(opts: {
  lastSearchSide?: 'rent' | 'sale' | 'other' | null;
  views?: SideSignal[];
  now?: number;
}): boolean {
  if (opts.lastSearchSide === 'rent') return true;
  const now = opts.now ?? Date.now();
  const recent = (opts.views ?? []).filter((v) => now - v.at <= 7 * DAY_MS);
  const rent = recent.filter((v) => v.side === 'rent').length;
  return rent > recent.length - rent;
}
