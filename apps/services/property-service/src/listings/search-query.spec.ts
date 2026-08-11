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
