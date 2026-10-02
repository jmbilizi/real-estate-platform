import type { ParsedSearchPath } from '@cribstop/property-contracts';
import type { SearchPathPlace } from '@/components/SearchExperience';
import { type Geocoder, resolvePlace } from '@/lib/place-resolve';
import {
  boundsToBoundary,
  hasDrillDown,
  listingTypeForPath,
  withoutPlaceKeys,
} from '@/lib/search-place';

/** Server-side props for a search path page (#350). */

export type SearchRouteProps =
  | { readonly status: 'found'; readonly initialQuery: string; readonly place: SearchPathPlace }
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

export async function searchRouteProps(
  parsed: ParsedSearchPath,
  params: URLSearchParams,
  geocode?: Geocoder,
): Promise<SearchRouteProps> {
  const { listingType, override } = listingTypeForPath(parsed.segment, params.get('type'));
  const query = override ? `type=${override}` : '';

  if (parsed.place === null) {
    // A map-area search keeps its location parameters in the query string.
    const own = new URLSearchParams(params);
    own.delete('type');
    own.delete('listingType');
    own.delete('bounds');
    const boundary = own.get('boundary') ? undefined : boundsToBoundary(params.get('bounds'));
    return {
      status: 'found',
      initialQuery: own.toString(),
      place: { filters: { listingType, ...(boundary ? { boundary } : {}) }, label: '', query },
    };
  }

  const resolution = await resolvePlace(parsed.place, geocode);
  if (resolution.status !== 'found') return resolution;

  // A neighborhood drill-down (#525) keeps its scope in the query, on any path that is not itself
  // a neighborhood or street. The in-page click writes the same URL.
  const keepDrill =
    hasDrillDown(params) && parsed.place.kind !== 'neighborhood' && parsed.place.kind !== 'street';
  const own = withoutPlaceKeys(params, keepDrill);
  return {
    status: 'found',
    initialQuery: own.toString(),
    place: {
      filters: { ...resolution.filters, listingType },
      label: resolution.label,
      suggestion: resolution.suggestion,
      query,
    },
  };
}
