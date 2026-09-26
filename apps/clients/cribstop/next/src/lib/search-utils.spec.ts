import {
  appendLocationParams,
  bareDC,
  bareZip,
  extractSearchTerms,
  fetchBoundaryFor,
  hasLocationFilter,
  resolveSearchTerms,
} from './search-utils';

describe('bareZip', () => {
  it('accepts an exact 5-digit value', () => {
    expect(bareZip('20850')).toBe('20850');
  });

  it('trims surrounding whitespace', () => {
    expect(bareZip('  20850  ')).toBe('20850');
  });

  it('rejects anything that is not exactly 5 digits', () => {
    expect(bareZip('2085')).toBeUndefined();
    expect(bareZip('208501')).toBeUndefined();
    expect(bareZip('Rockville, MD')).toBeUndefined();
    expect(bareZip('20850-1234')).toBeUndefined();
    expect(bareZip('')).toBeUndefined();
  });
});

describe('bareDC (#339)', () => {
  it.each(['Washington, DC', 'Washington DC', 'DC', 'dc', 'washington, d.c.'])(
    'resolves "%s" to state=DC',
    (value) => {
      expect(bareDC(value)).toBe('DC');
    },
  );

  it('does not match an unrelated string', () => {
    expect(bareDC('Rockville')).toBeUndefined();
    expect(bareDC('')).toBeUndefined();
  });
});

/**
 * #339. One case per Nominatim place type the search bar offers — the place-type -> filter table
 * `extractSearchTerms` implements. Every case but the deliberately-unhandled one asserts
 * `hasLocationFilter` too, matching the AC that a suggestion must never resolve to an unfiltered
 * search.
 */
describe('extractSearchTerms — place type to filter table', () => {
  it('postcode -> zip', () => {
    const suggestion = { type: 'postcode', address: { postcode: '20850' } };
    expect(extractSearchTerms(suggestion)).toEqual({ zip: '20850' });
    expect(hasLocationFilter(extractSearchTerms(suggestion))).toBe(true);
  });

  it('road -> street', () => {
    const suggestion = { type: 'road', address: { road: 'Slaters Ln' } };
    expect(extractSearchTerms(suggestion)).toEqual({ street: 'Slaters Ln' });
  });

  it('house -> street, with the house number prefixed', () => {
    const suggestion = { type: 'house', address: { house_number: '501', road: 'Slaters Ln' } };
    expect(extractSearchTerms(suggestion)).toEqual({ street: '501 Slaters Ln' });
  });

  it('residential -> street', () => {
    const suggestion = { type: 'residential', address: { road: 'Elm St' } };
    expect(extractSearchTerms(suggestion)).toEqual({ street: 'Elm St' });
  });

  it.each(['city', 'town', 'village', 'hamlet'])('%s -> city + state', (type) => {
    const suggestion = { type, address: { [type]: 'Rockville', state_code: 'MD' } };
    expect(extractSearchTerms(suggestion)).toEqual({ city: 'Rockville', state: 'MD' });
    expect(hasLocationFilter(extractSearchTerms(suggestion))).toBe(true);
  });

  it('abbreviates a full state name for a town suggestion', () => {
    const suggestion = { type: 'town', address: { town: 'Frederick', state: 'Maryland' } };
    expect(extractSearchTerms(suggestion)).toEqual({ city: 'Frederick', state: 'MD' });
  });

  // Changed by #339: suburb/neighbourhood/quarter used to be routed like city (losing the
  // neighborhood name entirely). They now resolve to their own `neighborhood` filter.
  it.each(['suburb', 'neighbourhood', 'quarter'])('%s -> neighborhood + city + state', (type) => {
    const suggestion = {
      type,
      address: { [type]: 'Capitol Hill', city: 'Washington', state_code: 'DC' },
    };
    expect(extractSearchTerms(suggestion)).toEqual({
      neighborhood: 'Capitol Hill',
      city: 'Washington',
      state: 'DC',
    });
    expect(hasLocationFilter(extractSearchTerms(suggestion))).toBe(true);
  });

  it('neighbourhood with no enclosing city in the address -> neighborhood + state only', () => {
    const suggestion = {
      type: 'neighbourhood',
      address: { neighbourhood: 'Petworth', state_code: 'DC' },
    };
    expect(extractSearchTerms(suggestion)).toEqual({ neighborhood: 'Petworth', state: 'DC' });
  });

  it('county -> county + state', () => {
    const suggestion = { type: 'county', address: { county: 'Fairfax County', state_code: 'VA' } };
    expect(extractSearchTerms(suggestion)).toEqual({ county: 'Fairfax County', state: 'VA' });
    expect(hasLocationFilter(extractSearchTerms(suggestion))).toBe(true);
  });

  it('county falls back to loc.name when address.county is absent', () => {
    const suggestion = { type: 'county', name: 'Arlington County', address: {} };
    expect(extractSearchTerms(suggestion)).toEqual({ county: 'Arlington County' });
  });

  it('state -> state', () => {
    const suggestion = { type: 'state', address: { state_code: 'MD' } };
    expect(extractSearchTerms(suggestion)).toEqual({ state: 'MD' });
    expect(hasLocationFilter(extractSearchTerms(suggestion))).toBe(true);
  });

  it('state by full name (no state_code) -> abbreviated', () => {
    const suggestion = { type: 'state', address: { state: 'Virginia' } };
    expect(extractSearchTerms(suggestion)).toEqual({ state: 'VA' });
  });

  // #339's headline bug: Washington, D.C. tagged as a district/administrative type used to fall
  // through to `{}` and search unfiltered.
  it.each(['district', 'state_district', 'administrative'])(
    '%s with address.city -> city + state (Washington, DC)',
    (type) => {
      const suggestion = { type, address: { city: 'Washington', state: 'District of Columbia' } };
      expect(extractSearchTerms(suggestion)).toEqual({ city: 'Washington', state: 'DC' });
      expect(hasLocationFilter(extractSearchTerms(suggestion))).toBe(true);
    },
  );

  it('district with a county but no city -> county + state', () => {
    const suggestion = {
      type: 'district',
      address: { county: 'St. Mary Parish', state_code: 'LA' },
    };
    expect(extractSearchTerms(suggestion)).toEqual({ county: 'St. Mary Parish', state: 'LA' });
  });

  it('district with only a state -> state', () => {
    const suggestion = { type: 'district', address: { state_code: 'DC' } };
    expect(extractSearchTerms(suggestion)).toEqual({ state: 'DC' });
  });

  it('returns nothing for a suggestion type with no routing rule and no usable address', () => {
    expect(extractSearchTerms({ type: 'country', address: {} })).toEqual({});
    expect(hasLocationFilter(extractSearchTerms({ type: 'country', address: {} }))).toBe(false);
  });

  it('never returns more than one shape', () => {
    // A malformed suggestion could carry both a postcode and a road; postcode still wins alone.
    const suggestion = {
      type: 'postcode',
      address: { postcode: '20850', road: 'Slaters Ln', city: 'Rockville', state_code: 'MD' },
    };
    expect(extractSearchTerms(suggestion)).toEqual({ zip: '20850' });
  });
});

describe('resolveSearchTerms', () => {
  it('sends the bare zip even when a different suggestion is selected', () => {
    const suggestion = { type: 'city', address: { city: 'Rockville', state_code: 'MD' } };
    expect(resolveSearchTerms('20850', suggestion)).toEqual({ zip: '20850' });
  });

  it('falls through to the suggestion when the typed text is not a bare zip', () => {
    const suggestion = { type: 'postcode', address: { postcode: '20850' } };
    expect(resolveSearchTerms('Rockville, MD 20850', suggestion)).toEqual({ zip: '20850' });
  });

  it('a typed DC literal wins over the suggestion, whatever type Nominatim tagged it (#339)', () => {
    const suggestion = { type: 'city', address: {} };
    expect(resolveSearchTerms('Washington, DC', suggestion)).toEqual({ state: 'DC' });
  });
});

describe('fetchBoundaryFor (#339)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the geojson string when Nominatim returns a Polygon', async () => {
    const geo = { type: 'Polygon', coordinates: [[[0, 0]]] };
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ geojson: geo }] }) as any;

    expect(await fetchBoundaryFor({ display_name: 'Petworth, Washington, DC' })).toBe(
      JSON.stringify(geo),
    );
  });

  it('returns undefined when Nominatim returns no geometry', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{}] }) as any;
    expect(await fetchBoundaryFor({ display_name: 'Somewhere' })).toBeUndefined();
  });

  it('returns undefined when the request fails, never throws', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;
    expect(await fetchBoundaryFor({ display_name: 'Somewhere' })).toBeUndefined();
  });

  it('returns undefined with no display_name to re-query with, and never calls fetch', async () => {
    global.fetch = jest.fn();
    expect(await fetchBoundaryFor({})).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('appendLocationParams (#339)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const capitolHill = {
    type: 'neighbourhood',
    display_name: 'Capitol Hill, Washington, DC',
    address: { neighbourhood: 'Capitol Hill', city: 'Washington', state_code: 'DC' },
  };

  it('sends boundary + state in place of neighborhood and city when the boundary resolves', async () => {
    const geo = { type: 'Polygon', coordinates: [[[0, 0]]] };
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ geojson: geo }] }) as any;

    const params = new URLSearchParams();
    const applied = await appendLocationParams(params, 'Capitol Hill', capitolHill);

    expect(applied).toBe(true);
    expect(params.get('boundary')).toBe(JSON.stringify(geo));
    expect(params.get('state')).toBe('DC');
    expect(params.has('neighborhood')).toBe(false);
    expect(params.has('city')).toBe(false);
  });

  it('falls back to neighborhood + city + state when no boundary resolves', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;

    const params = new URLSearchParams();
    const applied = await appendLocationParams(params, 'Capitol Hill', capitolHill);

    expect(applied).toBe(true);
    expect(params.get('neighborhood')).toBe('Capitol Hill');
    expect(params.get('city')).toBe('Washington');
    expect(params.get('state')).toBe('DC');
    expect(params.has('boundary')).toBe(false);
  });

  // county_fips is the DB column `county` actually matches (a code, e.g. "51059"), and
  // extractSearchTerms resolves `county` to a NOMINATIM NAME ("Fairfax County") — the two can
  // never be equal, so the web must never send `county` as a text filter at all (#339 review).
  it('sends boundary + state for a county selection when the fetch succeeds', async () => {
    const geo = { type: 'Polygon', coordinates: [[[0, 0]]] };
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ geojson: geo }] }) as any;

    const params = new URLSearchParams();
    const applied = await appendLocationParams(params, 'Fairfax County', {
      type: 'county',
      display_name: 'Fairfax County, Virginia',
      address: { county: 'Fairfax County', state_code: 'VA' },
    });

    expect(applied).toBe(true);
    expect(params.get('boundary')).toBe(JSON.stringify(geo));
    expect(params.has('county')).toBe(false);
    expect(params.get('state')).toBe('VA');
  });

  it('degrades to state alone for a county selection when no boundary is available', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;

    const params = new URLSearchParams();
    const applied = await appendLocationParams(params, 'Fairfax County', {
      type: 'county',
      display_name: 'Fairfax County, Virginia',
      address: { county: 'Fairfax County', state_code: 'VA' },
    });

    // Coarser than a county, but a real, populated filter — never an inert `county` name and
    // never unfiltered.
    expect(applied).toBe(true);
    expect(params.get('state')).toBe('VA');
    expect(params.has('county')).toBe(false);
    expect(params.has('boundary')).toBe(false);
  });

  it('reports failure (never a silent unfiltered search) when a county has no state and no boundary', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as any;

    const params = new URLSearchParams();
    const applied = await appendLocationParams(params, 'Somewhere County', {
      type: 'county',
      display_name: 'Somewhere County',
      address: { county: 'Somewhere County' },
    });

    expect(applied).toBe(false);
    expect(Array.from(params.keys())).toHaveLength(0);
  });

  it('never fetches a boundary for a plain city/zip/street filter', async () => {
    global.fetch = jest.fn();
    const params = new URLSearchParams();
    const applied = await appendLocationParams(params, 'Rockville', {
      type: 'city',
      address: { city: 'Rockville', state_code: 'MD' },
    });

    expect(applied).toBe(true);
    expect(params.get('city')).toBe('Rockville');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
