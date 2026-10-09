import {
  buildListingsQuery,
  FORWARDABLE_GROUPS_PARAMS,
  FORWARDABLE_LISTING_PARAMS,
  FORWARDABLE_MAP_PARAMS,
  FORWARDABLE_NEIGHBORHOODS_PARAMS,
} from '@/app/api/_lib/listings-query';
import { areaToParam, ringToGeoJson } from './draw-area';
import { filtersToSearchParams, parseFiltersFromSearchParams } from './listing-filters';
import { toSearchParams } from './api/listings';
import { withoutOwnedKeys } from './neighborhood-url';

/** #747. The drawn area in the URL, the request and the proxy. */
const AREA = ringToGeoJson([
  [-77.06, 38.79],
  [-77.04, 38.79],
  [-77.04, 38.81],
  [-77.06, 38.81],
  [-77.06, 38.79],
]);
const PARAM = areaToParam(AREA) as string;

describe('area in the page URL', () => {
  it('parses to a GeoJSON string and writes back the same URL form', () => {
    const filters = parseFiltersFromSearchParams(new URLSearchParams({ area: PARAM }));
    expect(filters.area).toBe(AREA);
    expect(filtersToSearchParams(filters).get('area')).toBe(PARAM);
  });

  it('replaces the viewport: the parser keeps the area and the writer writes one of the two', () => {
    const both = parseFiltersFromSearchParams(
      new URLSearchParams({ area: PARAM, viewport: '-77.06,38.79,-77.03,38.81' }),
    );
    expect(both.area).toBe(AREA);
    expect(both.bounds).toBeUndefined();

    const written = filtersToSearchParams({
      area: AREA,
      bounds: { west: -77.06, south: 38.79, east: -77.03, north: 38.81 },
    });
    expect(written.has('area')).toBe(true);
    expect(written.has('viewport')).toBe(false);
  });

  it('clears a stale area from the base query when a filter is removed', () => {
    const written = filtersToSearchParams({}, new URLSearchParams({ area: PARAM, tracking: '1' }));
    expect(written.has('area')).toBe(false);
    expect(written.get('tracking')).toBe('1');
  });

  it('is dropped when a drill-down moves to another place', () => {
    expect(withoutOwnedKeys(new URLSearchParams({ area: PARAM, beds: '2' })).has('area')).toBe(
      false,
    );
  });
});

describe('area in the request', () => {
  it('goes to the API as the GeoJSON string', () => {
    expect(toSearchParams({ area: AREA }).get('area')).toBe(AREA);
  });

  it.each([
    ['list', FORWARDABLE_LISTING_PARAMS],
    ['map', FORWARDABLE_MAP_PARAMS],
    ['neighborhoods', FORWARDABLE_NEIGHBORHOODS_PARAMS],
    ['zip and broker groups', FORWARDABLE_GROUPS_PARAMS],
  ])('the %s proxy forwards it', (_name, allowed) => {
    const query = buildListingsQuery(
      new URLSearchParams({ area: AREA, city: 'Alexandria' }),
      allowed,
    );
    expect(new URLSearchParams(query).get('area')).toBe(AREA);
  });

  it('is not a place, so a text query still rides alongside it', () => {
    const query = buildListingsQuery(new URLSearchParams({ area: AREA, query: 'Alexandria, VA' }));
    expect(new URLSearchParams(query).get('query')).toBe('Alexandria, VA');
  });
});
