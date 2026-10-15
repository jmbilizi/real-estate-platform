import { homeFeedRequestSchema } from './home-feed';

const ID = '018f2f2a-6d1b-7c3d-8b2e-000000000001';
const base = { target: { city: 'Alexandria', state: 'VA' } };

describe('homeFeedRequestSchema', () => {
  it('applies defaults', () => {
    const parsed = homeFeedRequestSchema.parse(base);
    expect(parsed).toMatchObject({ profile: null, radiusKm: 20, side: 'sale', variant: 'v1' });
  });

  it('accepts a whole-state radius of null', () => {
    expect(homeFeedRequestSchema.parse({ ...base, radiusKm: null }).radiusKm).toBeNull();
  });

  it('rejects an unknown key at every level', () => {
    expect(homeFeedRequestSchema.safeParse({ ...base, schoolRating: 9 }).success).toBe(false);
    expect(homeFeedRequestSchema.safeParse({ target: { ...base.target, crime: 1 } }).success).toBe(
      false,
    );
    expect(
      homeFeedRequestSchema.safeParse({
        ...base,
        profile: { items: [], places: [], ethnicity: 'x' },
      }).success,
    ).toBe(false);
    expect(
      homeFeedRequestSchema.safeParse({
        ...base,
        profile: {
          items: [{ listingId: ID, kind: 'view', side: 'sale', at: 1, income: 5 }],
          places: [],
        },
      }).success,
    ).toBe(false);
  });

  it('caps the profile at 50 items', () => {
    const item = { listingId: ID, kind: 'view', side: 'sale', at: 1 };
    const items = Array.from({ length: 51 }, () => item);
    expect(
      homeFeedRequestSchema.safeParse({ ...base, profile: { items, places: [] } }).success,
    ).toBe(false);
  });

  it('refuses a place label with markup', () => {
    expect(
      homeFeedRequestSchema.safeParse({ target: { city: '<b>x</b>', state: 'VA' } }).success,
    ).toBe(false);
  });
});
