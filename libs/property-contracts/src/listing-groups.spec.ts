import {
  brokersResponseSchema,
  listingGroupsRequestSchema,
  zipsResponseSchema,
} from './listing-groups';
import { OFFICE_KEY_UNLISTED, searchRequestSchema } from './search-request';

describe('listingGroupsRequestSchema', () => {
  it('defaults minCount to 1 so the group counts add up to the search total', () => {
    expect(listingGroupsRequestSchema.parse({})).toMatchObject({
      listingType: 'all',
      minCount: 1,
      limit: 24,
      offset: 0,
      order: 'count',
    });
  });

  it('takes the search filters and the group paging', () => {
    const parsed = listingGroupsRequestSchema.parse({
      city: 'Bethesda',
      state: 'MD',
      beds: '2',
      order: 'name',
      limit: '1',
    });
    expect(parsed).toMatchObject({ city: 'Bethesda', beds: 2, order: 'name', limit: 1 });
  });

  it('rejects listing paging, sort, an unknown order and an unknown parameter', () => {
    expect(listingGroupsRequestSchema.safeParse({ page: '2' }).success).toBe(false);
    expect(listingGroupsRequestSchema.safeParse({ sort: 'newest' }).success).toBe(false);
    expect(listingGroupsRequestSchema.safeParse({ order: 'rank' }).success).toBe(false);
    expect(listingGroupsRequestSchema.safeParse({ nope: '1' }).success).toBe(false);
  });

  it('bounds minCount, limit and offset', () => {
    expect(listingGroupsRequestSchema.safeParse({ minCount: '0' }).success).toBe(false);
    expect(listingGroupsRequestSchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listingGroupsRequestSchema.safeParse({ offset: '10001' }).success).toBe(false);
  });
});

describe('brokersResponseSchema (#722)', () => {
  it('has the office key, the name and the count, and no ranking field', () => {
    const parsed = brokersResponseSchema.parse({
      groups: [{ key: '1001', name: 'Acme Realty', count: 4 }],
      total: 1,
      listingTotal: 4,
    });
    expect(parsed.groups[0]).toEqual({ key: '1001', name: 'Acme Realty', count: 4 });
    expect(
      brokersResponseSchema.safeParse({
        groups: [{ key: '1', count: 1 }],
        total: 1,
        listingTotal: 1,
      }).success,
    ).toBe(false);
  });
});

describe('the officeKey filter (#722)', () => {
  it('takes digits and `unlisted`, and nothing else', () => {
    expect(searchRequestSchema.safeParse({ officeKey: '1234567' }).success).toBe(true);
    expect(searchRequestSchema.safeParse({ officeKey: OFFICE_KEY_UNLISTED }).success).toBe(true);
    expect(searchRequestSchema.safeParse({ officeKey: '12a' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ officeKey: '' }).success).toBe(false);
    expect(listingGroupsRequestSchema.safeParse({ officeKey: '1001' }).success).toBe(true);
  });
});

describe('zipsResponseSchema', () => {
  it('has groups, a group total and a listing total, and no ranking field', () => {
    const parsed = zipsResponseSchema.parse({
      groups: [{ key: '20814', count: 4 }],
      total: 1,
      listingTotal: 4,
    });
    expect(parsed.groups[0]).toEqual({ key: '20814', count: 4 });
  });
});
