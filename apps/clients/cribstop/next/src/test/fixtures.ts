import type { ListingCardRow, ListingDetail } from '@cribstop/property-contracts';

/**
 * Test fixtures shaped by the wire contract, not by the old mock array.
 *
 * Every builder starts from a complete, valid row and takes an override patch, so a test that
 * cares about one nullable field says only that — and a contract change that adds a required
 * field breaks here once instead of in every spec.
 */
export function aListingCardRow(overrides: Partial<ListingCardRow> = {}): ListingCardRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Test Row (Sample)',
    address: '100 Test St',
    city: 'Bethesda',
    state: 'MD',
    zip: '20814',
    neighborhood: 'Downtown',
    latitude: 38.9847,
    longitude: -77.0947,
    price: 750000,
    status: 'Active',
    listingType: 'sale',
    source: 'internal',
    propertyType: 'Single Family',
    beds: 3,
    baths: 2,
    sqft: 1800,
    lotSqft: 6000,
    yearBuilt: 1994,
    primaryMedia: { url: 'https://example.com/a.jpg', altText: 'Front elevation' },
    openHouse: null,
    amenities: [],
    featured: false,
    sponsored: false,
    priceReduced: false,
    newConstruction: false,
    isSample: true,
    closePrice: null,
    closeDate: null,
    lastUpdated: '2026-04-20T18:00:00.000Z',
    listingAgentName: 'Sample Agent 1',
    brokerName: 'Sample Agent 1',
    brokerPhone: '(301) 555-0101',
    brokerEmail: 'sample.agent1@example.com',
    officeName: 'Real Broker, LLC',
    officeBrokerLeadPhone: '(301) 555-0102',
    officeBrokerLeadEmail: 'broker@example.com',
    listedBy: 'Sample Agent 1 – Real Broker, LLC',
    ...overrides,
  };
}

/** A parcel: no dwelling stats at all, lot size only. */
export function aLandParcelRow(overrides: Partial<ListingCardRow> = {}): ListingCardRow {
  return aListingCardRow({
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Test Parcel (Sample)',
    propertyType: 'Land',
    beds: null,
    baths: null,
    sqft: null,
    lotSqft: 104544,
    yearBuilt: null,
    ...overrides,
  });
}

/** A row whose seller opted out of address display: address and both coordinates are null together. */
export function aSuppressedAddressRow(overrides: Partial<ListingCardRow> = {}): ListingCardRow {
  return aListingCardRow({
    id: '33333333-3333-4333-8333-333333333333',
    address: null,
    latitude: null,
    longitude: null,
    ...overrides,
  });
}

export function aListingDetail(
  overrides: {
    property?: Partial<ListingDetail['property']>;
    unit?: ListingDetail['unit'];
    listing?: Partial<ListingDetail['listing']>;
  } = {},
): ListingDetail {
  const { primaryMedia: _primaryMedia, openHouse: _openHouse, ...cardFields } = aListingCardRow();

  return {
    property: {
      id: '44444444-4444-4444-8444-444444444444',
      propertyType: 'Single Family',
      yearBuilt: 1994,
      lotSqft: 6000,
      ...overrides.property,
    },
    unit: overrides.unit === undefined ? null : overrides.unit,
    listing: {
      ...cardFields,
      description: 'A test description.',
      media: [{ url: 'https://example.com/a.jpg', altText: 'Front elevation' }],
      openHouses: [],
      ...overrides.listing,
    },
  };
}
