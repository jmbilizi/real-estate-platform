import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, searchRequestSchema } from './search-request';

describe('searchRequestSchema', () => {
  it('defaults to all listing types and a page size of 20', () => {
    const parsed = searchRequestSchema.parse({});
    expect(parsed.listingType).toBe('all');
    expect(parsed.pageSize).toBe(PAGE_SIZE_DEFAULT);
    expect(parsed.page).toBe(1);
  });

  it('coerces numeric query strings to numbers', () => {
    const parsed = searchRequestSchema.parse({ beds: '3', minPrice: '250000' });
    expect(parsed.beds).toBe(3);
    expect(parsed.minPrice).toBe(250000);
  });

  it('rejects an unknown query parameter rather than ignoring it', () => {
    const result = searchRequestSchema.safeParse({ bed: '3' });
    expect(result.success).toBe(false);
  });

  it('defines no field-selection parameter', () => {
    for (const key of ['fields', 'select', 'include', 'omit', 'exclude']) {
      expect(searchRequestSchema.safeParse({ [key]: 'brokerName' }).success).toBe(false);
    }
  });

  it('accepts amenities as a repeated parameter or a comma list', () => {
    expect(searchRequestSchema.parse({ amenities: ['Pool', 'Garage'] }).amenities).toEqual([
      'Pool',
      'Garage',
    ]);
    expect(searchRequestSchema.parse({ amenities: 'Pool,Garage' }).amenities).toEqual([
      'Pool',
      'Garage',
    ]);
  });

  it('rejects an amenity outside the closed set', () => {
    expect(searchRequestSchema.safeParse({ amenities: 'Helipad' }).success).toBe(false);
  });

  it('caps pageSize at the documented server-side maximum', () => {
    expect(searchRequestSchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(searchRequestSchema.parse({ pageSize: String(PAGE_SIZE_MAX) }).pageSize).toBe(
      PAGE_SIZE_MAX,
    );
  });

  it('parses boolean flags from their string form', () => {
    expect(searchRequestSchema.parse({ openHouse: 'true' }).openHouse).toBe(true);
    expect(searchRequestSchema.parse({ waterfront: 'false' }).waterfront).toBe(false);
    expect(searchRequestSchema.safeParse({ openHouse: 'yes' }).success).toBe(false);
  });
});
