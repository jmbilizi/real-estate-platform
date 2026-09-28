import type { NeighborhoodsLookup } from './place-resolve';
import { resolvePlace } from './place-resolve';

jest.mock('@/app/api/_lib/nominatim-fetch', () => ({ proxyNominatim: jest.fn() }));

const VA = { state: 'Virginia', 'ISO3166-2-lvl4': 'US-VA' };
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

const geocoder = (results: any[] | null) => jest.fn(async () => results);
const lookup = (rows: any[] | null): NeighborhoodsLookup => jest.fn(async () => rows);
const PLACE = { kind: 'neighborhood' as const, name: 'Del Ray', city: 'Alexandria', state: 'VA' };

/**
 * #393: a neighborhood resolves against `GET /listings/neighborhoods` first, because Bright
 * subdivision names are frequent and Nominatim (OpenStreetMap) knows only the ones that are also
 * public neighborhoods.
 */
describe('resolvePlace — neighborhood (#393)', () => {
  it('resolves from our data alone when Nominatim has no matching hit', async () => {
    const result = await resolvePlace(
      PLACE,
      geocoder([]),
      lookup([
        {
          name: 'Del Ray',
          city: 'Alexandria',
          state: 'VA',
          slug: 'del-ray',
          total: 40,
          sale: 30,
          rent: 10,
        },
      ]),
    );

    expect(result).toEqual({
      status: 'found',
      filters: { neighborhood: 'Del Ray', city: 'Alexandria', state: 'VA' },
      label: 'Del Ray, Alexandria, VA',
    });
  });

  it('replaces the text filters with a boundary once Nominatim resolves one', async () => {
    const geocode = geocoder([
      {
        type: 'suburb',
        name: 'Del Ray',
        address: { suburb: 'Del Ray', city: 'Alexandria', ...VA },
        geojson: POLYGON,
      },
    ]);
    const result = await resolvePlace(
      PLACE,
      geocode,
      lookup([
        {
          name: 'Del Ray',
          city: 'Alexandria',
          state: 'VA',
          slug: 'del-ray',
          total: 40,
          sale: 30,
          rent: 10,
        },
      ]),
    );

    expect(result).toMatchObject({
      status: 'found',
      filters: { state: 'VA', boundary: JSON.stringify(POLYGON) },
      label: 'Del Ray, Alexandria, VA',
    });
    expect((result as { suggestion?: unknown }).suggestion).toBeDefined();
  });

  it('falls back to Nominatim when our data has no match', async () => {
    const geocode = geocoder([
      {
        type: 'suburb',
        name: 'Del Ray',
        address: { suburb: 'Del Ray', city: 'Alexandria', ...VA },
      },
    ]);
    const result = await resolvePlace(PLACE, geocode, lookup([]));

    expect(result).toMatchObject({
      status: 'found',
      filters: { neighborhood: 'Del Ray', city: 'Alexandria', state: 'VA' },
    });
  });

  it('falls back to Nominatim when our data returns an ambiguous multiple match', async () => {
    const geocode = geocoder([
      {
        type: 'suburb',
        name: 'Del Ray',
        address: { suburb: 'Del Ray', city: 'Alexandria', ...VA },
      },
    ]);
    const ambiguous = lookup([
      {
        name: 'Del Ray',
        city: 'Alexandria',
        state: 'VA',
        slug: 'del-ray',
        total: 40,
        sale: 30,
        rent: 10,
      },
      {
        name: 'Del Ray',
        city: 'Fairfax',
        state: 'VA',
        slug: 'del-ray',
        total: 6,
        sale: 6,
        rent: 0,
      },
    ]);
    const result = await resolvePlace(PLACE, geocode, ambiguous);

    expect(result).toMatchObject({ status: 'found', filters: { city: 'Alexandria' } });
  });

  it('reports not-found only when both our data and Nominatim miss', async () => {
    const result = await resolvePlace(PLACE, geocoder([]), lookup([]));
    expect(result).toEqual({ status: 'not-found' });
  });

  it('never 404s a tile link: a data-only match still renders, with no Nominatim network call needed', async () => {
    const failedGeocode = geocoder(null); // simulates a Nominatim outage
    const result = await resolvePlace(
      PLACE,
      failedGeocode,
      lookup([
        {
          name: 'Del Ray',
          city: 'Alexandria',
          state: 'VA',
          slug: 'del-ray',
          total: 40,
          sale: 30,
          rent: 10,
        },
      ]),
    );

    // A resolved status, not 'error' — Nominatim's own outage does not fail a place our data knows.
    expect(result.status).toBe('found');
  });
});
