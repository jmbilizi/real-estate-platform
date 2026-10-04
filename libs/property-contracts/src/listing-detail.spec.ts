import { listingCardSchema } from './listing-card';
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
    propertyId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    propertyPath: '/property/100-king-st-alexandria-va/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    title: 'Sample',
    address: '100 King St',
    city: 'Alexandria',
    state: 'VA',
    zip: '22314',
    neighborhood: 'Old Town',
    latitude: 38.8,
    longitude: -77.04,
    price: 750000,
    daysOnMarket: null,
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
    media: [{ url: 'https://x/1.jpg', altText: null, caption: null }],
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
    taxAnnualAmount: null,
    taxYear: null,
    hoaFee: null,
    hoaFeeFrequency: null,
    virtualTourUrl: null,
    listAgentPhone: null,
    listAgentEmail: null,
    facts: {
      parking: null,
      heating: null,
      cooling: null,
      appliances: null,
      basement: null,
      flooring: null,
      interior: null,
      exterior: null,
    },
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

  it.each([
    'taxAnnualAmount',
    'taxYear',
    'hoaFee',
    'hoaFeeFrequency',
    'virtualTourUrl',
    'listAgentPhone',
    'listAgentEmail',
    'facts',
  ])('requires the %s key to be present (#564)', (key) => {
    const { [key]: _omitted, ...rest } = detail.listing as Record<string, unknown>;
    expect(listingDetailSchema.safeParse({ ...detail, listing: rest }).success).toBe(false);
  });

  it('accepts present detail facts and rejects a negative amount or a non-URL tour (#564)', () => {
    const present = {
      ...detail,
      listing: {
        ...detail.listing,
        taxAnnualAmount: 5120.5,
        taxYear: 2025,
        hoaFee: 310,
        hoaFeeFrequency: 'Monthly',
        virtualTourUrl: 'https://tours.example/abc',
        listAgentPhone: '2025550100',
        listAgentEmail: 'agent@example.com',
        facts: { ...detail.listing.facts, heating: ['Forced Air'] },
      },
    };
    expect(listingDetailSchema.safeParse(present).success).toBe(true);
    expect(
      listingDetailSchema.safeParse({
        ...present,
        listing: { ...present.listing, taxAnnualAmount: -1 },
      }).success,
    ).toBe(false);
    expect(
      listingDetailSchema.safeParse({
        ...present,
        listing: { ...present.listing, virtualTourUrl: 'not a url' },
      }).success,
    ).toBe(false);
  });

  it('accepts an http or https tour and rejects other schemes and a malformed email (#564)', () => {
    const withListing = (extra: Record<string, unknown>) =>
      listingDetailSchema.safeParse({ ...detail, listing: { ...detail.listing, ...extra } })
        .success;
    expect(withListing({ virtualTourUrl: 'http://tours.example/abc' })).toBe(true);
    expect(withListing({ virtualTourUrl: 'javascript:alert(1)' })).toBe(false);
    expect(withListing({ listAgentEmail: 'a b@@example' })).toBe(false);
  });

  it('keeps the detail facts off the card schema (#564)', () => {
    expect(Object.keys(listingCardSchema.shape)).not.toEqual(
      expect.arrayContaining(['taxAnnualAmount', 'hoaFee', 'virtualTourUrl', 'facts']),
    );
  });

  it('carries description on detail and media as objects', () => {
    const parsed = listingDetailSchema.parse(detail);
    expect(parsed.listing.description).toBe('Sample listing description.');
    expect(parsed.listing.media[0]).toEqual({
      url: 'https://x/1.jpg',
      altText: null,
      caption: null,
    });
  });
});
