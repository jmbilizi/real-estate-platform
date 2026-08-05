import { MockListing } from './types';
import {
  communityKeyFor,
  communityNameFor,
  extractUnitNumber,
  groupListingsByCommunity,
  mapToCommunityRow,
  mapToListingRow,
  mapToPropertyRow,
  mapToUnitRow,
  validateAmenities,
} from './transform';

function buildMockListing(overrides: Partial<MockListing> = {}): MockListing {
  return {
    id: '1',
    title: 'Test Listing',
    address: '123 Main St',
    city: 'Baltimore',
    state: 'MD',
    zip: '21201',
    neighborhood: 'Downtown',
    price: 500000,
    status: 'Active',
    listingType: 'sale',
    source: 'brightMLS',
    propertyType: 'Single Family',
    beds: 3,
    baths: 2.5,
    sqft: 2000,
    lotSqft: 5000,
    yearBuilt: 1990,
    imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    brokerName: 'Jane Broker',
    brokerPhone: '(555) 555-0100',
    brokerEmail: 'jane@example.com',
    officeName: 'Example Realty',
    officeBrokerLeadPhone: '(555) 555-0000',
    officeBrokerLeadMail: 'lead@example.com',
    lastUpdated: '2026-01-01T00:00:00Z',
    description: 'A lovely home.',
    amenities: ['Pool', 'Garage'],
    latitude: 39.29,
    longitude: -76.61,
    featured: true,
    openHouse: { date: '2026-02-01', startTime: '1:00 PM', endTime: '3:00 PM' },
    priceReduced: false,
    newConstruction: false,
    ...overrides,
  };
}

describe('validateAmenities', () => {
  it('passes through a list of valid amenities unchanged', () => {
    expect(validateAmenities(['Pool', 'Garage', 'EV Charging'])).toEqual([
      'Pool',
      'Garage',
      'EV Charging',
    ]);
  });

  it('accepts an empty amenity list', () => {
    expect(validateAmenities([])).toEqual([]);
  });

  it('throws when given an amenity outside the fixed enum', () => {
    expect(() => validateAmenities(['Pool', 'Hot Tub'])).toThrow(/Invalid amenity/);
  });

  it('names every invalid value in the error message', () => {
    expect(() => validateAmenities(['Hot Tub', 'Sauna'])).toThrow(/Hot Tub, Sauna/);
  });
});

describe('communityKeyFor / communityNameFor', () => {
  it('builds a stable grouping key from neighborhood, city, and state', () => {
    const listing = buildMockListing({
      neighborhood: 'Fells Point',
      city: 'Baltimore',
      state: 'MD',
    });
    expect(communityKeyFor(listing)).toBe('Fells Point|Baltimore|MD');
  });

  it('builds a human-readable community name', () => {
    const listing = buildMockListing({ neighborhood: 'Fells Point', city: 'Baltimore' });
    expect(communityNameFor(listing)).toBe('Fells Point, Baltimore');
  });
});

describe('groupListingsByCommunity', () => {
  it('groups listings that share a neighborhood/city/state under one key', () => {
    const a = buildMockListing({
      id: '1',
      neighborhood: 'Fells Point',
      city: 'Baltimore',
      state: 'MD',
    });
    const b = buildMockListing({
      id: '2',
      neighborhood: 'Fells Point',
      city: 'Baltimore',
      state: 'MD',
    });
    const c = buildMockListing({
      id: '3',
      neighborhood: 'Old Town',
      city: 'Alexandria',
      state: 'VA',
    });

    const groups = groupListingsByCommunity([a, b, c]);

    expect(groups.size).toBe(2);
    expect(groups.get('Fells Point|Baltimore|MD')).toEqual([a, b]);
    expect(groups.get('Old Town|Alexandria|VA')).toEqual([c]);
  });

  it('returns an empty map for an empty input', () => {
    expect(groupListingsByCommunity([]).size).toBe(0);
  });
});

describe('mapToCommunityRow', () => {
  it('maps an id and derived name into a community row', () => {
    const listing = buildMockListing({ neighborhood: 'Eastport', city: 'Annapolis' });
    expect(mapToCommunityRow('community-1', listing)).toEqual({
      id: 'community-1',
      name: 'Eastport, Annapolis',
    });
  });
});

describe('mapToPropertyRow', () => {
  it('maps a mock listing to a property row, camelCase -> snake_case', () => {
    const listing = buildMockListing({
      address: '1200 Harbor View Dr',
      city: 'Annapolis',
      state: 'MD',
      zip: '21401',
      latitude: 38.9784,
      longitude: -76.4922,
      propertyType: 'Single Family',
      yearBuilt: 2019,
    });

    expect(mapToPropertyRow('property-1', 'community-1', listing)).toEqual({
      id: 'property-1',
      community_id: 'community-1',
      address: '1200 Harbor View Dr',
      city: 'Annapolis',
      state: 'MD',
      zip: '21401',
      latitude: 38.9784,
      longitude: -76.4922,
      property_type: 'Single Family',
      year_built: 2019,
    });
  });

  it('allows a null community_id for orphan-safe properties', () => {
    const listing = buildMockListing();
    const row = mapToPropertyRow('property-1', null, listing);
    expect(row.community_id).toBeNull();
  });

  it('defaults year_built/lat/long to null when absent from the mock data', () => {
    const listing = buildMockListing({ yearBuilt: undefined });
    const row = mapToPropertyRow('property-1', null, listing);
    expect(row.year_built).toBeNull();
  });
});

describe('extractUnitNumber', () => {
  it.each([
    ['800 F St NW Unit 1201', '1201'],
    ['1330 Kenyon St NW Apt 4', '4'],
    ['1000 Fell St Loft 3B', '3B'],
    ['501 Slaters Ln PH1', 'PH1'],
    ['1881 N Nash St Unit 2508', '2508'],
  ])('extracts the unit designator from "%s"', (address, expected) => {
    expect(extractUnitNumber(address)).toBe(expected);
  });

  it('returns null for addresses with no sub-unit', () => {
    expect(extractUnitNumber('234 Warren Ave')).toBeNull();
    expect(extractUnitNumber('9405 Colesville Rd')).toBeNull();
  });
});

describe('mapToUnitRow', () => {
  it('builds a unit row when the address implies a sub-unit', () => {
    const listing = buildMockListing({ address: '800 F St NW Unit 1201', sqft: 1450 });
    expect(mapToUnitRow('unit-1', 'property-1', listing)).toEqual({
      id: 'unit-1',
      property_id: 'property-1',
      unit_number: '1201',
      floor: null,
      sqft: 1450,
    });
  });

  it('returns null when the property has no sub-unit (single-family home)', () => {
    const listing = buildMockListing({ address: '234 Warren Ave' });
    expect(mapToUnitRow('unit-1', 'property-1', listing)).toBeNull();
  });
});

describe('mapToListingRow', () => {
  it('maps the full consumer listing model, camelCase -> snake_case', () => {
    const listing = buildMockListing({
      listingType: 'sale',
      status: 'Active',
      price: 1295000,
      beds: 5,
      baths: 4,
      sqft: 4200,
      lotSqft: 10890,
      yearBuilt: 2019,
      imageUrls: ['https://img/1.jpg', 'https://img/2.jpg'],
      brokerName: 'Sarah Mitchell',
      brokerPhone: '(410) 555-0190',
      brokerEmail: 'sarah@realbroker.com',
      officeName: 'Real Broker LLC',
      officeBrokerLeadPhone: '(410) 555-0100',
      officeBrokerLeadMail: 'broker@realbroker.com',
      lastUpdated: '2026-04-18T10:30:00Z',
      amenities: ['Pool', 'Waterfront'],
      featured: true,
      priceReduced: false,
      newConstruction: false,
      openHouse: { date: '2026-04-26', startTime: '1:00 PM', endTime: '4:00 PM' },
    });

    const row = mapToListingRow('listing-1', 'property-1', 'unit-1', listing);

    expect(row).toEqual({
      id: 'listing-1',
      property_id: 'property-1',
      unit_id: 'unit-1',
      title: listing.title,
      listing_type: 'sale',
      source: 'internal',
      status: 'Active',
      price: 1295000,
      beds: 5,
      baths: 4,
      sqft: 4200,
      lot_sqft: 10890,
      year_built: 2019,
      neighborhood: listing.neighborhood,
      city: listing.city,
      state: listing.state,
      zip: listing.zip,
      latitude: listing.latitude,
      longitude: listing.longitude,
      image_urls: ['https://img/1.jpg', 'https://img/2.jpg'],
      description: listing.description,
      amenities: ['Pool', 'Waterfront'],
      featured: true,
      price_reduced: false,
      new_construction: false,
      open_house_date: '2026-04-26',
      open_house_start_time: '1:00 PM',
      open_house_end_time: '4:00 PM',
      broker_name: 'Sarah Mitchell',
      broker_phone: '(410) 555-0190',
      broker_email: 'sarah@realbroker.com',
      office_name: 'Real Broker LLC',
      office_broker_lead_phone: '(410) 555-0100',
      office_broker_lead_email: 'broker@realbroker.com',
      is_sample: true,
      last_updated: '2026-04-18T10:30:00Z',
    });
  });

  it('marks every seeded row as sample data (compliance-critical)', () => {
    const row = mapToListingRow('listing-1', 'property-1', null, buildMockListing());
    expect(row.is_sample).toBe(true);
  });

  it('forces source to internal even when the mock data says brightMLS (compliance-critical)', () => {
    const listing = buildMockListing({ source: 'brightMLS' });
    const row = mapToListingRow('listing-1', 'property-1', null, listing);
    expect(row.source).toBe('internal');
  });

  it('forces source to internal even when the mock data says other', () => {
    const listing = buildMockListing({ source: 'other' });
    const row = mapToListingRow('listing-1', 'property-1', null, listing);
    expect(row.source).toBe('internal');
  });

  it('defaults optional merchandising/open-house fields to null/false when absent', () => {
    const listing = buildMockListing({
      lotSqft: undefined,
      yearBuilt: undefined,
      openHouse: undefined,
      priceReduced: undefined,
      newConstruction: undefined,
      officeBrokerLeadPhone: undefined,
      officeBrokerLeadMail: undefined,
    });

    const row = mapToListingRow('listing-1', 'property-1', null, listing);

    expect(row.lot_sqft).toBeNull();
    expect(row.year_built).toBeNull();
    expect(row.open_house_date).toBeNull();
    expect(row.open_house_start_time).toBeNull();
    expect(row.open_house_end_time).toBeNull();
    expect(row.price_reduced).toBe(false);
    expect(row.new_construction).toBe(false);
    expect(row.office_broker_lead_phone).toBeNull();
    expect(row.office_broker_lead_email).toBeNull();
  });

  it('propagates baths as a decimal (e.g. 2.5) without rounding', () => {
    const listing = buildMockListing({ baths: 2.5 });
    const row = mapToListingRow('listing-1', 'property-1', null, listing);
    expect(row.baths).toBe(2.5);
  });

  it('throws when the mock listing carries an amenity outside the fixed enum', () => {
    const listing = buildMockListing({ amenities: ['Pool', 'Not A Real Amenity'] });
    expect(() => mapToListingRow('listing-1', 'property-1', null, listing)).toThrow(
      /Invalid amenity/,
    );
  });
});
