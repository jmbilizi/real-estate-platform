import { parseSearchPath } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import type { Geocoder } from './place-resolve';
import { searchRouteProps } from './search-route';

jest.mock('@/app/api/_lib/nominatim-fetch', () => ({ proxyNominatim: jest.fn() }));
// A neighborhood resolves from our own data (#533). The gateway call returns the rows a test sets.
jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
const mockedGateway = fetchGateway as jest.Mock;
const neighborhoodRow = (name: string, city: string, state = 'VA') => ({
  key: `${state}|${city}|${name}`.toLowerCase(),
  name,
  city,
  state,
  slug: name.toLowerCase().replace(/ /g, '-'),
  total: 40,
  sale: 30,
  rent: 10,
  centroid: null,
  bounds: null,
});
const ourData = (rows: unknown[]) =>
  mockedGateway.mockResolvedValue({
    ok: true,
    json: async () => ({ results: rows, total: rows.length }),
  });

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

  describe('old drill-down links redirect to the neighborhood path (#533)', () => {
    const old = 'neighborhood=Belmont&city=Ashburn&state=VA&groupFrom=%7C%7Csale&beds=2';

    it('redirects a city path', async () => {
      expect(await props('/ashburn-va/homes-for-sale', old)).toEqual({
        status: 'redirect',
        to: '/ashburn-va/belmont-neighborhood/homes-for-sale?beds=2',
      });
    });

    it('redirects a rent path and a type=all path', async () => {
      expect(
        await props('/ashburn-va/homes-for-rent', 'neighborhood=Belmont&city=Ashburn&state=VA'),
      ).toEqual({
        status: 'redirect',
        to: '/ashburn-va/belmont-neighborhood/homes-for-rent',
      });
      expect(
        await props(
          '/ashburn-va/homes-for-sale',
          'neighborhood=Belmont&city=Ashburn&state=VA&type=all',
        ),
      ).toEqual({
        status: 'redirect',
        to: '/ashburn-va/belmont-neighborhood/homes-for-sale?type=all',
      });
    });

    it('records a county path as the way back', async () => {
      expect(
        await props(
          '/loudoun-county-va/homes-for-sale',
          'neighborhood=Belmont&city=Ashburn&state=VA',
        ),
      ).toEqual({
        status: 'redirect',
        to: '/ashburn-va/belmont-neighborhood/homes-for-sale?from=loudoun-county-va',
      });
    });

    it('redirects a map-area path', async () => {
      expect(
        await props(
          '/homes-for-sale',
          'neighborhood=Belmont&city=Ashburn&state=VA&groupFrom=%7CVA%7Csale',
        ),
      ).toEqual({
        status: 'redirect',
        to: '/ashburn-va/belmont-neighborhood/homes-for-sale?from=VA',
      });
    });

    it('does not look the place up before it redirects', async () => {
      const geocode = geocoder([]);
      await props('/ashburn-va/homes-for-sale', old, geocode);
      expect(geocode).not.toHaveBeenCalled();
    });

    it('drops a lone neighborhood, which is no drill-down', async () => {
      const result = await props(
        '/ashburn-va/homes-for-sale',
        'neighborhood=Belmont',
        geocoder([{ type: 'city', name: 'Ashburn', address: { city: 'Ashburn', ...VA } }]),
      );
      expect(result).toMatchObject({ status: 'found', initialQuery: '' });
    });
  });

  describe('listing type of the path (#519)', () => {
    const geocode = geocoder([
      { type: 'city', name: 'Ashburn', address: { city: 'Ashburn', ...VA } },
    ]);

    it.each([
      ['/ashburn-va/homes-for-sale', '', 'sale', ''],
      ['/ashburn-va/homes-for-rent', '', 'rent', ''],
      ['/ashburn-va/homes-for-sale', 'type=all', undefined, 'type=all'],
      ['/ashburn-va/homes-for-rent', 'type=all', undefined, 'type=all'],
    ])('%s?%s selects %s', async (path, query, listingType, placeQuery) => {
      const result = await props(path, query, geocode);
      expect(result).toMatchObject({ place: { query: placeQuery } });
      expect((result as any).place.filters.listingType).toBe(listingType);
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

  describe('neighborhood path (#533)', () => {
    const PATH = '/ashburn-va/ashburn-village-neighborhood/homes-for-sale';
    const village = neighborhoodRow('Ashburn Village', 'Ashburn');
    const hit = {
      type: 'suburb',
      name: 'Ashburn Village',
      address: { suburb: 'Ashburn Village', city: 'Ashburn', ...VA },
      geojson: POLYGON,
    };

    beforeEach(() => ourData([village]));
    afterEach(() => mockedGateway.mockReset());

    it('filters by the exact neighborhood, city and state, and never by a boundary', async () => {
      const result = await props(PATH, '', geocoder([hit]));
      expect(result).toMatchObject({
        status: 'found',
        initialQuery: '',
        place: {
          filters: {
            neighborhood: 'Ashburn Village',
            city: 'Ashburn',
            state: 'VA',
            listingType: 'sale',
          },
          label: 'Ashburn Village, Ashburn, VA',
          searchPlace: { kind: 'neighborhood', city: 'ashburn', state: 'VA' },
        },
      });
      expect(JSON.stringify(result)).not.toContain('boundary');
    });

    it('asks the API for the slug within the city and state', async () => {
      await props(PATH, '', geocoder([]));
      const url = String(mockedGateway.mock.calls[0]?.[0]);
      const query = new URLSearchParams(url.split('?')[1]);
      expect(query.get('slug')).toBe('ashburn-village');
      expect(query.get('city')).toBe('ashburn');
      expect(query.get('state')).toBe('VA');
    });

    it('is not found for a slug that matches nothing, and is not a city search', async () => {
      ourData([]);
      expect(await props(PATH, '', geocoder([hit]))).toEqual({ status: 'not-found' });
    });

    it('is not found when the match is in another city', async () => {
      ourData([neighborhoodRow('Ashburn Village', 'Sterling')]);
      expect(await props(PATH, '', geocoder([]))).toEqual({ status: 'not-found' });
    });

    it('carries the type, the filters, the order and from, and nothing the path says', async () => {
      const result = await props(
        PATH,
        'type=all&beds=2&groupOrder=name&from=VA&city=X&state=MD&neighborhood=Y&page=2',
        geocoder([]),
      );
      expect(result).toMatchObject({
        initialQuery: 'beds=2&groupOrder=name&from=VA&page=2',
        place: { query: 'type=all' },
      });
    });

    it('keeps the text, ZIP and boundary scope of the grouped view it came from', async () => {
      const result = await props(PATH, 'q=Ashburn&zip=20147', geocoder([]));
      expect(result).toMatchObject({ initialQuery: 'q=Ashburn&zip=20147' });
    });

    it('turns map bounds into the boundary that the card counted with', async () => {
      const result = await props(PATH, 'bounds=39,-77,38,-78', geocoder([]));
      expect(result.status === 'found' && result.place.filters.boundary).toContain('Polygon');
    });

    it('answers the same for the same URL, so a reload restores the same view', async () => {
      const a = await props(PATH, 'type=all&from=city.sale', geocoder([]));
      const b = await props(PATH, 'type=all&from=city.sale', geocoder([]));
      expect(b).toEqual(a);
    });

    it('reports an error when our data cannot answer', async () => {
      mockedGateway.mockResolvedValue({ ok: false, json: async () => null });
      expect(await props(PATH, '', geocoder([]))).toEqual({ status: 'error' });
    });
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
