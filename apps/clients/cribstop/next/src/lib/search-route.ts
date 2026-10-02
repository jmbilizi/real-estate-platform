import type { ParsedSearchPath, SearchPlace } from '@cribstop/property-contracts';
import type { SearchPathPlace } from '@/components/SearchExperience';
import { legacyDrillUrl, type ViewType } from '@/lib/neighborhood-url';
import { type Geocoder, resolvePlace } from '@/lib/place-resolve';
import { boundsToBoundary, listingTypeForPath, withoutPlaceKeys } from '@/lib/search-place';

/** Server-side props for a search path page (#350). */

export type SearchRouteProps =
  | { readonly status: 'found'; readonly initialQuery: string; readonly place: SearchPathPlace }
  /** An old drill-down link (#525). The page answers 308 to the neighborhood path (#533). */
  | { readonly status: 'redirect'; readonly to: string }
  | { readonly status: 'not-found' }
  | { readonly status: 'error' };

/** A Next `searchParams` object as a query string, repeats kept. */
export function toSearchParams(
  resolved: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (Array.isArray(value)) value.forEach((entry) => params.append(key, entry));
    else if (value !== undefined) params.append(key, value);
  }
  return params;
}

/**
 * Keys a neighborhood path keeps in its query: the filters of the grouped view it came from. The
 * path says the city, state and neighborhood, so those keys never stay.
 */
const NEIGHBORHOOD_QUERY_KEYS = ['q', 'zip', 'boundary'] as const;

export async function searchRouteProps(
  parsed: ParsedSearchPath,
  params: URLSearchParams,
  geocode?: Geocoder,
): Promise<SearchRouteProps> {
  const { listingType, override } = listingTypeForPath(parsed.segment, params.get('type'));
  const query = override ? `type=${override}` : '';

  // An old drill-down link carries the city, state and neighborhood in the query (#533).
  const place = parsed.place;
  if (!place || (place.kind !== 'neighborhood' && place.kind !== 'street')) {
    const to = legacyDrillUrl(place, (override ?? listingType ?? 'all') as ViewType, params);
    if (to) return { status: 'redirect', to };
  }

  if (place === null) {
    // A map-area search keeps its location parameters in the query string.
    const own = new URLSearchParams(params);
    own.delete('type');
    own.delete('listingType');
    own.delete('bounds');
    const boundary = own.get('boundary') ? undefined : boundsToBoundary(params.get('bounds'));
    return {
      status: 'found',
      initialQuery: own.toString(),
      place: {
        filters: { listingType, ...(boundary ? { boundary } : {}) },
        label: '',
        query,
        searchPlace: null,
      },
    };
  }

  const resolution = await resolvePlace(place, geocode);
  if (resolution.status !== 'found') return resolution;

  const own = withoutPlaceKeys(params);
  if (place.kind === 'neighborhood') {
    // The exact neighborhood filter does not replace the grouped view's own filters.
    for (const key of NEIGHBORHOOD_QUERY_KEYS) {
      const value = params.get(key);
      if (value !== null && !(key === 'zip' && place.zip)) own.set(key, value);
    }
  }
  // A map-area drill-down keeps its `bounds`. They narrow the count like the card did.
  const boundary =
    place.kind === 'neighborhood' && !own.get('boundary')
      ? boundsToBoundary(params.get('bounds'))
      : undefined;
  return {
    status: 'found',
    initialQuery: own.toString(),
    place: {
      filters: { ...resolution.filters, listingType, ...(boundary ? { boundary } : {}) },
      label: resolution.label,
      suggestion: resolution.suggestion,
      query,
      searchPlace: place as SearchPlace,
    },
  };
}
