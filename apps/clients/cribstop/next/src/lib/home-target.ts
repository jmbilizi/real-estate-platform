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
