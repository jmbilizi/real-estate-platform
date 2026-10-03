import { parseSearchPath } from '@cribstop/property-contracts';
import type { Geocoder } from './place-resolve';
import { searchRouteProps } from './search-route';

jest.mock('@/app/api/_lib/nominatim-fetch', () => ({ proxyNominatim: jest.fn() }));
jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));

const VIEWPORT = 'viewport=-77.0602,38.7977,-77.0301,38.8189';

async function props(path: string, query: string, geocode: Geocoder) {
  const parsed = parseSearchPath(path.split('/'));
  if (!parsed) throw new Error(`not a search path: ${path}`);
  return searchRouteProps(parsed, new URLSearchParams(query), geocode);
}

/** The map view survives a direct load of a place path and of a path with no place (#558). */
describe('searchRouteProps keeps the map view', () => {
  it('keeps viewport in the query of a city path', async () => {
    const geocode: Geocoder = jest.fn(async () => [
      { type: 'city', name: 'Alexandria', address: { city: 'Alexandria', state: 'Virginia' } },
    ]) as never;

    const result = await props('/alexandria-va/homes-for-sale', `${VIEWPORT}&beds=2`, geocode);

    expect(result).toMatchObject({ status: 'found' });
    const query = new URLSearchParams((result as { initialQuery: string }).initialQuery);
    expect(query.get('viewport')).toBe('-77.0602,38.7977,-77.0301,38.8189');
    expect(query.get('beds')).toBe('2');
  });

  it('keeps viewport on a search with no place, and still reads the old bounds as a place', async () => {
    const geocode: Geocoder = jest.fn(async () => []) as never;

    const result = await props(
      '/homes-for-sale',
      `${VIEWPORT}&bounds=39,-77,38,-78&minPrice=100000`,
      geocode,
    );

    const found = result as { initialQuery: string; place: { filters: { boundary?: string } } };
    expect(new URLSearchParams(found.initialQuery).get('viewport')).toBe(
      '-77.0602,38.7977,-77.0301,38.8189',
    );
    expect(new URLSearchParams(found.initialQuery).has('bounds')).toBe(false);
    expect(found.place.filters.boundary).toContain('Polygon');
  });
});
