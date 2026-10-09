import { AREA_PARAM } from '@/lib/draw-area';
import { VIEWPORT_PARAM } from '@/lib/map-bounds';
import {
  citySegment,
  parseSearchPath,
  searchPath,
  type SearchPlace,
} from '@cribstop/property-contracts';

/**
 * The neighborhood drill-down URL (#533): `/{city-st}/{slug}-neighborhood/homes-for-sale`. The path
 * carries the city, state, neighborhood and listing type. The query carries only what the path
 * cannot say. `from` records the grouped view the arrow returns to, and only when that view is not
 * the plain city view of the same type.
 *
 * `from` is `<scope>` or `<scope>.<type>`. The scope is `city` (the neighborhood's own city, the
 * default), a county path segment (`fairfax-county-va`), a state code (`VA`), or `us` (no region).
 * `.` and `-` are the separators because the URL writer leaves both as they are.
 */

export const FROM_PARAM = 'from';
export type ViewType = 'sale' | 'rent' | 'sold' | 'all';

const SCOPE_CITY = 'city';
const SCOPE_NONE = 'us';
const VIEW_TYPES: readonly string[] = ['sale', 'rent', 'sold', 'all'];

/** Keys the neighborhood path or the group state own. The rest of a query is carried over. */
const OWNED_KEYS = [
  'page',
  'groupBy',
  'groupDrill',
  'groupLabel',
  FROM_PARAM,
  'groupFrom',
  'type',
  'listingType',
  'city',
  'state',
  'neighborhood',
  // The map view and a drawn area belong to one place. A new path starts with the place's own fit.
  VIEWPORT_PARAM,
  AREA_PARAM,
] as const;

export function withoutOwnedKeys(params: URLSearchParams): URLSearchParams {
  const rest = new URLSearchParams(params);
  for (const key of OWNED_KEYS) rest.delete(key);
  return rest;
}

const segmentFor = (type: ViewType) => (type === 'rent' ? 'homes-for-rent' : 'homes-for-sale');
const overrideFor = (type: ViewType) => (type === 'all' || type === 'sold' ? type : null);

export interface DrillTarget {
  readonly name: string;
  readonly city: string;
  readonly state: string;
}

const bareScope = (place: SearchPlace) =>
  searchPath(place, 'homes-for-sale')
    .slice(1)
    .replace(/\/homes-for-sale$/, '');

/**
 * The scope token of a grouped view, relative to the neighborhood it drills into. `''` is the
 * default: the grouped view was the neighborhood's own city. `filters` are the filters the grouped
 * view searched with, so a view with no path place still reads as state or no region.
 */
export function scopeOf(
  place: SearchPlace | null | undefined,
  filters: { city?: string; state?: string },
  target: Pick<DrillTarget, 'city' | 'state'>,
): string {
  const sameCity = (city: string, state: string) =>
    citySegment(city, state) === citySegment(target.city, target.state);
  if (place) {
    if (place.kind === 'county') return bareScope(place);
    return sameCity(place.city, place.state) ? '' : SCOPE_NONE;
  }
  if (filters.city && filters.state && sameCity(filters.city, filters.state)) return '';
  if (filters.state && !filters.city) return filters.state.toUpperCase();
  return SCOPE_NONE;
}

/** The `from` value, or `undefined` when the arrow's default target is right. */
export function fromToken(
  scope: string,
  groupedType: ViewType | undefined,
  type: ViewType,
): string | undefined {
  const typePart = groupedType && groupedType !== type ? `.${groupedType}` : '';
  if (!scope && !typePart) return undefined;
  return `${scope || SCOPE_CITY}${typePart}`;
}

export function parseFromToken(token: string | null | undefined): {
  scope: string;
  type?: ViewType;
} {
  const [scope = '', type] = (token ?? '').split('.');
  return {
    scope: scope === SCOPE_CITY ? '' : scope,
    ...(type && VIEW_TYPES.includes(type) ? { type: type as ViewType } : {}),
  };
}

/**
 * A drill-down URL. `carried` holds the query the grouped view had, such as filters and the group
 * order. `groupedType` is the listing type the grouped view showed.
 */
export function neighborhoodDrillUrl(options: {
  target: DrillTarget;
  type: ViewType;
  scope: string;
  groupedType?: ViewType;
  carried?: URLSearchParams;
}): string {
  const { target, type, scope, groupedType, carried } = options;
  const params = new URLSearchParams();
  const override = overrideFor(type);
  if (override) params.set('type', override);
  withoutOwnedKeys(carried ?? new URLSearchParams()).forEach((value, key) =>
    params.append(key, value),
  );
  const from = fromToken(scope, groupedType, type);
  if (from) params.set(FROM_PARAM, from);
  const path = searchPath({ kind: 'neighborhood', ...target }, segmentFor(type));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** True for an old drill-down query: a neighborhood with its city and state (#525). */
export function hasLegacyDrill(params: URLSearchParams): boolean {
  return ['neighborhood', 'city', 'state'].every((key) => Boolean(params.get(key)));
}

/**
 * The clean URL for an old drill-down link (#525). It kept the neighborhood, city, state and
 * `groupFrom=<city>|<state>|<type>` in the query of the grouped view's own path. `place` is that
 * path's place. `null` when `params` hold no neighborhood, city and state.
 */
export function legacyDrillUrl(
  place: SearchPlace | null,
  type: ViewType,
  params: URLSearchParams,
): string | null {
  if (!hasLegacyDrill(params)) return null;
  const target: DrillTarget = {
    name: params.get('neighborhood') as string,
    city: params.get('city') as string,
    state: params.get('state') as string,
  };
  const groupFrom = params.get('groupFrom');
  const [city = '', state = '', groupedType] = (groupFrom ?? '').split('|');
  // A link with no `groupFrom` was made by hand. Its way back is the neighborhood's own city.
  const scopeFilters = groupFrom === null ? target : { city, state };
  return neighborhoodDrillUrl({
    target,
    type,
    scope: scopeOf(
      place,
      { city: scopeFilters.city || undefined, state: scopeFilters.state || undefined },
      target,
    ),
    groupedType: VIEW_TYPES.includes(groupedType ?? '') ? (groupedType as ViewType) : undefined,
    carried: params,
  });
}

/** The grouped view the arrow returns to. It derives from the path, and `from` overrides it. */
export function backToGroupsUrl(options: {
  target: Pick<DrillTarget, 'city' | 'state'>;
  type: ViewType;
  from?: string | null;
  current: URLSearchParams;
}): string {
  const { target, type, from, current } = options;
  const { scope, type: fromType } = parseFromToken(from);
  const groupedType = fromType ?? type;
  const segment = segmentFor(groupedType);
  const params = withoutOwnedKeys(current);
  const override = overrideFor(groupedType);
  if (override) params.set('type', override);
  params.set('groupBy', 'neighborhood');

  let path: string | undefined;
  if (scope === SCOPE_NONE) {
    path = `/${segment}`;
  } else if (/^[A-Z]{2}$/.test(scope)) {
    path = `/${segment}`;
    params.set('state', scope);
  } else if (scope && parseSearchPath([scope, segment])?.place?.kind === 'county') {
    path = `/${scope}/${segment}`;
  }
  if (path === undefined) {
    const zip = params.get('zip');
    if (zip && /^\d{5}$/.test(zip)) {
      params.delete('zip');
      path = searchPath({ kind: 'zip', zip, ...target }, segment);
    } else {
      path = searchPath({ kind: 'city', ...target }, segment);
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
