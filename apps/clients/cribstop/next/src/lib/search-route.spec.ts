import { parseSearchPath } from '@cribstop/property-contracts';
import type { Geocoder } from './place-resolve';
import { searchRouteProps } from './search-route';

jest.mock('@/app/api/_lib/nominatim-fetch', () => ({ proxyNominatim: jest.fn() }));
// Neighborhood resolution tries our own data first (#393). These tests exercise the Nominatim
// fallback path only, so the gateway call is stubbed to "no match" rather than hitting a real
// network address.
jest.mock('@/app/api/_lib/gateway', () => ({
  fetchGateway: jest.fn(async () => ({ ok: false, json: async () => null })),
}));

const POLYGON = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
};
const VA = { state: 'Virginia', 'ISO3166-2-lvl4': 'US-VA' };

const geocoder = (results: any[] | null): Geocoder => jest.fn(async () => results);

async function props(path: string, query = '', geocode: Geocoder = geocoder([])) {
  const parsed = parseSearchPath(path.split('/'));
  if (!parsed) throw new Error(`not a search path: ${path}`);
  return searchRouteProps(parsed, new URLSearchParams(query), geocode);
}

describe('searchRouteProps (#350)', () => {
  it('resolves a city slug to the exact city filter and keeps filters in the query', async () => {
    const geocode = geocoder([
      {
        type: 'city',
        name: 'Winston-Salem',
        address: { city: 'Winston-Salem', state: 'North Carolina' },
      },
    ]);
    const result = await props(
      '/winston-salem-nc/homes-for-sale',
      'beds=2&sort=price_asc&city=X',
      geocode,
    );
    expect(result).toMatchObject({
      status: 'found',
      initialQuery: 'beds=2&sort=price_asc',
      place: {
        filters: { city: 'Winston-Salem', state: 'NC', listingType: 'sale' },
        label: 'Winston-Salem, NC',
      },
    });
  });

  it('gives the same props for the same URL, so a reload restores the same search', async () => {
    const geocode = geocoder([
      { type: 'city', name: 'Alexandria', address: { city: 'Alexandria', ...VA } },
    ]);
    const first = await props('/alexandria-va/homes-for-rent', 'type=all&page=3', geocode);
    const second = await props('/alexandria-va/homes-for-rent', 'type=all&page=3', geocode);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ initialQuery: 'page=3', place: { query: 'type=all' } });
  });

  it('uses the boundary for a neighborhood, in place of the neighborhood and city filters', async () => {
    const geocode = geocoder([
      {
        type: 'suburb',
        name: 'Del Ray',
        address: { suburb: 'Del Ray', city: 'Alexandria', ...VA },
        geojson: POLYGON,
      },
    ]);
    const result = await props('/alexandria-va/del-ray-neighborhood/homes-for-sale', '', geocode);
    expect(result).toMatchObject({
      status: 'found',
      place: {
        filters: { state: 'VA', boundary: JSON.stringify(POLYGON) },
        label: 'Del Ray, Alexandria, VA',
      },
    });
    expect(JSON.stringify(result)).not.toContain('"neighborhood"');
  });

  describe('street scope', () => {
    const ROAD = { type: 'road', address: { road: 'King Street', city: 'Alexandria', ...VA } };
    const CITY = { type: 'city', name: 'Alexandria', address: { city: 'Alexandria', ...VA } };
    /** Answers the street lookup and the city-boundary lookup separately. */
    const streetGeocoder =
      (city: any[] | null): Geocoder =>
      async (params) =>
        params.q?.startsWith('king st') ? [ROAD] : city;

    it('scopes a street to its city boundary, never to the whole state', async () => {
      const result = await props(
        '/alexandria-va/king-st/homes-for-sale',
        '',
        streetGeocoder([{ ...CITY, geojson: POLYGON }]),
      );
      expect(result).toMatchObject({
        place: {
          filters: { street: 'king st', state: 'VA', boundary: JSON.stringify(POLYGON) },
          label: 'King Street, Alexandria, VA',
        },
      });
    });

    it('falls back to street + city + state when no boundary resolves', async () => {
      for (const city of [[CITY], null]) {
        const result = await props(
          '/alexandria-va/king-st/homes-for-sale',
          '',
          streetGeocoder(city),
        );
        expect(result).toMatchObject({
          place: { filters: { street: 'king st', city: 'Alexandria', state: 'VA' } },
        });
      }
    });

    it('scopes a street under a ZIP to the ZIP', async () => {
      const result = await props(
        '/alexandria-va/22314/king-st/homes-for-sale',
        '',
        streetGeocoder([]),
      );
      expect(result).toMatchObject({ place: { filters: { street: 'king st', zip: '22314' } } });
      expect(result.status === 'found' && result.place.filters.boundary).toBeFalsy();
    });
  });

  it('scopes a ZIP to itself', async () => {
    const zip = await props(
      '/alexandria-va/22314/homes-for-sale',
      '',
      geocoder([{ type: 'postcode', address: { postcode: '22314', city: 'Alexandria', ...VA } }]),
    );
    expect(zip).toMatchObject({
      place: { filters: { zip: '22314' }, label: 'Alexandria, VA 22314' },
    });
  });

  it('uses the boundary and state for a county, never the county name', async () => {
    const result = await props(
      '/fairfax-county-va/homes-for-sale',
      '',
      geocoder([
        {
          type: 'administrative',
          addresstype: 'county',
          name: 'Fairfax County',
          address: { county: 'Fairfax County', ...VA },
          geojson: POLYGON,
        },
      ]),
    );
    expect(result).toMatchObject({
      place: {
        filters: { state: 'VA', boundary: JSON.stringify(POLYGON) },
        label: 'Fairfax County, VA',
      },
    });
  });

  it('reports an unknown slug as not found, and a failed lookup as an error', async () => {
    expect(await props('/nowhere-va/homes-for-sale', '', geocoder([]))).toEqual({
      status: 'not-found',
    });
    const wrongState = geocoder([
      { type: 'city', name: 'Alexandria', address: { city: 'Alexandria', state: 'Louisiana' } },
    ]);
    expect(await props('/alexandria-va/homes-for-sale', '', wrongState)).toEqual({
      status: 'not-found',
    });
    expect(await props('/alexandria-va/homes-for-sale', '', geocoder(null))).toEqual({
      status: 'error',
    });
  });

  it('puts the boundary in the URL only for a map-area search', async () => {
    const result = await props('/homes-for-sale', 'bounds=39,-77,38,-78&minPrice=100000');
    expect(result).toMatchObject({
      status: 'found',
      initialQuery: 'minPrice=100000',
      place: { label: '', filters: { listingType: 'sale' } },
    });
    expect(result.status === 'found' && result.place.filters.boundary).toContain('Polygon');
  });
});
