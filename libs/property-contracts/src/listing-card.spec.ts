import { listingCardSchema, listingsEnvelopeSchema } from './listing-card';

const row = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  propertyId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
  propertyPath: '/property/alexandria-va/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
  title: 'Sample listing',
  address: null,
  city: 'Alexandria',
  state: 'VA',
  zip: '22314',
  neighborhood: null,
  latitude: null,
  longitude: null,
  price: null,
  daysOnMarket: null,
  status: 'Active',
  listingType: 'sale',
  source: 'internal',
  propertyType: 'Land',
  beds: null,
  baths: null,
  sqft: null,
  lotSqft: 104544,
  yearBuilt: null,
  primaryMedia: null,
  openHouse: null,
  amenities: [],
  featured: false,
  sponsored: false,
  priceReduced: false,
  previousPrice: null,
  priceChangedAt: null,
  newConstruction: false,
  isSample: true,
  closePrice: null,
  closeDate: null,
  lastUpdated: '2026-08-01T12:00:00.000Z',
  listedAt: null,
  comingSoonDate: null,
  listedAtPrecise: null,
  listingAgentName: null,
  brokerName: 'B',
  brokerPhone: '1',
  brokerEmail: 'agent@brokerco.com',
  officeName: 'O',
  officeBrokerLeadPhone: null,
  officeBrokerLeadEmail: null,
  listedBy: 'B – O',
};

describe('listingCardSchema', () => {
  it('accepts a land parcel with null beds, baths, sqft and price', () => {
    expect(listingCardSchema.safeParse(row).success).toBe(true);
  });

  it('rejects a row missing a nullable key rather than treating it as absent', () => {
    const { beds: _beds, ...withoutBeds } = row;
    expect(listingCardSchema.safeParse(withoutBeds).success).toBe(false);
  });

  it('rejects a row missing any attribution field', () => {
    for (const key of ['brokerName', 'brokerPhone', 'brokerEmail', 'officeName', 'listedBy']) {
      const { [key]: _removed, ...partial } = row as Record<string, unknown>;
      expect(listingCardSchema.safeParse(partial).success).toBe(false);
    }
  });

  it('rejects a row missing a nullable attribution key rather than treating it as absent', () => {
    const { listingAgentName: _removed, ...partial } = row;
    expect(listingCardSchema.safeParse(partial).success).toBe(false);
  });

  it('carries no description, no imageUrls and no hasOpenHouse', () => {
    // Inspects the schema's declared shape, not a parsed fixture: parsing `row` only proves these
    // keys are absent from this one object, and would still pass even if the schema declared them
    // `.optional()` — the shape is the only thing that can prove the schema itself never carries
    // them (#47 review, I6).
    const keys = Object.keys(listingCardSchema.shape);
    expect(keys).not.toContain('description');
    expect(keys).not.toContain('imageUrls');
    expect(keys).not.toContain('hasOpenHouse');
  });

  it('enforces the lean-list / rich-detail split: no detail-only fields', () => {
    // The card row is the LEAN projection: single primary image, flat fields only. The full
    // graph (photo gallery, description, open houses, nested property/unit detail) is fetched
    // only when a user opens a listing. This test ensures that detail-only fields never creep
    // onto the list row. See PRD §3.1 "List vs. Detail Payloads" and the docblock above.
    const keys = Object.keys(listingCardSchema.shape);

    // Detail-only fields that must stay OFF the card:
    expect(keys).not.toContain('media'); // Card has only single primaryMedia
    expect(keys).not.toContain('openHouses'); // Card has only single openHouse
    expect(keys).not.toContain('description'); // Most Fair Housing risk; detail-only
    expect(keys).not.toContain('property'); // Nested object; detail-only
    expect(keys).not.toContain('unit'); // Nested object; detail-only
  });

  it('requires the price change keys, and accepts two stored prices (#717)', () => {
    const { previousPrice: _p, ...withoutPrevious } = row;
    expect(listingCardSchema.safeParse(withoutPrevious).success).toBe(false);
    const { priceChangedAt: _c, ...withoutDate } = row;
    expect(listingCardSchema.safeParse(withoutDate).success).toBe(false);
    expect(
      listingCardSchema.safeParse({
        ...row,
        previousPrice: 2297500,
        priceChangedAt: '2026-10-02T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('carries an exact total and page info on the envelope', () => {
    const envelope = listingsEnvelopeSchema.parse({
      results: [row],
      total: 137,
      page: 1,
      pageSize: 20,
      pageCount: 7,
      appliedFilters: {},
    });
    expect(envelope.total).toBe(137);
    expect(typeof envelope.total).toBe('number');
  });
});
