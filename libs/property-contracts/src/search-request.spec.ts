import {
  exceedsResultWindow,
  MAX_RESULT_OFFSET,
  maxReachablePage,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  resultOffsetFor,
  searchRequestSchema,
} from './search-request';

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

  it('accepts a half-bath step for baths but rejects other fractions', () => {
    expect(searchRequestSchema.parse({ baths: '2.5' }).baths).toBe(2.5);
    expect(searchRequestSchema.parse({ baths: '2' }).baths).toBe(2);
    expect(searchRequestSchema.safeParse({ baths: '2.7' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ baths: 'abc' }).success).toBe(false);
  });

  it('rejects a page of 0 or a negative page', () => {
    expect(searchRequestSchema.safeParse({ page: '0' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ page: '-1' }).success).toBe(false);
  });

  it('rejects a pageSize of 0', () => {
    expect(searchRequestSchema.safeParse({ pageSize: '0' }).success).toBe(false);
  });

  // The window is enforced at the route boundary, not in this schema, because it carries its own
  // error code (`result_window_exceeded`) rather than `invalid_request` — see routes.ts. A deep
  // page must therefore still PARSE; what rejects it is the check the route runs next.
  it('parses a page past the result window rather than rejecting it here', () => {
    const parsed = searchRequestSchema.parse({ page: '9999', pageSize: '20' });
    expect(parsed.page).toBe(9999);
    expect(exceedsResultWindow(parsed)).toBe(true);
  });
});

describe('the result window (#65)', () => {
  it('bounds the offset at 1,000 — the documented number', () => {
    expect(MAX_RESULT_OFFSET).toBe(1000);
  });

  it('computes the offset as (page - 1) * pageSize', () => {
    expect(resultOffsetFor(1, 20)).toBe(0);
    expect(resultOffsetFor(51, 20)).toBe(1000);
    expect(resultOffsetFor(3, 100)).toBe(200);
  });

  it('admits the deepest in-window offset and refuses the one past it, at every page size', () => {
    for (const pageSize of [1, 7, 20, 100]) {
      const lastPage = maxReachablePage(pageSize);
      expect(resultOffsetFor(lastPage, pageSize)).toBeLessThanOrEqual(MAX_RESULT_OFFSET);
      expect(exceedsResultWindow({ page: lastPage, pageSize })).toBe(false);
      expect(exceedsResultWindow({ page: lastPage + 1, pageSize })).toBe(true);
    }
  });

  it('reaches page 51 at the default page size', () => {
    expect(maxReachablePage(PAGE_SIZE_DEFAULT)).toBe(51);
  });

  // The bound is on the OFFSET, so a larger page size buys fewer pages — it does not let a caller
  // start further into the set. What it does change, and this is the honest statement of it, is the
  // last row reachable: `MAX_RESULT_OFFSET + pageSize`, so `pageSize=100` reaches row 1,100 where
  // `pageSize=20` reaches row 1,020. That one-page-of-slack difference is immaterial to the bound's
  // purpose and is the direct consequence of expressing the limit as an offset; what matters is
  // that it stays bounded by a constant rather than scaling with the dataset.
  it('does not let a bigger page size start at a deeper offset', () => {
    for (const pageSize of [1, 20, 100]) {
      expect(resultOffsetFor(maxReachablePage(pageSize), pageSize)).toBeLessThanOrEqual(
        MAX_RESULT_OFFSET,
      );
    }
    expect(maxReachablePage(PAGE_SIZE_MAX)).toBeLessThan(maxReachablePage(PAGE_SIZE_DEFAULT));
  });

  it('caps the deepest reachable ROW at the offset plus one page, at every page size', () => {
    for (const pageSize of [1, 20, 100]) {
      const deepestRow = resultOffsetFor(maxReachablePage(pageSize), pageSize) + pageSize;
      expect(deepestRow).toBe(MAX_RESULT_OFFSET + pageSize);
      expect(deepestRow).toBeLessThanOrEqual(MAX_RESULT_OFFSET + PAGE_SIZE_MAX);
    }
  });

  it('never admits the first page, whatever the page size — the bound is on depth, not on access', () => {
    for (const pageSize of [1, 20, 100]) {
      expect(exceedsResultWindow({ page: 1, pageSize })).toBe(false);
    }
  });
});
