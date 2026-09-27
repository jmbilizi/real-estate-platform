import { parseSearchPath } from '@cribstop/property-contracts';
import type { Geocoder } from './place-resolve';
import { searchRouteProps } from './search-route';

jest.mock('@/app/api/_lib/nominatim-fetch', () => ({ proxyNominatim: jest.fn() }));

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

  it('scopes a street to its city and a ZIP to itself', async () => {
    const street = await props(
      '/alexandria-va/king-street-street/homes-for-sale',
      '',
      geocoder([{ type: 'road', address: { road: 'King Street', city: 'Alexandria', ...VA } }]),
    );
    expect(street).toMatchObject({
      place: { filters: { street: 'King Street', state: 'VA' } },
    });
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
