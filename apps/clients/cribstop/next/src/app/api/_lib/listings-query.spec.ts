import { buildListingsQuery, FORWARDABLE_LISTING_PARAMS } from './listings-query';

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

  it('preserves repeated amenities rather than collapsing them', () => {
    const incoming = new URLSearchParams();
    incoming.append('amenities', 'Pool');
    incoming.append('amenities', 'Garage');

    expect(new URLSearchParams(buildListingsQuery(incoming)).getAll('amenities')).toEqual([
      'Pool',
      'Garage',
    ]);
  });

  it('drops any parameter the contract does not define', () => {
    const query = buildListingsQuery(
      new URLSearchParams({ query: 'Bethesda', fields: 'id', bed: '3', utm_source: 'email' }),
    );
    const forwarded = new URLSearchParams(query);

    expect(forwarded.get('query')).toBe('Bethesda');
    expect(forwarded.has('fields')).toBe(false);
    expect(forwarded.has('bed')).toBe(false);
    expect(forwarded.has('utm_source')).toBe(false);
  });

  it('drops empty values instead of forwarding a parameter the API would reject', () => {
    expect(buildListingsQuery(new URLSearchParams({ query: '', neighborhood: '' }))).toBe('');
  });

  describe('occupancy values can never reach the API', () => {
    it('defines no occupancy parameter in the forwardable set', () => {
      for (const key of OCCUPANCY_KEYS) {
        expect(FORWARDABLE_LISTING_PARAMS).not.toContain(key);
      }
    });

    it('drops occupancy values even when a caller explicitly supplies them', () => {
      const incoming = new URLSearchParams({ query: 'Bethesda' });
      for (const key of OCCUPANCY_KEYS) incoming.append(key, '2');

      const forwarded = new URLSearchParams(buildListingsQuery(incoming));

      expect(forwarded.get('query')).toBe('Bethesda');
      for (const key of OCCUPANCY_KEYS) {
        expect(forwarded.has(key)).toBe(false);
      }
      expect(buildListingsQuery(incoming)).not.toMatch(
        /senior|adult|teen|child|infant|pet|occupan/i,
      );
    });
  });
});
