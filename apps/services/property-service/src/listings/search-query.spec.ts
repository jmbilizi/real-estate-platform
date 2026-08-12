import { searchRequestSchema } from '@cribstop/property-contracts';
import { buildSearchQuery, SORT_ORDERS } from './search-query';

const build = (query: Record<string, unknown> = {}): ReturnType<typeof buildSearchQuery> =>
  buildSearchQuery(searchRequestSchema.parse(query));

describe('buildSearchQuery', () => {
  it('defaults to the shopping surface: sale + rent, no sold', () => {
    const { where, params } = build();
    expect(where).toContain('v.listing_type = ANY(');
    expect(params).toContainEqual(['sale', 'rent']);
  });

  it('gives every sort an id tiebreaker so paging is a total order', () => {
    for (const order of Object.values(SORT_ORDERS)) {
      expect(order).toMatch(/v\.id (ASC|DESC)$/);
    }
  });

  it('specifies recommended exactly, with no per-user signal', () => {
    expect(SORT_ORDERS.recommended).toBe('v.featured DESC, v.last_updated DESC, v.id DESC');
  });

  it('never substitutes zero for a land parcel’s null beds/baths/sqft', () => {
    const { where } = build({ beds: '2', baths: '1.5', minSqft: '900' });
    expect(where).not.toMatch(/coalesce/i);
    expect(where).toContain('v.beds >= ');
  });

  it('filters street and free-text against the masked address, never street_line', () => {
    const { where } = build({ street: 'King', query: 'King' });
    expect(where).toContain('lower(v.address)');
    expect(where).not.toContain('street_line');
  });

  it('never searches the description', () => {
    expect(build({ query: 'quiet block' }).where).not.toContain('description');
  });

  it('ANDs query with zip instead of dropping one of them', () => {
    // filters.ts suppresses `query` when zip/street is set; the AC requires the API to apply
    // exactly what it was asked.
    const { where } = build({ zip: '22314', query: 'King' });
    expect(where).toContain('starts_with(v.zip');
    expect(where).toContain('lower(v.title)');
  });

  // Regression: the free-text group was originally spliced in unparenthesised. Because `AND` binds
  // tighter than `OR`, the emitted predicate reassociated to
  // `(listing_type AND zip AND title_match) OR address_match OR city_match OR ...`, so every OR
  // branch after the first bypassed EVERY other filter — including the sold gate, which means a
  // free-text search returned sold listings under `listingType=all`. The two assertions below are
  // deliberately structural rather than string-contains: the previous test above passed against the
  // broken output, because both substrings were present either way.
  it('parenthesises the free-text disjunction so it cannot escape the AND chain', () => {
    const { where } = build({ zip: '22314', query: 'King' });

    expect(where).toMatch(/AND \(strpos\(lower\(v\.title\)/);
    expect(where).toMatch(/strpos\(v\.zip, \$\d+\) > 0\)/);
  });

  it('never leaves a bare OR at the top level of the predicate', () => {
    // The invariant, stated once for every current and future condition: splitting on the top-level
    // AND separator must yield conditions that are each either OR-free or fully bracketed. Any new
    // disjunctive filter added to buildSearchQuery is caught here without a bespoke test.
    const { where } = build({
      zip: '22314',
      query: 'King',
      street: 'King',
      amenities: 'Pool,Garage',
      beds: '2',
      openHouse: 'true',
    });

    for (const condition of where.split('\n  AND ')) {
      const trimmed = condition.trim();
      if (/\bOR\b/.test(trimmed)) {
        expect(trimmed.startsWith('(')).toBe(true);
        expect(trimmed.endsWith(')')).toBe(true);
      }
    }
  });

  it('requires every requested amenity, not any', () => {
    const { where, params } = build({ amenities: 'Pool,Garage' });
    expect(where).toContain('v.amenities @> ');
    expect(params).toContainEqual(['Pool', 'Garage']);
  });

  it('binds exactly one parameter per placeholder', () => {
    const { where, params } = build({ zip: '22314', beds: '3', amenities: 'Pool' });
    const placeholders = new Set(where.match(/\$\d+/g) ?? []);
    expect(placeholders.size).toBe(params.length);
  });
});
