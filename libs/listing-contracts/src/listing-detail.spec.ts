import { listingDetailSchema } from './listing-detail';

const detail = {
  property: {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    propertyType: 'Single Family',
    yearBuilt: 1998,
    lotSqft: 8000,
  },
  unit: null,
  listing: {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    title: 'Sample',
    address: '100 King St',
    city: 'Alexandria',
    state: 'VA',
    zip: '22314',
    neighborhood: 'Old Town',
    latitude: 38.8,
    longitude: -77.04,
    price: 750000,
    status: 'Active',
    listingType: 'sale',
    source: 'internal',
    propertyType: 'Single Family',
    beds: 3,
    baths: 2,
    sqft: 1800,
    lotSqft: 8000,
    yearBuilt: 1998,
    description: 'Sample listing description.',
    media: [{ url: 'https://x/1.jpg', altText: null }],
    openHouses: [],
    amenities: ['Garage'],
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
    brokerEmail: 'b@x',
    officeName: 'O',
    officeBrokerLeadPhone: null,
    officeBrokerLeadEmail: null,
    listedBy: 'B – O',
  },
};

describe('listingDetailSchema', () => {
  it('accepts a null unit for a non-subdivided home', () => {
    expect(listingDetailSchema.safeParse(detail).success).toBe(true);
  });

  it('requires the unit key to be present even when null', () => {
    const { unit: _unit, ...withoutUnit } = detail;
    expect(listingDetailSchema.safeParse(withoutUnit).success).toBe(false);
  });

  it('carries description on detail and media as objects', () => {
    const parsed = listingDetailSchema.parse(detail);
    expect(parsed.listing.description).toBe('Sample listing description.');
    expect(parsed.listing.media[0]).toEqual({ url: 'https://x/1.jpg', altText: null });
  });
});
