import type { Suggestion } from '@cribstop/property-contracts';

/**
 * Where-field suggestions (#781).
 *
 * Source: our own listings, through `/api/listings/suggest` (city, ZIP and neighborhood names that
 * property-service stores). Public Nominatim is NOT used here. Its usage policy forbids
 * client-side autocomplete and allows 1 request per second in total:
 * https://operations.osmfoundation.org/policies/nominatim/
 * Nominatim stays only for a single geocode on submit (`geocodeTyped`), through the throttled
 * server proxy.
 */

export const SUGGESTIONS_UNAVAILABLE_MESSAGE = 'Suggestions unavailable, press Enter to search';

export type WhereSuggestResult =
  | { readonly status: 'ok'; readonly suggestions: any[] }
  | { readonly status: 'unavailable' };

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 100;
const cache = new Map<string, { suggestions: any[]; expiresAt: number }>();

/** Test seam. */
export function clearWhereSuggestCache(): void {
  cache.clear();
}

/** The part of the typed text that names a place: "Rockville, MD" suggests for "rockville". */
export function suggestPrefix(typed: string): string {
  return (typed.split(',')[0] ?? '').trim().toLowerCase();
}

/**
 * Maps a local suggestion to the geocoder-result shape the search bar already reads
 * (`searchTargetFor`, `formatLocationLabel`). No coordinates: a local pick has none.
 */
export function toPlaceResult(s: Suggestion): any {
  const id = `local:${s.kind}:${s.state}:${s.city}:${s.name}`.toLowerCase();
  const address: Record<string, string> = { city: s.city, state_code: s.state };
  if (s.kind === 'zip') {
    address.postcode = s.zip ?? s.name;
    return { place_id: id, type: 'postcode', name: s.name, display_name: s.name, address };
  }
  if (s.kind === 'neighborhood') {
    address.suburb = s.name;
    return {
      place_id: id,
      type: 'suburb',
      name: s.name,
      display_name: `${s.name}, ${s.city}, ${s.state}`,
      address,
    };
  }
  return {
    place_id: id,
    type: 'city',
    addresstype: 'city',
    name: s.name,
    display_name: `${s.name}, ${s.state}`,
    address,
  };
}

/**
 * Suggestions for typed text. `unavailable` is a failed request, never an empty answer: the bar
 * shows "No locations found" only for `ok` with no rows.
 */
export async function fetchWhereSuggestions(
  typed: string,
  fetcher: typeof fetch = fetch,
): Promise<WhereSuggestResult> {
  const prefix = suggestPrefix(typed);
  if (prefix.length < 2) return { status: 'ok', suggestions: [] };

  const hit = cache.get(prefix);
  if (hit && hit.expiresAt > Date.now()) return { status: 'ok', suggestions: hit.suggestions };

  try {
    const response = await fetcher(`/api/listings/suggest?q=${encodeURIComponent(prefix)}`);
    if (!response.ok) return { status: 'unavailable' };
    const body = (await response.json()) as { suggestions?: Suggestion[] };
    if (!Array.isArray(body.suggestions)) return { status: 'unavailable' };
    const suggestions = body.suggestions.map(toPlaceResult);
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(prefix, { suggestions, expiresAt: Date.now() + CACHE_TTL_MS });
    return { status: 'ok', suggestions };
  } catch {
    return { status: 'unavailable' };
  }
}
