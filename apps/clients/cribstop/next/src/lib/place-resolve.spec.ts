import type { NeighborhoodsLookup } from './place-resolve';
import { clearResolvedPlaces, resolvePlace, type SuggestLookup } from './place-resolve';

jest.mock('@/app/api/_lib/nominatim-fetch', () => ({ proxyNominatim: jest.fn() }));
// No suggest data: a city or ZIP falls back to the geocoder fake of each test.
jest.mock('@/app/api/_lib/listings-gateway', () => ({
  proxyListingsRead: jest.fn(async () => ({ ok: false })),
}));

beforeEach(() => clearResolvedPlaces());

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

const DEL_RAY = {
  name: 'Del Ray',
  city: 'Alexandria',
  state: 'VA',
  slug: 'del-ray',
  total: 40,
  sale: 30,
  rent: 10,
};

/**
 * #533: a neighborhood resolves from our own data only. The filters are the exact
 * neighborhood, city and state filters, never a boundary, so the page counts what the card counts.
 */
describe('resolvePlace — neighborhood (#533)', () => {
  it('resolves to the exact neighborhood filters with no Nominatim hit', async () => {
    const result = await resolvePlace(PLACE, geocoder([]), lookup([DEL_RAY]));
    expect(result).toEqual({
      status: 'found',
      filters: { neighborhood: 'Del Ray', city: 'Alexandria', state: 'VA' },
      label: 'Del Ray, Alexandria, VA',
    });
  });

  it('never filters by a boundary, even when Nominatim returns one', async () => {
    const geocode = geocoder([
      {
        type: 'suburb',
        name: 'Del Ray',
        address: { suburb: 'Del Ray', city: 'Alexandria', ...VA },
        geojson: POLYGON,
      },
    ]);
    const result = await resolvePlace(PLACE, geocode, lookup([DEL_RAY]));
    expect(result).toMatchObject({
      status: 'found',
      filters: { neighborhood: 'Del Ray', city: 'Alexandria', state: 'VA' },
    });
    expect((result as { filters: object }).filters).not.toHaveProperty('boundary');
    expect((result as { suggestion?: unknown }).suggestion).toBeDefined();
  });

  it('asks the API for the slug within the city and state', async () => {
    const find = lookup([DEL_RAY]);
    await resolvePlace({ ...PLACE, name: 'del ray' }, geocoder([]), find);
    expect(find).toHaveBeenCalledWith({ slug: 'del-ray', city: 'Alexandria', state: 'VA' });
  });

  it('is not found when our data has no match, even if Nominatim knows the place', async () => {
    const geocode = geocoder([
      {
        type: 'suburb',
        name: 'Del Ray',
        address: { suburb: 'Del Ray', city: 'Alexandria', ...VA },
      },
    ]);
    expect(await resolvePlace(PLACE, geocode, lookup([]))).toEqual({ status: 'not-found' });
  });

  it('keeps the city of the path when two cities share a slug', async () => {
    const other = {
      name: 'Del Ray',
      city: 'Fairfax',
      state: 'VA',
      slug: 'del-ray',
      total: 40,
      sale: 30,
      rent: 10,
    };
    const rows = [other, DEL_RAY];
    const result = await resolvePlace(PLACE, geocoder([]), lookup(rows));
    expect(result).toMatchObject({ status: 'found', filters: { city: 'Alexandria' } });
    expect(
      await resolvePlace({ ...PLACE, city: 'Fairfax' }, geocoder([]), lookup(rows)),
    ).toMatchObject({
      status: 'found',
      filters: { city: 'Fairfax' },
    });
    expect(await resolvePlace({ ...PLACE, city: 'Reston' }, geocoder([]), lookup(rows))).toEqual({
      status: 'not-found',
    });
  });

  it('reports an error when our data cannot answer, and not a missing place', async () => {
    expect(await resolvePlace(PLACE, geocoder([]), lookup(null))).toEqual({ status: 'error' });
  });

  it('still renders when Nominatim is down', async () => {
    const result = await resolvePlace(PLACE, geocoder(null), lookup([DEL_RAY]));
    expect(result.status).toBe('found');
  });
});

const suggestions = (rows: any[] | null): SuggestLookup => jest.fn(async () => rows);
const ALEXANDRIA = { kind: 'city' as const, name: 'Alexandria', city: 'Alexandria', state: 'VA' };
const NOMINATIM_CITY = [
  { type: 'city', name: 'Alexandria', address: { city: 'Alexandria', ...VA } },
];

describe('resolvePlace — our own data first (#841)', () => {
  const CITY = { kind: 'city' as const, city: 'Alexandria', state: 'VA' };
  const ZIP = { kind: 'zip' as const, zip: '22304', city: 'Alexandria', state: 'VA' };

  it('resolves a city from suggest data without the geocoder', async () => {
    const geocode = geocoder(null);
    const result = await resolvePlace(CITY, geocode, lookup(null), suggestions([ALEXANDRIA]));
    expect(result).toMatchObject({
      status: 'found',
      filters: { city: 'Alexandria', state: 'VA' },
      label: 'Alexandria, VA',
    });
    expect(geocode).not.toHaveBeenCalled();
  });

  it('resolves a ZIP from suggest data without the geocoder', async () => {
    const geocode = geocoder(null);
    const hit = {
      kind: 'zip' as const,
      name: '22304',
      city: 'Alexandria',
      state: 'VA',
      zip: '22304',
    };
    const result = await resolvePlace(ZIP, geocode, lookup(null), suggestions([hit]));
    expect(result).toMatchObject({ status: 'found', filters: { zip: '22304' } });
    expect(geocode).not.toHaveBeenCalled();
  });

  it('ignores a city of another state, then asks the geocoder', async () => {
    const geocode = geocoder(NOMINATIM_CITY);
    const other = { ...ALEXANDRIA, state: 'LA' };
    const result = await resolvePlace(CITY, geocode, lookup(null), suggestions([other]));
    expect(result.status).toBe('found');
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it('asks the geocoder when the suggest call fails', async () => {
    const geocode = geocoder(NOMINATIM_CITY);
    const result = await resolvePlace(CITY, geocode, lookup(null), suggestions(null));
    expect(result.status).toBe('found');
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it('reports an error, never not-found, when both sources fail', async () => {
    expect(await resolvePlace(CITY, geocoder(null), lookup(null), suggestions(null))).toEqual({
      status: 'error',
    });
  });

  it('keeps a found place, so a repeat crawl makes no lookup', async () => {
    const lookupSuggest = suggestions([ALEXANDRIA]);
    await resolvePlace(CITY, geocoder(null), lookup(null), lookupSuggest);
    await resolvePlace(CITY, geocoder(null), lookup(null), lookupSuggest);
    expect(lookupSuggest).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure', async () => {
    const geocode = geocoder(null);
    await resolvePlace(CITY, geocode, lookup(null), suggestions(null));
    await resolvePlace(CITY, geocode, lookup(null), suggestions(null));
    expect(geocode).toHaveBeenCalledTimes(2);
  });
});
