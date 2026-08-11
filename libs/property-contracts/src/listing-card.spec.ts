import { listingCardSchema, listingsEnvelopeSchema } from './listing-card';

const row = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  title: 'Sample listing',
  address: null,
  city: 'Alexandria',
  state: 'VA',
  zip: '22314',
  neighborhood: null,
  latitude: null,
  longitude: null,
  price: null,
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
  newConstruction: false,
  isSample: true,
  closePrice: null,
  closeDate: null,
  lastUpdated: '2026-08-01T12:00:00.000Z',
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
