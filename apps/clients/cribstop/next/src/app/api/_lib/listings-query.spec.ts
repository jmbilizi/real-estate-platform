import {
  buildListingsQuery,
  FORWARDABLE_GROUPS_PARAMS,
  FORWARDABLE_LISTING_PARAMS,
  FORWARDABLE_MAP_PARAMS,
  FORWARDABLE_NEIGHBORHOODS_PARAMS,
  SEARCH_ONLY_PARAMS,
  UnknownListingParamsError,
} from './listings-query';

/**
 * The occupancy identifiers the removed "Who" panel used to collect (#34). They are asserted by
 * name here rather than only by absence, so that if anyone ever reintroduces such a control the
 * failure is a named, explained test rather than a silent leak into a query string.
 */
const OCCUPANCY_KEYS = ['seniors', 'adults', 'teens', 'children', 'infants', 'pets', 'occupants'];

describe('listings gateway query allowlist', () => {
  it('forwards the parameters the wire contract defines', () => {
    const query = buildListingsQuery(
      new URLSearchParams({
        query: 'Bethesda',
        listingType: 'sale',
        propertyType: 'Land',
        minPrice: '100000',
        beds: '3',
        sort: 'price-asc',
        page: '2',
        pageSize: '20',
      }),
    );
    const forwarded = new URLSearchParams(query);

    expect(forwarded.get('query')).toBe('Bethesda');
    expect(forwarded.get('listingType')).toBe('sale');
    expect(forwarded.get('propertyType')).toBe('Land');
    expect(forwarded.get('minPrice')).toBe('100000');
    expect(forwarded.get('beds')).toBe('3');
    expect(forwarded.get('sort')).toBe('price-asc');
    expect(forwarded.get('page')).toBe('2');
    expect(forwarded.get('pageSize')).toBe('20');
  });

  // #81: the allowlist is derived from `searchRequestSchema.shape`, so adding `city`/`state` to
  // the contract forwards them with no edit to this proxy.
  it('forwards city and state, added to the contract in #81, with no proxy code change', () => {
    const forwarded = new URLSearchParams(
      buildListingsQuery(new URLSearchParams({ city: 'Rockville', state: 'MD' })),
    );

    expect(forwarded.get('city')).toBe('Rockville');
    expect(forwarded.get('state')).toBe('MD');
  });

  it('preserves repeated amenities rather than collapsing them', () => {
    const incoming = new URLSearchParams();
    incoming.append('amenities', 'Pool');
    incoming.append('amenities', 'Garage');

    expect(new URLSearchParams(buildListingsQuery(incoming)).getAll('amenities')).toEqual([
      'Pool',
      'Garage',
    ]);
  });

  // #221
  it('rejects a parameter the contract does not define, naming it', () => {
    const incoming = new URLSearchParams({ query: 'Bethesda', bed: '3', utm_source: 'email' });

    expect(() => buildListingsQuery(incoming)).toThrow(UnknownListingParamsError);
    try {
      buildListingsQuery(incoming);
    } catch (error) {
      expect((error as UnknownListingParamsError).params).toEqual(['bed', 'utm_source']);
    }
  });

  it('rejects an unknown parameter even when its value is empty', () => {
    expect(() => buildListingsQuery(new URLSearchParams({ bed: '' }))).toThrow(
      UnknownListingParamsError,
    );
  });

  it('drops empty values of known parameters instead of forwarding them', () => {
    expect(buildListingsQuery(new URLSearchParams({ query: '', neighborhood: '' }))).toBe('');
  });

  /**
   * #220. `query`, `zip`, `street` and `city` each pin a place. ANDing `query`'s degraded label
   * on top of a structured filter either narrows the result below what the user picked, or (a
   * label like `"Rockville, MD"` matching no single field) returns nothing at all.
   */
  describe('a place search never ANDs two location filters', () => {
    it('drops `query` when `zip` is present', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(new URLSearchParams({ query: 'Rockville, MD 20850', zip: '20850' })),
      );

      expect(forwarded.get('zip')).toBe('20850');
      expect(forwarded.has('query')).toBe(false);
    });

    it('drops `query` when `city` is present', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(
          new URLSearchParams({ query: 'Rockville, MD', city: 'Rockville', state: 'MD' }),
        ),
      );

      expect(forwarded.get('city')).toBe('Rockville');
      expect(forwarded.get('state')).toBe('MD');
      expect(forwarded.has('query')).toBe(false);
    });

    it('drops `query` when `street` is present', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(
          new URLSearchParams({ query: '501 Slaters Ln, VA', street: '501 Slaters Ln' }),
        ),
      );

      expect(forwarded.get('street')).toBe('501 Slaters Ln');
      expect(forwarded.has('query')).toBe(false);
    });

    it('drops `state` when `zip` is present, even if both are supplied', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(new URLSearchParams({ zip: '20850', state: 'MD' })),
      );

      expect(forwarded.get('zip')).toBe('20850');
      expect(forwarded.has('state')).toBe(false);
    });

    it('keeps `state` when there is no `zip`', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(new URLSearchParams({ city: 'Rockville', state: 'MD' })),
      );

      expect(forwarded.get('state')).toBe('MD');
    });

    it('leaves free text alone when no structured place filter is present', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(new URLSearchParams({ query: 'condo with a pool' })),
      );

      expect(forwarded.get('query')).toBe('condo with a pool');
    });

    // #339. neighborhood and county pin a place exactly as precisely as city does, so they now
    // join the same drop-query rule city/zip/street already had.
    it('drops `query` when `neighborhood` is present', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(new URLSearchParams({ query: 'Bethesda', neighborhood: 'Old Town' })),
      );

      expect(forwarded.get('neighborhood')).toBe('Old Town');
      expect(forwarded.has('query')).toBe(false);
    });

    it('drops `query` when `county` is present', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(new URLSearchParams({ query: 'Fairfax County', county: '51059' })),
      );

      expect(forwarded.get('county')).toBe('51059');
      expect(forwarded.has('query')).toBe(false);
    });

    it('keeps `state` alongside `neighborhood` — a neighborhood name alone can collide', () => {
      const forwarded = new URLSearchParams(
        buildListingsQuery(
          new URLSearchParams({ neighborhood: 'Capitol Hill', city: 'Washington', state: 'DC' }),
        ),
      );

      expect(forwarded.get('neighborhood')).toBe('Capitol Hill');
      expect(forwarded.get('city')).toBe('Washington');
      expect(forwarded.get('state')).toBe('DC');
    });

    it('forwards a boundary polygon alongside neighborhood/county', () => {
      const boundary = JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0]]] });
      const forwarded = new URLSearchParams(
        buildListingsQuery(new URLSearchParams({ county: '11001', boundary })),
      );

      expect(forwarded.get('boundary')).toBe(boundary);
    });
  });

  describe('occupancy values can never reach the API', () => {
    it('defines no occupancy parameter in the forwardable set', () => {
      for (const key of OCCUPANCY_KEYS) {
        expect(FORWARDABLE_LISTING_PARAMS).not.toContain(key);
      }
    });

    it('rejects occupancy values when a caller explicitly supplies them', () => {
      for (const key of OCCUPANCY_KEYS) {
        const incoming = new URLSearchParams({ query: 'Bethesda' });
        incoming.append(key, '2');

        expect(() => buildListingsQuery(incoming)).toThrow(UnknownListingParamsError);
      }
    });
  });
});

describe('map query allowlist (#377)', () => {
  it('forwards the filters and viewport, never paging, sort or occupancy', () => {
    const incoming = new URLSearchParams({
      city: 'Washington',
      state: 'DC',
      bounds: '-77.12,38.79,-76.91,38.996',
      page: '2',
      pageSize: '20',
      sort: 'newest',
    });
    const forwarded = new URLSearchParams(
      buildListingsQuery(incoming, FORWARDABLE_MAP_PARAMS, SEARCH_ONLY_PARAMS),
    );
    expect([...forwarded.keys()].sort()).toEqual(['bounds', 'city', 'state']);
  });

  it('rejects a parameter outside the map contract', () => {
    const incoming = new URLSearchParams({ city: 'Washington', zoom: '12' });
    expect(() => buildListingsQuery(incoming, FORWARDABLE_MAP_PARAMS, SEARCH_ONLY_PARAMS)).toThrow(
      UnknownListingParamsError,
    );
  });
});

describe('neighborhoods query allowlist (#393)', () => {
  it('forwards exactly the fields the wire contract defines', () => {
    const incoming = new URLSearchParams({
      state: 'DC',
      city: 'Washington',
      listingType: 'sale',
      minCount: '5',
      limit: '24',
      slug: 'columbia-heights',
      page: '2',
      sort: 'newest',
    });
    const forwarded = new URLSearchParams(
      buildListingsQuery(incoming, FORWARDABLE_NEIGHBORHOODS_PARAMS, SEARCH_ONLY_PARAMS),
    );
    expect([...forwarded.keys()].sort()).toEqual([
      'city',
      'limit',
      'listingType',
      'minCount',
      'slug',
      'state',
    ]);
  });

  it('forwards the search filters, offset and order, never paging or sort (#501)', () => {
    const incoming = new URLSearchParams({
      neighborhood: 'Fishtown',
      city: 'Philadelphia',
      state: 'PA',
      minPrice: '300000',
      beds: '2',
      minCount: '1',
      offset: '24',
      order: 'name',
      page: '2',
      pageSize: '10',
      sort: 'newest',
    });
    const forwarded = new URLSearchParams(
      buildListingsQuery(incoming, FORWARDABLE_NEIGHBORHOODS_PARAMS, SEARCH_ONLY_PARAMS),
    );
    expect([...forwarded.keys()].sort()).toEqual([
      'beds',
      'city',
      'minCount',
      'minPrice',
      'neighborhood',
      'offset',
      'order',
      'state',
    ]);
  });
});

describe('group query allowlist (#722)', () => {
  it('forwards the search filters and group paging, never listing paging or sort', () => {
    const incoming = new URLSearchParams({
      city: 'Bethesda',
      state: 'MD',
      beds: '2',
      minCount: '1',
      limit: '1',
      offset: '24',
      order: 'name',
      page: '2',
      sort: 'newest',
    });
    const forwarded = new URLSearchParams(
      buildListingsQuery(incoming, FORWARDABLE_GROUPS_PARAMS, SEARCH_ONLY_PARAMS),
    );
    expect([...forwarded.keys()].sort()).toEqual([
      'beds',
      'city',
      'limit',
      'minCount',
      'offset',
      'order',
      'state',
    ]);
  });
});
